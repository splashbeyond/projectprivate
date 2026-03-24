'use strict'

// Pure JS pattern matching — zero Ollama calls, under 1ms.
// Catches natural language before the AI pipeline.

const fs   = require('fs')
const path = require('path')

const INTENTS = [
  {
    name: 'remember',
    patterns: [
      /remember (?:that )?(.+)/i,
      /don'?t forget (?:that )?(.+)/i,
      /make a note (?:that )?(.+)/i,
      /keep in mind (?:that )?(.+)/i,
      /save this[:\s]+(.+)/i,
      /note that (.+)/i,
    ],
    handle: (m, vaultPath) => {
      const fact = m[1].trim()
      const mem  = require('./vault').readMemory(vaultPath)
      mem.userDefined = mem.userDefined || []
      mem.userDefined.push({ fact, date: new Date().toISOString() })
      require('./vault').writeMemory(vaultPath, mem)
      return `Got it. I'll remember: "${fact}"`
    },
  },
  {
    name: 'todo_add',
    patterns: [
      /add (?:a )?(?:task|todo)[:\s]+(.+)/i,
      /remind me to (.+)/i,
      /i need to (.+)/i,
      /don'?t let me forget to (.+)/i,
      /put (.+) on my (?:list|todos)/i,
    ],
    handle: (m, vaultPath) => {
      const task = m[1].trim()
      const p    = path.join(vaultPath, 'now.md')
      if (fs.existsSync(p)) {
        let c = fs.readFileSync(p, 'utf8')
        c = c.replace('## This week\n', `## This week\n- [ ] ${task}\n`)
        fs.writeFileSync(p, c)
      }
      return `Added to your list: "${task}"`
    },
  },
  {
    name: 'todo_done',
    patterns: [
      /(?:i )?(?:finished|completed|done with) (.+)/i,
      /mark (.+) (?:as )?done/i,
      /just finished (.+)/i,
    ],
    handle: (m, vaultPath) => {
      const task = m[1].trim()
      const p    = path.join(vaultPath, 'now.md')
      if (fs.existsSync(p)) {
        let c = fs.readFileSync(p, 'utf8')
        c = c.replace(
          new RegExp(`- \\[ \\] (.{0,40}${task.slice(0, 20)}.{0,40})`, 'i'),
          (_, t) => `- [x] ${t}`
        )
        fs.writeFileSync(p, c)
      }
      return `Done: "${task}"`
    },
  },
  {
    name: 'todo_list',
    patterns: [
      /what(?:'s| is) on my (?:list|todos|tasks)/i,
      /show (?:me )?my (?:todos|tasks|list)/i,
      /what do i need to do/i,
    ],
    handle: (_, vaultPath) => {
      const p = path.join(vaultPath, 'now.md')
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'No tasks yet.'
    },
  },
  {
    name: 'idea',
    patterns: [
      /(?:i have |had )?an idea[:\s]+(.+)/i,
      /idea[:\s]+(.+)/i,
      /just thought of (.+)/i,
      /what if (?:we |i )?(.+)\?/i,
    ],
    handle: (m, vaultPath) => {
      const idea  = m[1].trim()
      const today = new Date().toISOString().split('T')[0]
      const p     = path.join(vaultPath, 'Notes', 'ideas.md')
      const dir   = path.dirname(p)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(p,
        `\n## ${idea.slice(0, 50)}\nDate: ${today}\nStatus: RAW\n\n${idea}\n\n---\n`
      )
      return `Idea captured: "${idea.slice(0, 60)}..."`
    },
  },
  {
    name: 'win',
    patterns: [
      /(?:i )?(?:just )?(?:closed|landed|got|signed|shipped|won) (.+)/i,
      /big win[:\s]+(.+)/i,
      /log (?:a )?win[:\s]+(.+)/i,
    ],
    handle: (m, vaultPath) => {
      const win   = m[1].trim()
      const today = new Date().toISOString().split('T')[0]
      const p     = path.join(vaultPath, 'Notes', 'wins.md')
      const dir   = path.dirname(p)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(p, `\n## ${win}\nDate: ${today}\n\n---\n`)
      return `Win logged: "${win}"`
    },
  },
  {
    name: 'person_context',
    patterns: [
      /(?:what do (?:i|you) know about|tell me about|who is) ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/,
      /prep (?:me )?for (?:my )?(?:call|meeting) with ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/i,
      /briefing on ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/i,
    ],
    handle: (m, vaultPath) => {
      const name       = m[1].trim()
      const peoplePath = path.join(vaultPath, 'people.md')
      if (!fs.existsSync(peoplePath)) return `No entry for ${name} yet.`
      const people  = fs.readFileSync(peoplePath, 'utf8')
      const section = people.split('---')
        .find(s => s.toLowerCase().includes(name.toLowerCase()))
      const vaultContext = require('./context-builder').buildVaultContext(name)
      return [
        section ? `People.md:\n${section.trim()}` : `No entry for ${name} yet.`,
        vaultContext ? `\nVault:\n${vaultContext}` : '',
      ].filter(Boolean).join('\n\n')
    },
  },
  {
    name: 'project_new',
    patterns: [
      /(?:start|create|new|kick off) (?:a )?(?:new )?project[:\s]+(.+)/i,
      /set up (?:a )?project (?:for|called) (.+)/i,
    ],
    handle: (m, vaultPath) => {
      const name  = m[1].trim()
      const dir   = path.join(vaultPath, 'Projects', name)
      const today = new Date().toISOString().split('T')[0]
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      if (!fs.existsSync(path.join(dir, 'brief.md'))) {
        fs.writeFileSync(path.join(dir, 'brief.md'),
          `# ${name}\n\nCreated: ${today}\n\n## Overview\n\n## Goals\n\n## Key people\n\n## Timeline\n`
        )
        fs.writeFileSync(path.join(dir, 'log.md'), `# ${name} — Log\n\n`)
      }
      return `Project "${name}" created at Projects/${name}/`
    },
  },
  {
    name: 'briefing',
    patterns: [
      /(?:give me|what(?:'s| is)) (?:my |the )?(?:morning |daily )?briefing/i,
      /what(?:'s| is) (?:on|happening) today/i,
      /catch me up/i,
      /what should i focus on today/i,
    ],
    handle: async (_, vaultPath) => {
      const { executeSkill, parseSkillsFile } = require('./skill-engine')
      const { buildContext } = require('./context-builder')
      const skills = parseSkillsFile(vaultPath)
      const skill  = skills['daily-briefing']
      if (!skill) return 'Daily briefing skill not found in skills.md.'
      return executeSkill({ skill, params: {} }, vaultPath, buildContext)
    },
  },
  {
    name: 'status',
    patterns: [
      /(?:how are you|are you (?:running|ok|working))/i,
      /system status/i,
      /everything (?:ok|working|good)\??/i,
    ],
    handle: async (_, vaultPath) => {
      const { getStatus }             = require('./health')
      const { readVault, readMemory } = require('./vault')
      const s      = getStatus()
      const notes  = readVault(vaultPath)
      const memory = readMemory(vaultPath)
      return [
        s.healthy ? 'All systems running.' : `${s.recentErrors.length} recent error(s).`,
        `Vault: ${notes.length} notes`,
        `Memory: ${(memory.userDefined || []).length} remembered facts`,
        `Entities: ${Object.keys(memory.entities || {}).length} known`,
        `Model: llama3.2:3b`,
        `Last memory update: ${s.lastMemoryConsolidation}`,
        `Privacy: 100% local — zero data egress`,
      ].join('\n')
    },
  },
]

async function detectIntent(message, vaultPath) {
  for (const intent of INTENTS) {
    for (const pattern of intent.patterns) {
      const match = message.trim().match(pattern)
      if (match) {
        try {
          const response = await intent.handle(match, vaultPath)
          return { matched: true, response, intent: intent.name }
        } catch (e) {
          require('./health').logError(`intent:${intent.name}`, e)
        }
      }
    }
  }
  return { matched: false }
}

module.exports = { detectIntent }
