'use strict'

// Pure JS pattern matching — zero Ollama calls, under 1ms.
// Catches natural language before the AI pipeline.

const fs   = require('fs')
const path = require('path')

const INTENTS = [
  // Personal facts — "my X is Y", "I am X", "I prefer X", "I work at X"
  // Saved to memory silently. Never added to todo list.
  {
    name: 'personal_fact',
    patterns: [
      /^my (favorite|favourite) (.+) is (.+)/i,
      /^my (.+) is (.+)/i,
      /^i (?:am|'m) (a |an )?(.+)/i,
      /^i (?:work|worked) (?:at|for|in) (.+)/i,
      /^i (?:live|lived) (?:in|at) (.+)/i,
      /^i (?:prefer|love|hate|like|dislike|enjoy) (.+)/i,
      /^i (?:use|used|used to use) (.+)/i,
      /^i (?:speak|know) (.+)/i,
      /^i (?:have|had) (.+)/i,
      /^i (?:studied|went to) (.+)/i,
    ],
    handle: (m, vaultPath) => {
      const fact = m[0].trim()
      const mem  = require('./vault').readMemory(vaultPath)
      mem.userDefined = mem.userDefined || []
      // Avoid duplicates
      const exists = mem.userDefined.some(f => {
        const text = typeof f === 'object' ? f.fact : f
        return text.toLowerCase() === fact.toLowerCase()
      })
      if (!exists) {
        mem.userDefined.push({ fact, date: new Date().toISOString() })
        require('./vault').writeMemory(vaultPath, mem)
      }
      // Return null — let the model respond naturally without announcing the save
      return null
    },
  },
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
    name: 'calendar_lookup',
    patterns: [
      /what (?:did we do|happened|was discussed)(?: on)? (today|yesterday)/i,
      /what (?:did we do|happened|was discussed) on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
      /what (?:did we do|happened|was discussed) on ([a-z]+ \d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)/i,
      /what (?:did we do|happened|was discussed) on (\d{4}-\d{2}-\d{2})/i,
      /show (?:me )?(?:the )?(?:log|memory|calendar)(?: for| on)? (today|yesterday)/i,
      /show (?:me )?(?:the )?(?:log|memory|calendar) (?:for|on) (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
      /show (?:me )?(?:the )?(?:log|memory|calendar) (?:for|on) ([a-z]+ \d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)/i,
    ],
    handle: (m, vaultPath) => {
      const { getDateSection, getTodayKey } = require('./daily-log')
      const raw = m[1].trim().toLowerCase()
      let dateStr = null

      if (raw === 'today') {
        dateStr = getTodayKey()
      } else if (raw === 'yesterday') {
        const d = new Date(); d.setDate(d.getDate() - 1)
        dateStr = d.toISOString().split('T')[0]
      } else {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
        const dayIdx = days.indexOf(raw)
        if (dayIdx !== -1) {
          const d = new Date()
          const diff = (d.getDay() - dayIdx + 7) % 7 || 7
          d.setDate(d.getDate() - diff)
          dateStr = d.toISOString().split('T')[0]
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          dateStr = raw
        } else {
          const months = {
            january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
            july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
          }
          const mo = raw.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/)
          if (mo && months[mo[1]] !== undefined) {
            const year = mo[3] ? parseInt(mo[3]) : new Date().getFullYear()
            const d = new Date(year, months[mo[1]], parseInt(mo[2]))
            dateStr = d.toISOString().split('T')[0]
          }
        }
      }

      if (!dateStr) return `Couldn't parse that date. Try "today", "yesterday", a day name like "Monday", or "March 20".`

      const section = getDateSection(vaultPath, dateStr)
      return section || `Nothing logged for ${dateStr}.`
    },
  },
  {
    name: 'recall_topic',
    patterns: [
      /recall (?:our )?(?:chat|conversation|discussion) about (.+)/i,
      /what did (?:we|i) (?:discuss|talk about|say) about (.+)/i,
      /find (?:our )?(?:chat|conversation|discussion) about (.+)/i,
      /(?:do you remember|do you recall) (?:when we (?:talked|discussed)|our (?:chat|conversation) about) (.+)/i,
      /show (?:me )?(?:our )?(?:chat|conversation|discussion) about (.+)/i,
    ],
    handle: (m, vaultPath) => {
      const fs   = require('fs')
      const path = require('path')
      const topic    = m[1].trim()
      const keywords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 2)
      const chatsDir = path.join(vaultPath, 'Chats')

      if (!fs.existsSync(chatsDir)) return `No chat history yet.`

      const files = fs.readdirSync(chatsDir).filter(f => f.endsWith('.md'))
      if (!files.length) return `No chat history yet.`

      const scored = files
        .map(f => {
          try {
            const content = fs.readFileSync(path.join(chatsDir, f), 'utf8')
            const lower   = content.toLowerCase()
            const score   = keywords.filter(w => lower.includes(w)).length
            return { name: f.replace('.md', ''), content, score }
          } catch { return null }
        })
        .filter(r => r && r.score > 0)
        .sort((a, b) => b.score - a.score)

      if (!scored.length) return `No chats found mentioning "${topic}".`

      const best  = scored[0]
      const lines = best.content.split('\n')
      let start   = 0
      if (lines[0] === '---') {
        const end = lines.indexOf('---', 1)
        if (end !== -1) start = end + 1
      }
      const body = lines.slice(start).join('\n').trim().slice(0, 1500)
      const tail = scored.length > 1
        ? `\n\n(${scored.length - 1} other match${scored.length > 2 ? 'es' : ''} also found)`
        : ''

      return `**"${best.name}"**\n\n${body}${tail}`
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
          // null response = save silently, let model reply naturally
          if (response === null) return { matched: false, sideEffect: intent.name }
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
