'use strict'

// Parse skills.md, match triggers, execute, chain, schedule, feedback, auto-suggest.

const fs   = require('fs')
const path = require('path')
const { ollamaCall }  = require('./ollama-manager')
const { safeParseJSON } = require('./safe-parse')
const { logError }    = require('./health')

// ── Parse ─────────────────────────────────────────────────────────────────────

function parseSkillsFile(vaultPath) {
  const skillsPath = path.join(vaultPath, 'skills.md')
  if (!fs.existsSync(skillsPath)) return {}
  const content = fs.readFileSync(skillsPath, 'utf8')
  const skills  = {}
  for (const block of content.split(/^---$/m).filter(b => b.trim())) {
    if (block.trim().startsWith('# ')) continue
    try {
      const skill = parseSkillBlock(block)
      if (skill?.name) skills[skill.name] = skill
    } catch {}
  }
  return skills
}

function parseSkillBlock(block) {
  const skill = {
    name: '', version: 1, params: [], triggers: [],
    instructions: '', output: '', schedule: null,
    usageCount: 0, successCount: 0, failCount: 0,
    autoSuggested: false, calls: [],
  }

  const nameMatch = block.match(/^## (.+)$/m)
  if (!nameMatch) return null
  skill.name = nameMatch[1].trim()

  const get = (key) =>
    block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim()

  skill.version    = parseInt(get('version') || '1') || 1
  const params     = get('params')
  if (params && params !== 'none') skill.params = params.split(',').map(p => p.trim())
  const schedule   = get('schedule')
  if (schedule && schedule !== 'none') skill.schedule = schedule
  skill.usageCount  = parseInt(get('usageCount')  || '0') || 0
  skill.successCount = parseInt(get('successCount') || '0') || 0
  skill.failCount   = parseInt(get('failCount')   || '0') || 0

  const triggerSection = block.match(/### Trigger phrases\n([\s\S]+?)(?=###|$)/)
  if (triggerSection) {
    skill.triggers = triggerSection[1].trim()
      .split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
  }

  const instrSection = block.match(/### Instructions\n([\s\S]+?)(?=###|$)/)
  if (instrSection) skill.instructions = instrSection[1].trim()

  const outputSection = block.match(/### Output\n([\s\S]+?)(?=###|$)/)
  if (outputSection) skill.output = outputSection[1].trim()

  const callsSection = block.match(/### Calls\n([\s\S]+?)(?=###|$)/)
  if (callsSection) {
    skill.calls = callsSection[1].trim()
      .split('\n').filter(l => l.startsWith('- '))
      .map(l => l.replace('- ', '').trim())
  }

  return skill
}

// ── Match ─────────────────────────────────────────────────────────────────────

function matchSkill(message, vaultPath) {
  const skills = parseSkillsFile(vaultPath)
  const lower  = message.toLowerCase()

  const runMatch = message.match(/^\/run\s+([\w-]+)(?:\s+(.+))?$/i)
  if (runMatch) {
    const skill = skills[runMatch[1]]
    if (!skill) return null
    return { skill, params: extractParams(runMatch[2] || '', skill) }
  }

  for (const skill of Object.values(skills)) {
    for (const trigger of skill.triggers) {
      if (lower.includes(trigger)) {
        return { skill, params: extractParams(message, skill) }
      }
    }
  }
  return null
}

// Also expose as findSkill for backward compat
const findSkill = matchSkill

function extractParams(message, skill) {
  if (!skill.params.length) return {}
  const params       = {}
  const triggerWords = (skill.triggers[0] || '').split(/\s+/)
  const afterTrigger = message.split(/\s+/).slice(triggerWords.length).join(' ')
  if (afterTrigger && skill.params[0]) params[skill.params[0]] = afterTrigger.trim()
  return params
}

// ── Execute ───────────────────────────────────────────────────────────────────

async function executeSkill(skillMatch, vaultPath, contextBuilder) {
  const { skill, params } = skillMatch
  try {
    let instructions = skill.instructions
    for (const [key, value] of Object.entries(params || {})) {
      instructions = instructions.replace(new RegExp(`{{${key}}}`, 'g'), value)
    }

    const vaultContext = contextBuilder
      ? contextBuilder(`${skill.name} ${Object.values(params || {}).join(' ')}`, vaultPath)
      : ''

    let chainedContext = ''
    if (skill.calls?.length > 0) {
      chainedContext = await runChainedSkills(skill.calls, vaultPath, params, contextBuilder)
    }

    const result = await ollamaCall([{
      role: 'system',
      content: `Execute this skill exactly. Be structured and specific. Cite vault sources.

SKILL: ${skill.name}
INSTRUCTIONS:
${instructions}

${chainedContext ? `CHAINED RESULTS:\n${chainedContext}\n` : ''}
OUTPUT FORMAT: ${skill.output || 'Display inline'}

VAULT:
${vaultContext}`,
    }, {
      role: 'user',
      content: `Execute: ${skill.name}${params && Object.keys(params).length ? ' — ' + JSON.stringify(params) : ''}`,
    }])

    await handleSkillOutput(skill, result, params, vaultPath)
    updateSkillStats(skill.name, true, vaultPath)
    return result

  } catch (e) {
    logError(`skill:${skill.name}`, e)
    updateSkillStats(skill.name, false, vaultPath)
    return `Skill "${skill.name}" failed: ${e.message}`
  }
}

async function runChainedSkills(calls, vaultPath, params, contextBuilder) {
  const results = []
  for (const call of calls) {
    const m = call.match(/^([\w-]+)(?:\((.+)\))?$/)
    if (!m) continue
    const [, skillName, callParam] = m
    const skills        = parseSkillsFile(vaultPath)
    const chainedSkill  = skills[skillName]
    if (!chainedSkill) continue
    const chainedParams = callParam
      ? { [chainedSkill.params[0] || 'param']: callParam } : params
    const result = await executeSkill(
      { skill: chainedSkill, params: chainedParams }, vaultPath, contextBuilder
    )
    results.push(`[${skillName}]:\n${result}`)
  }
  return results.join('\n\n')
}

async function handleSkillOutput(skill, result, params, vaultPath) {
  if (!skill.output || skill.output.toLowerCase().includes('display inline')) return
  const saveMatches = skill.output.match(/Save to:\s*(.+)/g) || []
  for (const saveMatch of saveMatches) {
    let savePath = saveMatch.replace('Save to:', '').trim()
    for (const [key, value] of Object.entries(params || {})) {
      savePath = savePath.replace(new RegExp(`{{${key}}}`, 'g'), value)
    }
    savePath = savePath.replace('[date]', new Date().toISOString().split('T')[0])
    const fullPath = path.join(vaultPath, savePath)
    const dir      = path.dirname(fullPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (savePath.includes('log') || savePath.includes('Summaries')) {
      fs.appendFileSync(fullPath,
        `\n## ${new Date().toLocaleString()}\n${result}\n\n---\n`
      )
    } else {
      fs.writeFileSync(fullPath, result)
    }
  }
}

// ── Stats & feedback ──────────────────────────────────────────────────────────

function updateSkillStats(skillName, success, vaultPath) {
  const p = path.join(vaultPath, 'skills.md')
  if (!fs.existsSync(p)) return
  try {
    let content = fs.readFileSync(p, 'utf8')
    const field = success ? 'successCount' : 'failCount'
    content = content.replace(
      new RegExp(`(## ${skillName}[\\s\\S]+?${field}: )(\\d+)`, 'm'),
      (_, pre, count) => `${pre}${parseInt(count) + 1}`
    )
    content = content.replace(
      new RegExp(`(## ${skillName}[\\s\\S]+?usageCount: )(\\d+)`, 'm'),
      (_, pre, count) => `${pre}${parseInt(count) + 1}`
    )
    fs.writeFileSync(p, content)
  } catch {}
}

async function recordSkillFeedback(skillName, feedback, vaultPath) {
  const p = path.join(vaultPath, 'skills.md')
  if (!fs.existsSync(p)) return null
  try {
    let content = fs.readFileSync(p, 'utf8')
    content = content.replace(
      new RegExp(`(## ${skillName}[\\s\\S]+?lastFeedback: ).+`, 'm'),
      (_, pre) => `${pre}${new Date().toISOString().split('T')[0]}: ${feedback}`
    )
    fs.writeFileSync(p, content)
    const skill = parseSkillsFile(vaultPath)[skillName]
    if (skill && skill.failCount > 3) {
      const suggestion = await ollamaCall([{
        role: 'system',
        content: 'Suggest specific improvements to this skill based on failure feedback. Be concrete.',
      }, {
        role: 'user',
        content: `Skill: ${skill.name}\nInstructions:\n${skill.instructions}\nFeedback: ${feedback}\nFail count: ${skill.failCount}`,
      }], 200)
      return `Skill "${skillName}" has failed ${skill.failCount} times.\n\n${suggestion}\n\nSay "yes update ${skillName}" to apply.`
    }
  } catch {}
  return null
}

async function analyzeForSkillOpportunities(conversations, vaultPath) {
  if (!conversations.length) return null
  const existingNames = Object.keys(parseSkillsFile(vaultPath))

  const analysis = await ollamaCall([{
    role: 'system',
    content: `Find repeated patterns worth turning into saved skills. Worth suggesting if same request type appears 3+ times. Return JSON array: [{name:"", triggers:[""], instructions:"", suggestedSchedule:"none"}]. Skip existing: ${existingNames.join(', ')}. Return empty array if no good candidates.`,
  }, {
    role: 'user',
    content: conversations.slice(-50).map(c => c.user || c.content || '').join('\n'),
  }], 300)

  const suggestions = safeParseJSON(analysis, [])
  if (!suggestions.length) return null

  const skillsPath = path.join(vaultPath, 'skills.md')
  let content = fs.existsSync(skillsPath)
    ? fs.readFileSync(skillsPath, 'utf8') : '# Skills\n\n'
  const today = new Date().toISOString().split('T')[0]

  for (const s of suggestions) {
    if (!s.name || !s.instructions) continue
    content += `\n---\n\n## ${s.name}\nversion: 1\ncreated: ${today}\nusageCount: 0\nlastUsed: never\nschedule: ${s.suggestedSchedule || 'none'}\nparams: none\nautoSuggested: true\n\n### Trigger phrases\n${(s.triggers || []).join(', ')}\n\n### Instructions\n${s.instructions}\n\n### Output\nDisplay inline\n\n### Feedback\nsuccessCount: 0\nfailCount: 0\nlastFeedback: none\n\n---\n`
  }

  fs.writeFileSync(skillsPath, content)
  return `I noticed some patterns. Drafted ${suggestions.length} new skill${suggestions.length > 1 ? 's' : ''}: ${suggestions.map(s => s.name).join(', ')}. Check skills.md to review.`
}

function learnSkill(vaultPath, name, triggers, instructions, params = [], schedule = 'none') {
  const skillsPath = path.join(vaultPath, 'skills.md')
  const existing   = fs.existsSync(skillsPath)
    ? fs.readFileSync(skillsPath, 'utf8') : '# Skills\n\n'
  const today  = new Date().toISOString().split('T')[0]
  const entry  = `\n---\n\n## ${name}\nversion: 1\ncreated: ${today}\nusageCount: 0\nlastUsed: never\nschedule: ${schedule}\nparams: ${params.length ? params.join(', ') : 'none'}\nautoSuggested: false\n\n### Trigger phrases\n${triggers.join(', ')}\n\n### Instructions\n${instructions}\n\n### Output\nDisplay inline\n\n### Feedback\nsuccessCount: 0\nfailCount: 0\nlastFeedback: none\n\n---\n`
  fs.writeFileSync(skillsPath, existing + entry)
  return `Skill "${name}" learned. Triggers on: ${triggers.join(', ')}`
}

function getScheduledSkills(vaultPath) {
  return Object.values(parseSkillsFile(vaultPath))
    .filter(s => s.schedule && s.schedule !== 'none')
}

module.exports = {
  parseSkillsFile, matchSkill, findSkill, executeSkill,
  recordSkillFeedback, analyzeForSkillOpportunities,
  getScheduledSkills, learnSkill, updateSkillStats,
}
