'use strict'

// Weekly synthesis Friday 5pm + user-defined scheduled skills.
// This is the ONLY internal cron job. Everything else is event-driven.

const cron = require('node-cron')
const path = require('path')
const fs   = require('fs')
const { ollamaCall }  = require('./ollama-manager')
const { writeFile, readVault } = require('./vault')
const { logError, updateHealth } = require('./health')
const { parseSkillsFile, executeSkill } = require('./skill-engine')
const { buildContext, buildIndex }      = require('./context-builder')

const activeJobs   = new Map()
let mainWindowRef  = null
let vaultPathRef   = null

function init(vaultPath, mainWindow) {
  vaultPathRef   = vaultPath
  mainWindowRef  = mainWindow
}

// ── Weekly synthesis ──────────────────────────────────────────────────────────

function startWeeklySynthesis(vaultPath) {
  const job = cron.schedule('0 17 * * 5', async () => {
    try {
      const digestDir = path.join(vaultPath, 'Digests')
      if (!fs.existsSync(digestDir)) return

      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 7)

      const digests = fs.readdirSync(digestDir)
        .filter(f => f.endsWith('.md'))
        .filter(f => {
          try { return new Date(f.replace('.md', '')) >= cutoff } catch { return false }
        })
        .sort()
        .map(f => fs.readFileSync(path.join(digestDir, f), 'utf8'))
        .join('\n\n---\n\n')

      if (!digests.trim()) return

      const synthesis = await ollamaCall([{
        role: 'system',
        content: `Synthesise this week into under 300 tokens.
Accomplished, patterns observed, unresolved items, top 3 priorities for next week.
Specific not general. Flag anything drifting from stated goals.`,
      }, { role: 'user', content: digests }], 300)

      const week = getWeekNumber()
      writeFile(vaultPath, `Synthesis/${week}.md`,
        `# Weekly synthesis — ${week}\n\n${synthesis}`
      )
      updateHealth('lastWeeklySynthesis', new Date().toISOString())

    } catch (e) { logError('weeklySynthesis', e) }
  })
  activeJobs.set('weekly-synthesis', job)
}

// ── Scheduled skills ──────────────────────────────────────────────────────────

function startScheduledSkills(vaultPath) {
  const skills = parseSkillsFile(vaultPath)
  for (const [name, skill] of Object.entries(skills)) {
    if (!skill.schedule || skill.schedule === 'none') continue
    if (!cron.validate(skill.schedule)) {
      logError('startScheduledSkills',
        new Error(`Invalid cron for "${name}": ${skill.schedule}`))
      continue
    }
    registerSkillJob(name, skill, vaultPath)
  }
}

function registerSkillJob(name, skill, vaultPath) {
  removeJob(name)
  const job = cron.schedule(skill.schedule, async () => {
    try {
      const result = await executeSkill({ skill, params: {} }, vaultPath, buildContext)
      buildIndex(readVault(vaultPath), vaultPath)
      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send('anchor-message', {
          role: 'ai', text: `[Scheduled: ${skill.name}]\n\n${result}`, scheduled: true,
        })
      }
    } catch (e) { logError(`scheduled:${name}`, e) }
  })
  activeJobs.set(name, job)
}

// ── Job management ────────────────────────────────────────────────────────────

function addJob(name, cronExpression, skillName, vaultPath) {
  if (!cron.validate(cronExpression)) {
    return { success: false, error: `Invalid cron: ${cronExpression}` }
  }
  const skills = parseSkillsFile(vaultPath)
  const skill  = skills[skillName]
  if (!skill) return { success: false, error: `Skill not found: ${skillName}` }
  updateSkillSchedule(skillName, cronExpression, vaultPath)
  registerSkillJob(name, { ...skill, schedule: cronExpression }, vaultPath)
  return { success: true, message: `"${name}" scheduled: ${cronExpression}` }
}

function pauseJob(name) {
  const job = activeJobs.get(name)
  if (!job) return { success: false, error: `No job: ${name}` }
  job.stop()
  return { success: true, message: `"${name}" paused` }
}

function resumeJob(name) {
  const job = activeJobs.get(name)
  if (!job) return { success: false, error: `No job: ${name}` }
  job.start()
  return { success: true, message: `"${name}" resumed` }
}

function removeJob(name) {
  const job = activeJobs.get(name)
  if (job) { job.destroy(); activeJobs.delete(name) }
}

function listJobs() {
  return [...activeJobs.entries()].map(([name, job]) => ({
    name, running: job.running !== false,
  }))
}

async function runJobNow(name, vaultPath) {
  const skill = Object.values(parseSkillsFile(vaultPath))
    .find(s => s.name === name || name.includes(s.name))
  if (!skill) return `No skill found for: ${name}`
  return executeSkill({ skill, params: {} }, vaultPath, buildContext)
}

function stopCron() {
  for (const [name, job] of activeJobs) {
    try { job.destroy() } catch {}
  }
  activeJobs.clear()
}

function updateSkillSchedule(skillName, schedule, vaultPath) {
  const p = path.join(vaultPath, 'skills.md')
  if (!fs.existsSync(p)) return
  let content = fs.readFileSync(p, 'utf8')
  content = content.replace(
    new RegExp(`(## ${skillName}[\\s\\S]+?schedule: ).+`, 'm'),
    (_, pre) => `${pre}${schedule}`
  )
  fs.writeFileSync(p, content)
}

function getWeekNumber() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7)
  const week1   = new Date(d.getFullYear(), 0, 4)
  const weekNum = 1 + Math.round(
    ((d.getTime() - week1.getTime()) / 86400000
      - 3 + (week1.getDay() + 6) % 7) / 7
  )
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

// Backward compat stubs for old cron.js callers
const startCron = (vaultPath) => {
  startWeeklySynthesis(vaultPath)
  startScheduledSkills(vaultPath)
}

module.exports = {
  init, startCron, stopCron,
  startWeeklySynthesis, startScheduledSkills,
  addJob, pauseJob, resumeJob, removeJob, listJobs, runJobNow,
}
