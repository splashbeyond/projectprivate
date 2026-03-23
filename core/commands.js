'use strict'

const fs   = require('fs')
const path = require('path')

// All slash command handlers
// Returns { response, action? }
// action: 'newchat' | 'exit' | null

async function handleCommand(cmd, args, vaultPath, history) {
  const { readMemory, writeMemory, rememberFact, forgetTopic, getRecap } = require('./memory')
  const { readSession }          = require('./session')
  const { readNote, writeNote, noteExists } = require('./vault')
  const { runSkill, teachSkill, listSkills } = require('./skills')
  const { askAnchor }            = require('./ollama')
  const today = () => new Date().toISOString().split('T')[0]

  switch (cmd) {

    // ── MEMORY ────────────────────────────────────────────────────────────────
    case 'remember':
      if (!args) return { response: 'Usage: /remember [fact]' }
      return { response: rememberFact(args, vaultPath) }

    case 'forget':
      if (!args) return { response: 'Usage: /forget [topic]' }
      return { response: forgetTopic(args, vaultPath) }

    case 'recap':
      return { response: getRecap(vaultPath) }

    // ── CHAT ──────────────────────────────────────────────────────────────────
    case 'newchat':
      return { response: 'Starting fresh. I still remember everything.', action: 'newchat' }

    case 'tone': {
      if (!args) return { response: 'Usage: /tone [description]' }
      let md = readNote(vaultPath, 'ANCHOR.md')
      md = md.replace(/## Tone\n[\s\S]*?(?=\n##)/, `## Tone\n${args}\n`)
      writeNote(vaultPath, 'ANCHOR.md', md)
      return { response: `Tone updated to: ${args}` }
    }

    // ── GOALS ─────────────────────────────────────────────────────────────────
    case 'goal': {
      const [sub, ...rest] = (args || '').split(' ')
      const text = rest.join(' ')

      if (sub === 'add' || sub === 'long' || sub === 'medium' || sub === 'short') {
        if (!text) return { response: 'Usage: /goal add [goal]' }
        fs.appendFileSync(path.join(vaultPath, 'goals.md'), `\n- ${text}`)
        return { response: `Goal added: "${text}"` }
      }
      if (sub === 'list') {
        return { response: readNote(vaultPath, 'goals.md') }
      }
      if (sub === 'review') {
        const content = readNote(vaultPath, 'goals.md')
        const resp = await askAnchor(`Review my goals and give honest progress feedback:\n\n${content}`, history)
        return { response: resp }
      }
      if (sub === 'done') {
        if (!text) return { response: 'Usage: /goal done [goal]' }
        let g = readNote(vaultPath, 'goals.md')
        g = g.replace(new RegExp(`- ${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `- ~~${text}~~ ✓`)
        writeNote(vaultPath, 'goals.md', g)
        const winDate = today()
        fs.appendFileSync(path.join(vaultPath, 'wins.md'), `\n## ${text}\nDate: ${winDate}\n\n---\n`)
        return { response: `Goal done and logged as a win: "${text}"` }
      }
      return { response: 'Usage: /goal [add|list|review|done] ...' }
    }

    // ── TODOS ─────────────────────────────────────────────────────────────────
    case 'todo': {
      const [sub, ...rest] = (args || '').split(' ')
      const text = rest.join(' ')

      if (sub === 'add') {
        if (!text) return { response: 'Usage: /todo add [task]' }
        const p = path.join(vaultPath, 'todolist.md')
        const c = fs.readFileSync(p, 'utf8')
        fs.writeFileSync(p, c.replace('## Today\n', `## Today\n- [ ] ${text}\n`))
        return { response: `Added: "${text}"` }
      }
      if (sub === 'done') {
        if (!text) return { response: 'Usage: /todo done [task]' }
        const p  = path.join(vaultPath, 'todolist.md')
        let c    = fs.readFileSync(p, 'utf8')
        const rx = new RegExp(`- \\[ \\] (.{0,30}${text.slice(0,20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.{0,30})`, 'i')
        c = c.replace(rx, (_, t) => `- [x] ${t}`)
        fs.writeFileSync(p, c)
        return { response: `Done: "${text}"` }
      }
      if (sub === 'list') {
        return { response: readNote(vaultPath, 'todolist.md') }
      }
      if (sub === 'prioritise' || sub === 'prioritize') {
        const content = readNote(vaultPath, 'todolist.md')
        const resp = await askAnchor(`Suggest the best priority order for today's tasks:\n\n${content}`, history)
        return { response: resp }
      }
      return { response: 'Usage: /todo [add|done|list|prioritise] ...' }
    }

    // ── PROJECTS ──────────────────────────────────────────────────────────────
    case 'project': {
      const [sub, ...rest] = (args || '').split(' ')
      const name = rest.join(' ')

      if (sub === 'new') {
        if (!name) return { response: 'Usage: /project new [name]' }
        const dir   = path.join(vaultPath, 'Projects', name)
        const date  = today()
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, 'brief.md'),
          `# ${name}\n\nCreated: ${date}\n\n## Overview\n\n## Goals\n\n## Key people\n\n## Timeline\n`)
        fs.writeFileSync(path.join(dir, 'notes.md'),   `# ${name} — Notes\n\n`)
        fs.writeFileSync(path.join(dir, 'actions.md'), `# ${name} — Actions\n\n## Open\n\n## Done\n`)
        const pp = path.join(vaultPath, 'projects.md')
        const c  = fs.readFileSync(pp, 'utf8')
        fs.writeFileSync(pp, c.replace('## Active\n', `## Active\n| ${name} | Active | — | High |\n`))
        return { response: `Project "${name}" created at Projects/${name}/` }
      }
      if (sub === 'list') {
        return { response: readNote(vaultPath, 'projects.md') }
      }
      if (sub === 'summary') {
        if (!name) return { response: 'Usage: /project summary [name]' }
        const briefPath = path.join('Projects', name, 'brief.md')
        if (!noteExists(vaultPath, briefPath)) return { response: `Project "${name}" not found.` }
        const content = readNote(vaultPath, briefPath)
        const resp    = await askAnchor(`Summarise this project:\n\n${content}`, history)
        return { response: resp }
      }
      if (sub === 'done') {
        if (!name) return { response: 'Usage: /project done [name]' }
        const src = path.join(vaultPath, 'Projects', name)
        const dst = path.join(vaultPath, 'Archive', name)
        if (!fs.existsSync(src)) return { response: `Project "${name}" not found.` }
        fs.renameSync(src, dst)
        let p = readNote(vaultPath, 'projects.md')
        p = p.replace(new RegExp(`\\| ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| Active .*\\|`), '')
        p += `\n| ${name} | ${today()} | Archived |`
        writeNote(vaultPath, 'projects.md', p)
        return { response: `Project "${name}" archived.` }
      }
      return { response: 'Usage: /project [new|list|summary|done] ...' }
    }

    // ── PEOPLE ────────────────────────────────────────────────────────────────
    case 'person': {
      const parts = (args || '').split(' ')
      if (parts[0] === 'add') {
        const [, name, role, company] = parts
        if (!name) return { response: 'Usage: /person add [name] [role] [company]' }
        const date  = today()
        const entry = `\n## ${name}\nRole: ${role || ''} at ${company || ''}\nRelationship:\nLast contact: ${date}\nKey facts:\n- \nProjects: \nNotes: \n\n---\n`
        fs.appendFileSync(path.join(vaultPath, 'people.md'), entry)
        return { response: `Added ${name} to people.md` }
      }
      const name = (args || '').trim()
      if (name) {
        const { findRelevant } = require('./search')
        const people  = readNote(vaultPath, 'people.md')
        const section = people.split('---').find(s =>
          s.toLowerCase().includes(name.toLowerCase())
        )
        const vaultCtx = findRelevant(name)
        return {
          response: [
            section ? `People.md:\n${section.trim()}` : `No entry for ${name}.`,
            vaultCtx ? `\nVault:\n${vaultCtx}` : '',
          ].filter(Boolean).join('\n\n')
        }
      }
      return { response: 'Usage: /person [name] or /person add [name] [role] [company]' }
    }

    // ── IDEA ──────────────────────────────────────────────────────────────────
    case 'idea': {
      const [sub, ...rest] = (args || '').split(' ')
      if (sub === 'develop') {
        const title = rest.join(' ')
        if (!title) return { response: 'Usage: /idea develop [title]' }
        const resp = await askAnchor(`Develop this idea with 5 specific, actionable next steps: ${title}`, history)
        return { response: resp }
      }
      if (args) {
        const date  = today()
        const entry = `\n## ${args.slice(0, 50)}\nDate: ${date}\nStatus: RAW\n\n${args}\n\n---\n`
        fs.appendFileSync(path.join(vaultPath, 'ideas.md'), entry)
        return { response: `Idea captured: "${args.slice(0, 60)}"` }
      }
      return { response: readNote(vaultPath, 'ideas.md') }
    }

    // ── DECISION ──────────────────────────────────────────────────────────────
    case 'decision': {
      if (!args) return { response: 'Usage: /decision [title]' }
      const date  = today()
      const entry = `\n## ${args}\nDate: ${date}\nContext: \nOptions considered:\n- \n- \nDecision: \nReasoning: \nOutcome: \n\n---\n`
      fs.appendFileSync(path.join(vaultPath, 'decisions.md'), entry)
      return { response: `Decision template created: "${args}"` }
    }

    // ── WIN ───────────────────────────────────────────────────────────────────
    case 'win': {
      if (!args) return { response: 'Usage: /win [description]' }
      const date  = today()
      const entry = `\n## ${args}\nDate: ${date}\nCategory: \nImpact: \n\n---\n`
      fs.appendFileSync(path.join(vaultPath, 'wins.md'), entry)
      return { response: `Win logged: "${args}"` }
    }

    // ── SKILLS ────────────────────────────────────────────────────────────────
    case 'learn': {
      if (!args || !args.includes(':')) return { response: 'Usage: /learn [name]: [instructions]' }
      const [name, ...instrParts] = args.split(':')
      return { response: teachSkill(name.trim(), instrParts.join(':').trim(), vaultPath) }
    }

    case 'skills':
      return { response: listSkills(vaultPath) }

    case 'run': {
      if (!args) return { response: 'Usage: /run [skill name]' }
      const resp = await runSkill(args, vaultPath)
      return { response: resp }
    }

    // ── TASKS ─────────────────────────────────────────────────────────────────
    case 'task': {
      const [sub, ...rest] = (args || '').split(' ')
      if (sub === 'list') {
        return { response: readNote(vaultPath, 'tasks.md') }
      }
      if (sub === 'add') {
        const text = rest.join(' ')
        if (!text) return { response: 'Usage: /task add [schedule] [task]' }
        fs.appendFileSync(path.join(vaultPath, 'tasks.md'), `\n| ${text} | User defined | — |`)
        return { response: `Task added: "${text}"` }
      }
      if (sub === 'run') {
        const name = rest.join(' ')
        const resp = await runSkill(name, vaultPath)
        return { response: resp }
      }
      return { response: 'Usage: /task [add|list|run] ...' }
    }

    // ── CRON SKILLS ───────────────────────────────────────────────────────────
    case 'briefing':
      return { response: await runSkill('daily briefing', vaultPath) }

    case 'digest':
      return { response: await runSkill('daily digest', vaultPath) }

    case 'review':
      return { response: await runSkill('weekly review', vaultPath) }

    // ── STATUS ────────────────────────────────────────────────────────────────
    case 'status': {
      const { readVault }  = require('./vault')
      const mem   = readMemory(vaultPath)
      const ses   = readSession(vaultPath)
      const notes = readVault(vaultPath)
      const lines = [
        `Vault:        ${vaultPath}`,
        `Notes:        ${notes.length}`,
        `Memory facts: ${(mem.userDefined || []).length}`,
        `Model:        llama3.2:3b`,
        `Last session: ${ses.lastSession ? ses.lastSession.date + ' — ' + ses.lastSession.topic : 'None'}`,
        `Privacy:      ✓ 100% local — zero data egress`,
      ]
      return { response: lines.join('\n') }
    }

    case 'vault':
      return { response: vaultPath }

    case 'help':
      return { response: HELP_TEXT }

    case 'exit':
      return { response: 'Saving session...', action: 'exit' }

    default:
      return { response: `Unknown command: /${cmd}. Type /help for all commands.` }
  }
}

const HELP_TEXT = `
/remember [fact]                    Permanent memory storage
/forget [topic]                     Remove from memory
/recap                              Everything Anchor knows about you
/newchat                            Fresh conversation, keep memory
/tone [description]                 Update communication style
/status                             System status
/help                               This list
/exit                               Save session and exit

/goal add [goal]                    Add a goal
/goal list                          Show goals
/goal review                        AI reviews progress
/goal done [goal]                   Mark done, log as win

/project new [name]                 Create project + templates
/project list                       Show active projects
/project summary [name]             AI summarises project
/project done [name]                Archive project

/todo add [task]                    Add to today's list
/todo done [task]                   Mark complete
/todo list                          Show todos
/todo prioritise                    AI priority order

/person add [name] [role] [co]      Add to people.md
/person [name]                      Full context on a person

/idea [text]                        Capture idea
/idea develop [title]               AI develops idea
/decision [title]                   Log a decision
/win [description]                  Log a win

/learn [name]: [instructions]       Teach a new skill
/skills                             List all skills
/run [skill]                        Run a skill now

/task add [schedule] [task]         Add scheduled task
/task list                          Show all tasks
/task run [name]                    Run a task now

/briefing                           Morning briefing now
/digest                             Daily digest now
/review                             Weekly review now
`.trim()

module.exports = { handleCommand }
