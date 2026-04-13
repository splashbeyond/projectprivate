'use strict'

// Event-driven memory. Fires on conversation events, not on a clock.
// Entity extraction async after every message.
// now.md rewritten after 45s idle using structured rewriter.
// Weekly synthesis is the only cron job (in cron.js).

const fs   = require('fs')
const path = require('path')
const { ollamaCall }  = require('./ollama-manager')
const { safeParseJSON } = require('./safe-parse')
const { logError, updateHealth } = require('./health')
const { writeFile, readMemory, writeMemory, readSession, writeSession } = require('./vault')

class MemoryEngine {
  constructor(vaultPath) {
    this.vaultPath         = vaultPath
    this.exchangeCount     = 0
    this.idleTimer         = null
    this.isProcessing      = false
    this.conversationBuffer = []
  }

  async onExchange(userMessage, aiResponse) {
    this.exchangeCount++
    this.conversationBuffer.push(
      { role: 'user',      content: userMessage },
      { role: 'assistant', content: aiResponse  }
    )
    this.appendConversationLog(userMessage, aiResponse)
    this.extractEntitiesAsync(userMessage + ' ' + aiResponse)
    if (this.exchangeCount % 6 === 0) this.compressToDigestAsync()
    this.resetIdleTimer()
  }

  appendConversationLog(userMessage, aiResponse) {
    try {
      const today   = new Date().toISOString().split('T')[0]
      const logPath = path.join(this.vaultPath, 'Conversations', `${today}.md`)
      const dir     = path.dirname(logPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const time = new Date().toLocaleTimeString()
      fs.appendFileSync(logPath,
        `\n**[${time}]**\n**You:** ${userMessage}\n**Anchor:** ${aiResponse}\n`
      )
    } catch (e) { logError('appendConversationLog', e) }
  }

  extractEntitiesAsync(text) {
    if (!text || text.split(/\s+/).length < 5) return

    ollamaCall([{
      role: 'system',
      content: `Extract entities relevant to the user's real work.
Return JSON: {people:[{name,role?,company?}], projects:[], decisions:[], deadlines:[]}.
Rules:
- People: real contacts only (not celebrities, not historical figures). Include role/company if mentioned.
- Projects: only active or planned real work.
- Decisions: only definitive statements, not hypotheticals.
- Deadlines: only specific dates tied to specific tasks.
- When uncertain: empty array.
Example people: [{"name":"John Smith","role":"VP Sales","company":"Acme"}]`,
    }, { role: 'user', content: text }], 180)
    .then(result => {
      const entities = safeParseJSON(result, {})
      if (entities.people?.length) {
        entities.people
          .filter(p => p && (typeof p === 'string' ? p.length > 2 : p.name?.length > 2))
          .forEach(p => {
            if (typeof p === 'string') {
              this.upsertPerson(p, {})
            } else {
              this.upsertPerson(p.name, { role: p.role, company: p.company })
            }
          })
      }
      if (entities.projects?.length) {
        entities.projects.filter(p => typeof p === 'string')
          .forEach(p => this.appendProjectLog(p, text))
      }
      // Deadlines intentionally not written to now.md — model extraction is
      // too noisy and corrupts user-owned tasks. Use todo_add intent instead.
      this.updateEntityIndex(entities)
    })
    .catch(e => logError('extractEntitiesAsync', e))
  }

  compressToDigestAsync() {
    if (this.isProcessing) return
    this.isProcessing = true

    const recent = this.conversationBuffer.slice(-12)
    ollamaCall([{
      role: 'system',
      content: `Compress into under 120 tokens.
Key decisions, people mentioned, actions taken, open questions.
Bullet points. Specific not general.`,
    }, {
      role: 'user',
      content: recent.map(m => `${m.role}: ${m.content}`).join('\n'),
    }], 120)
    .then(summary => {
      if (!summary.trim()) return
      const today      = new Date().toISOString().split('T')[0]
      const digestPath = path.join(this.vaultPath, 'Digests', `${today}.md`)
      const dir        = path.dirname(digestPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(digestPath,
        `\n[${new Date().toLocaleTimeString()}]\n${summary}\n`
      )
      updateHealth('lastDigestUpdate', new Date().toISOString())
      this.isProcessing = false
    })
    .catch(e => { logError('compressToDigestAsync', e); this.isProcessing = false })
  }

  resetIdleTimer() {
    clearTimeout(this.idleTimer)
    // Idle: only consolidate memory (entities/facts). Never touch now.md on idle —
    // the model rewrites it with hallucinated content. now.md is user-owned data.
    this.idleTimer = setTimeout(() => this.runIdleUpdate(), 300000) // 5 min
  }

  async runIdleUpdate() {
    if (this.isProcessing) return
    this.isProcessing = true
    try {
      await this.consolidateMemory()
      updateHealth('lastIdleUpdate', new Date().toISOString())
    } catch (e) { logError('runIdleUpdate', e) }
    this.isProcessing = false
  }

  async rewriteNow() {
    // PROTECTED: never let the model overwrite user tasks in ## This week.
    // Model only synthesises ## Active projects and ## Waiting on from digest.
    const digest = this.getLatestDigest()
    const today  = new Date().toISOString().split('T')[0]

    // Preserve all existing checkbox lines — these are user-owned
    const nowPath = path.join(this.vaultPath, 'now.md')
    const existing = fs.existsSync(nowPath) ? fs.readFileSync(nowPath, 'utf8') : ''
    const taskLines = existing.split('\n')
      .filter(l => /^- \[[ x]\]/.test(l))
      .join('\n')

    if (!digest) {
      // No digest yet — just rewrite with existing tasks preserved
      writeFile(this.vaultPath, 'now.md',
        `# Now — ${today}\n\n## This week\n${taskLines || '- No open tasks'}\n\n## Active projects\n- Anchor AI\n\n## Waiting on\n- Nothing waiting\n`
      )
      return
    }

    const [projects, waiting] = await Promise.all([
      ollamaCall([{
        role: 'system',
        content: 'List active projects only. One bullet per line: - [name]. Max 5. Nothing else.',
      }, { role: 'user', content: digest }], 80),

      ollamaCall([{
        role: 'system',
        content: 'List items waiting on others. Format: - [item] — [person]. Return only "- Nothing waiting" if none. Nothing else.',
      }, { role: 'user', content: digest }], 60),
    ])

    writeFile(this.vaultPath, 'now.md',
      `# Now — ${today}\n\n## This week\n${taskLines || '- No open tasks'}\n\n## Active projects\n${projects.trim() || '- No active projects'}\n\n## Waiting on\n${waiting.trim() || '- Nothing waiting'}\n`
    )
    updateHealth('lastNowRewrite', new Date().toISOString())
  }

  async consolidateMemory() {
    const memory = readMemory(this.vaultPath)
    const digest = this.getLatestDigest()
    if (!digest) return

    const raw = await ollamaCall([{
      role: 'system',
      content: `Extract entities from today and merge with existing memory.
Return ONLY valid JSON:
entities (object: name to {type, keyFacts, lastMentioned}),
userDefined (array — keep ALL existing, add new only if found).`,
    }, {
      role: 'user',
      content: JSON.stringify({
        existing: { entities: memory.entities, userDefined: memory.userDefined },
        today:    digest,
      }),
    }], 400)

    const parsed = safeParseJSON(raw, {})
    if (parsed.entities || parsed.userDefined) {
      writeMemory(this.vaultPath, {
        ...memory,
        entities:    parsed.entities    || memory.entities,
        userDefined: parsed.userDefined || memory.userDefined,
        lastUpdated: new Date().toISOString(),
      })
      updateHealth('lastMemoryConsolidation', new Date().toISOString())
    }
  }

  readNow() {
    const p = path.join(this.vaultPath, 'now.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  }

  getLatestDigest() {
    const digestDir = path.join(this.vaultPath, 'Digests')
    if (!fs.existsSync(digestDir)) return null
    const files = fs.readdirSync(digestDir)
      .filter(f => f.endsWith('.md')).sort().reverse()
    if (!files.length) return null
    return fs.readFileSync(path.join(digestDir, files[0]), 'utf8')
  }

  upsertPerson(name, { role = '', company = '' } = {}) {
    try {
      if (!name || name.length < 2 || name.length > 80) return
      const p       = path.join(this.vaultPath, 'people.md')
      const content = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '# People\n\n'
      const today   = new Date().toISOString().split('T')[0]

      if (content.includes(`## ${name}`)) {
        // Update role/company if we now have new info and the field is still blank
        if ((role || company) && fs.existsSync(p)) {
          let updated = fs.readFileSync(p, 'utf8')
          if (role && updated.match(new RegExp(`## ${name}[\\s\\S]+?Role:\\s*\\n`))) {
            updated = updated.replace(
              new RegExp(`(## ${name}[\\s\\S]+?Role:)\\s*\\n`),
              `$1 ${role}\n`
            )
          }
          if (company && updated.match(new RegExp(`## ${name}[\\s\\S]+?Company:\\s*\\n`))) {
            updated = updated.replace(
              new RegExp(`(## ${name}[\\s\\S]+?Company:)\\s*\\n`),
              `$1 ${company}\n`
            )
          }
          fs.writeFileSync(p, updated)
        }
        return
      }

      const roleLine    = role    ? `Role: ${role}\n`    : 'Role:\n'
      const companyLine = company ? `Company: ${company}\n` : 'Company:\n'
      fs.appendFileSync(p,
        `\n## ${name}\n${roleLine}${companyLine}First mentioned: ${today}\nKey facts:\n- \n\n---\n`
      )
    } catch {}
  }

  appendProjectLog(projectName, context) {
    try {
      const logPath = path.join(this.vaultPath, 'Projects', projectName, 'log.md')
      const dir     = path.dirname(logPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(logPath,
        `\n[${new Date().toLocaleDateString()}]: ${context.slice(0, 200)}\n`
      )
    } catch {}
  }

  addToNow(deadline) {
    try {
      const nowPath = path.join(this.vaultPath, 'now.md')
      if (!fs.existsSync(nowPath)) return
      let content = fs.readFileSync(nowPath, 'utf8')
      if (content.includes(deadline)) return
      content = content.replace(
        '## This week\n',
        `## This week\n- [ ] ${deadline}\n`
      )
      fs.writeFileSync(nowPath, content)
    } catch {}
  }

  updateEntityIndex(entities) {
    try {
      const memory  = readMemory(this.vaultPath)
      let changed   = false
      if (entities.people?.length) {
        entities.people.forEach(p => {
          if (typeof p !== 'string') return
          const now = new Date().toISOString()
          if (!memory.entities[p]) {
            memory.entities[p] = { type: 'person', firstMentioned: now, lastMentioned: now }
          } else {
            memory.entities[p].lastMentioned = now
          }
          changed = true
        })
      }
      if (changed) writeMemory(this.vaultPath, memory)
    } catch {}
  }

  async onAppClose(conversation) {
    clearTimeout(this.idleTimer)
    if (!conversation.length) return
    try {
      const [topic, openThreadsRaw] = await Promise.all([
        ollamaCall([{
          role: 'system',
          content: 'One sentence: what was the main topic of this conversation?',
        }, {
          role: 'user',
          content: conversation.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n'),
        }], 60),

        ollamaCall([{
          role: 'system',
          content: 'List unresolved questions or open items. Return JSON array of strings. Max 3. Empty array if none.',
        }, {
          role: 'user',
          content: conversation.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n'),
        }], 100),
      ])

      const openThreads = safeParseJSON(openThreadsRaw, [])
      const session     = readSession(this.vaultPath) || {}
      session.lastSession = {
        date:         new Date().toISOString(),
        topic:        topic.trim(),
        openThreads:  Array.isArray(openThreads) ? openThreads : [],
        messageCount: conversation.length,
      }
      writeSession(this.vaultPath, session)
      await this.rewriteNow()
    } catch (e) { logError('onAppClose', e) }
  }

  enforceRetention() {
    try {
      const convDir = path.join(this.vaultPath, 'Conversations')
      if (!fs.existsSync(convDir)) return
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 30)
      fs.readdirSync(convDir).filter(f => f.endsWith('.md')).forEach(file => {
        try {
          const fileDate    = new Date(file.replace('.md', ''))
          if (fileDate < cutoff) {
            const digestExists = fs.existsSync(
              path.join(this.vaultPath, 'Digests', file)
            )
            if (digestExists) fs.unlinkSync(path.join(convDir, file))
          }
        } catch {}
      })
    } catch (e) { logError('enforceRetention', e) }
  }
}

module.exports = { MemoryEngine }
