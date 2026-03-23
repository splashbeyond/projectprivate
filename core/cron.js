'use strict'

const cron = require('node-cron')
const fs   = require('fs')
const path = require('path')

let vaultPath = null
let tasks     = []

function setVaultPath(p) { vaultPath = p }

function today() { return new Date().toISOString().split('T')[0] }

// ── Cron tasks ────────────────────────────────────────────────────────────────

async function runDailyDigest() {
  if (!vaultPath) return
  const { askAnchor }  = require('./ollama')
  const { findRelevant } = require('./search')
  const ctx  = findRelevant('today notes updates')
  const resp = await askAnchor(`Create a daily digest of today's notes and activity:\n\n${ctx}`, [])
  const out  = path.join(vaultPath, 'Daily Digests', `${today()}.md`)
  fs.writeFileSync(out, `# Daily Digest — ${today()}\n\n${resp}\n`, 'utf8')
}

async function runMorningBriefing() {
  if (!vaultPath) return
  const { runSkill }   = require('./skills')
  const resp = await runSkill('daily briefing', vaultPath)
  const out  = path.join(vaultPath, 'Morning Briefings', `${today()}.md`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, `# Morning Briefing — ${today()}\n\n${resp}\n`, 'utf8')
}

async function runWeeklyReview() {
  if (!vaultPath) return
  const { runSkill } = require('./skills')
  const resp = await runSkill('weekly review', vaultPath)
  const out  = path.join(vaultPath, 'Weekly', `${today()}-review.md`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, `# Weekly Review — ${today()}\n\n${resp}\n`, 'utf8')
}

async function runWeeklyPriorities() {
  if (!vaultPath) return
  const { askAnchor }   = require('./ollama')
  const { findRelevant } = require('./search')
  const ctx  = findRelevant('goals priorities projects this week')
  const resp = await askAnchor(`What should be my top priorities this week? Base it on my goals and active projects:\n\n${ctx}`, [])
  const out  = path.join(vaultPath, 'Weekly', `${today()}-priorities.md`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, `# Weekly Priorities — ${today()}\n\n${resp}\n`, 'utf8')
}

async function runExtractTodos() {
  if (!vaultPath) return
  const { askOllamaStructured } = require('./ollama')
  const { getNotesModifiedToday } = require('./vault')
  const notes = getNotesModifiedToday(vaultPath)
  if (!notes.length) return
  const content = notes.map(n => n.content).join('\n\n---\n\n')
  const todoPath = path.join(vaultPath, 'todolist.md')
  const existing = fs.readFileSync(todoPath, 'utf8')
  const resp = await askOllamaStructured(
    'Extract all action items and tasks from these notes. Format each as: - [ ] [task]',
    content,
    '- [ ] [task] — [owner if mentioned] — [deadline if mentioned]'
  )
  // Append new items that don't already exist
  const newItems = resp.split('\n')
    .filter(line => line.startsWith('- [ ]'))
    .filter(line => !existing.includes(line.slice(6, 30)))
  if (newItems.length) {
    fs.writeFileSync(todoPath, existing.replace('## Today\n', `## Today\n${newItems.join('\n')}\n`))
  }
}

async function runMemoryConsolidation() {
  if (!vaultPath) return
  const { askOllamaStructured }  = require('./ollama')
  const { readMemory, writeMemory } = require('./memory')
  const { getNotesModifiedToday }   = require('./vault')

  const memory    = readMemory(vaultPath)
  const todayNotes = getNotesModifiedToday(vaultPath)
  if (!todayNotes.length) return

  const updated = await askOllamaStructured(
    'Extract entities from today\'s activity and merge with existing memory. Return ONLY valid JSON.',
    JSON.stringify({
      existing:  memory,
      todayNotes: todayNotes.map(n => ({ name: n.name, content: n.content.slice(0, 500) })),
    }),
    '{ "entities": {}, "userDefined": [] }'
  )

  try {
    const parsed = JSON.parse(updated.match(/\{[\s\S]+\}/)?.[0] || '{}')
    writeMemory(vaultPath, { ...memory, ...parsed })
  } catch (e) {
    console.error('Memory consolidation failed:', e.message)
  }
}

// ── Schedule all tasks ────────────────────────────────────────────────────────

function startCron(vp) {
  if (vp) vaultPath = vp

  // Stop any existing tasks
  tasks.forEach(t => t.stop())
  tasks = []

  // 6am daily — web monitor
  tasks.push(cron.schedule('0 6 * * *', () => {
    require('./monitor').runMonitor(vaultPath)
  }))

  // 7am daily — morning briefing
  tasks.push(cron.schedule('0 7 * * *', runMorningBriefing))

  // 7am Monday — weekly priorities
  tasks.push(cron.schedule('0 7 * * 1', runWeeklyPriorities))

  // 5pm Friday — weekly review
  tasks.push(cron.schedule('0 17 * * 5', runWeeklyReview))

  // 11pm daily — daily digest
  tasks.push(cron.schedule('0 23 * * *', runDailyDigest))

  // 11:15pm daily — extract todos
  tasks.push(cron.schedule('15 23 * * *', runExtractTodos))

  // 11:30pm daily — memory consolidation
  tasks.push(cron.schedule('30 23 * * *', runMemoryConsolidation))
}

function stopCron() {
  tasks.forEach(t => t.stop())
  tasks = []
}

module.exports = {
  startCron, stopCron, setVaultPath,
  runDailyDigest, runMorningBriefing, runWeeklyReview,
  runExtractTodos, runMemoryConsolidation,
}
