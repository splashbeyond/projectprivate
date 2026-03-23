'use strict'

// INTENT DETECTOR
// Pure JavaScript pattern matching — zero Ollama calls
// Runs in under 1ms — zero latency added
// Falls through to RAG chat if nothing matches

const fs   = require('fs')
const path = require('path')

const INTENTS = [

  // ── MEMORY ──────────────────────────────────────────────────────────────────
  {
    name: 'remember',
    patterns: [
      /remember that (.+)/i,
      /don'?t forget (?:that )?(.+)/i,
      /make a note that (.+)/i,
      /keep in mind (?:that )?(.+)/i,
      /note that (.+)/i,
      /save this[:\s]+(.+)/i,
    ],
    extract: (m) => ({ fact: m[1] }),
    handle: async (args, vaultPath) =>
      require('./memory').rememberFact(args.fact, vaultPath),
  },

  // ── TODOS ────────────────────────────────────────────────────────────────────
  {
    name: 'todo_add',
    patterns: [
      /add (?:a )?(?:task|todo)[:\s]+(.+)/i,
      /remind me to (.+)/i,
      /i need to (.+)/i,
      /don'?t let me forget to (.+)/i,
      /put (.+) on my (?:list|todos)/i,
      /can you add (.+) to my (?:list|todos)/i,
      /make a (?:task|todo) (?:for|to) (.+)/i,
      /add to (?:my )?list[:\s]+(.+)/i,
    ],
    extract: (m) => ({ task: m[1] }),
    handle: (args, vaultPath) => {
      const p = path.join(vaultPath, 'todolist.md')
      const c = fs.readFileSync(p, 'utf8')
      fs.writeFileSync(p, c.replace('## Today\n', `## Today\n- [ ] ${args.task}\n`))
      return `Added: "${args.task}"`
    },
  },

  {
    name: 'todo_done',
    patterns: [
      /(?:i )?(?:finished|completed|done with) (.+)/i,
      /mark (.+) (?:as )?done/i,
      /check off (.+)/i,
      /just finished (.+)/i,
      /(.+) is done/i,
    ],
    extract: (m) => ({ task: m[1] }),
    handle: (args, vaultPath) => {
      const p  = path.join(vaultPath, 'todolist.md')
      let c    = fs.readFileSync(p, 'utf8')
      const rx = new RegExp(`- \\[ \\] (.{0,30}${args.task.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.{0,30})`, 'i')
      c = c.replace(rx, (_, t) => `- [x] ${t}`)
      fs.writeFileSync(p, c)
      return `Done: "${args.task}"`
    },
  },

  {
    name: 'todo_list',
    patterns: [
      /what(?:'s| is) on my (?:list|todos|tasks)/i,
      /show (?:me )?my (?:todos|tasks|list)/i,
      /what do i need to do/i,
      /what(?:'s| are) my tasks/i,
    ],
    extract: () => ({}),
    handle: (_, vaultPath) =>
      fs.readFileSync(path.join(vaultPath, 'todolist.md'), 'utf8'),
  },

  // ── GOALS ────────────────────────────────────────────────────────────────────
  {
    name: 'goal_add',
    patterns: [
      /(?:my )?goal is to (.+)/i,
      /i want to (.+) (?:this week|this month|this year)/i,
      /add (?:a )?goal[:\s]+(.+)/i,
      /set (?:a )?goal[:\s]+(.+)/i,
      /i(?:'m| am) trying to (.+)/i,
    ],
    extract: (m) => ({ goal: m[1] }),
    handle: (args, vaultPath) => {
      fs.appendFileSync(path.join(vaultPath, 'goals.md'), `\n- ${args.goal}`)
      return `Goal added: "${args.goal}"`
    },
  },

  // ── IDEAS ────────────────────────────────────────────────────────────────────
  {
    name: 'idea',
    patterns: [
      /(?:i have |had )?an idea[:\s]+(.+)/i,
      /idea[:\s]+(.+)/i,
      /what if (?:we |i )?(.+)\?/i,
      /just thought of (.+)/i,
      /capture (?:this )?idea[:\s]+(.+)/i,
    ],
    extract: (m) => ({ idea: m[1] }),
    handle: (args, vaultPath) => {
      const today = new Date().toISOString().split('T')[0]
      const entry = `\n## ${args.idea.slice(0, 50)}\nDate: ${today}\nStatus: RAW\n\n${args.idea}\n\n---\n`
      fs.appendFileSync(path.join(vaultPath, 'ideas.md'), entry)
      return `Idea captured: "${args.idea.slice(0, 60)}"`
    },
  },

  // ── WINS ─────────────────────────────────────────────────────────────────────
  {
    name: 'win',
    patterns: [
      /(?:i )?(?:just )?(?:closed|landed|got|signed|shipped|launched|won) (.+)/i,
      /big win[:\s]+(.+)/i,
      /log (?:a )?win[:\s]+(.+)/i,
      /we (?:just )?(?:closed|landed|got|won) (.+)/i,
    ],
    extract: (m) => ({ win: m[1] }),
    handle: (args, vaultPath) => {
      const today = new Date().toISOString().split('T')[0]
      fs.appendFileSync(
        path.join(vaultPath, 'wins.md'),
        `\n## ${args.win}\nDate: ${today}\n\n---\n`
      )
      return `Win logged: "${args.win}"`
    },
  },

  // ── PEOPLE ───────────────────────────────────────────────────────────────────
  {
    name: 'person_context',
    patterns: [
      /(?:what do (?:i|you) know about|tell me about|who is) ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/,
      /(?:remind me about|context (?:on|for|about)) ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/i,
      /prep (?:me )?for (?:my )?(?:call|meeting) with ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/i,
      /briefing on ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/i,
    ],
    extract: (m) => ({ name: m[1] }),
    handle: async (args, vaultPath) => {
      const { findRelevant } = require('./search')
      const people  = fs.readFileSync(path.join(vaultPath, 'people.md'), 'utf8')
      const section = people.split('---').find(s =>
        s.toLowerCase().includes(args.name.toLowerCase())
      )
      const vaultCtx = findRelevant(args.name)
      return [
        section ? `People.md:\n${section.trim()}` : `No entry for ${args.name} yet.`,
        vaultCtx ? `\nVault:\n${vaultCtx}` : '',
      ].filter(Boolean).join('\n\n')
    },
  },

  // ── PROJECTS ─────────────────────────────────────────────────────────────────
  {
    name: 'project_new',
    patterns: [
      /(?:start|create|new|kick off) (?:a )?(?:new )?project[:\s]+(.+)/i,
      /set up (?:a )?project (?:for|called) (.+)/i,
    ],
    extract: (m) => ({ name: m[1].trim() }),
    handle: (args, vaultPath) => {
      const dir   = path.join(vaultPath, 'Projects', args.name)
      const today = new Date().toISOString().split('T')[0]
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'brief.md'),
        `# ${args.name}\n\nCreated: ${today}\n\n## Overview\n\n## Goals\n\n## Key people\n\n## Timeline\n`)
      fs.writeFileSync(path.join(dir, 'notes.md'),   `# ${args.name} — Notes\n\n`)
      fs.writeFileSync(path.join(dir, 'actions.md'), `# ${args.name} — Actions\n\n## Open\n\n## Done\n`)
      const pp = path.join(vaultPath, 'projects.md')
      const c  = fs.readFileSync(pp, 'utf8')
      fs.writeFileSync(pp, c.replace('## Active\n', `## Active\n| ${args.name} | Active | — | High |\n`))
      return `Project "${args.name}" created.`
    },
  },

  // ── BRIEFING ─────────────────────────────────────────────────────────────────
  {
    name: 'briefing',
    patterns: [
      /(?:give me|what(?:'s| is)) (?:my |the )?(?:morning |daily )?briefing/i,
      /what(?:'s| is) (?:on|happening) today/i,
      /catch me up/i,
      /what do i have today/i,
      /morning update/i,
      /what should i focus on today/i,
    ],
    extract: () => ({}),
    handle: async (_, vaultPath) =>
      require('./skills').runSkill('daily briefing', vaultPath),
  },

  // ── STATUS ───────────────────────────────────────────────────────────────────
  {
    name: 'status',
    patterns: [
      /(?:how are you|are you (?:running|ok|working))/i,
      /system status/i,
      /everything (?:ok|working|good)/i,
    ],
    extract: () => ({}),
    handle: (_, vaultPath) => {
      const { readVault }  = require('./vault')
      const { readMemory } = require('./memory')
      const notes  = readVault(vaultPath)
      const memory = readMemory(vaultPath)
      return [
        'All systems running.',
        `Vault: ${notes.length} notes indexed`,
        `Memory: ${(memory.userDefined || []).length} remembered facts`,
        `Model: ${MODEL}`,
        'Privacy: 100% local — zero data egress',
      ].join('\n')
    },
  },
]

const MODEL = 'llama3.2:3b'

async function detectIntent(message, vaultPath) {
  for (const intent of INTENTS) {
    for (const pattern of intent.patterns) {
      const match = message.trim().match(pattern)
      if (match) {
        try {
          const args     = intent.extract(match)
          const response = await intent.handle(args, vaultPath)
          return { matched: true, response, intent: intent.name }
        } catch (e) {
          console.error(`Intent ${intent.name} failed:`, e.message)
        }
      }
    }
  }
  return { matched: false }
}

module.exports = { detectIntent }
