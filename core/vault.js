'use strict'

// All file reads and writes. Single source of truth for disk operations.

const fs      = require('fs')
const path    = require('path')
const chokidar = require('chokidar')
const { logError } = require('./health')

const today = () => new Date().toISOString().split('T')[0]

const SUBDIRS = [
  'Notes', 'Projects', 'Imports', 'Web',
  'Conversations', 'Digests', 'Synthesis',
  'Daily Digests', 'Morning Briefings', 'Weekly', 'Web Monitor',
  'Archive', 'Chats',
]

// ── Vault setup ───────────────────────────────────────────────────────────────

function ensureVault(vaultPath) {
  if (!fs.existsSync(vaultPath)) fs.mkdirSync(vaultPath, { recursive: true })

  for (const dir of SUBDIRS) {
    const full = path.join(vaultPath, dir)
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true })
  }

  const templates = {
    'identity.md': `# Identity\n\nI am Anchor. I work for [USER_NAME].\nI run 100% locally. Nothing leaves this machine.\n\n## [USER_NAME]\nRole:\nIndustry:\nCommunication: conversational\n\n## How I behave\n- Answer from vault context first, always\n- Say "I don't have that" rather than guess\n- Never hallucinate dates, numbers, names, or facts\n\n## Confidence rules\nClear evidence: answer directly\nPartial evidence: "Based on [Note], it seems..."\nNo evidence: "I don't have that in my vault"\n\n## Tone\nDirect. Warm. Sound like a colleague.\n\n## Onboarding complete\nfalse`,
    'now.md': `# Now — ${today()}\n\n## This week\n- [ ] Add your first task\n\n## Active projects\n- No active projects yet\n\n## Waiting on\n- Nothing waiting`,
    'people.md': '# People\n\n',
    'skills.md':  `# Skills\n\n---\n\n## daily-briefing\nversion: 1\ncreated: ${today()}\nusageCount: 0\nlastUsed: never\nschedule: none\nparams: none\nautoSuggested: false\n\n### Trigger phrases\nmorning briefing, daily briefing, catch me up, what's today, what should i focus on\n\n### Instructions\n1. Read now.md for today's tasks and priorities\n2. Summarise: top 3 priorities, waiting items, urgent flags\n3. Keep under 150 words\n4. End with: "Where do you want to start?"\n\n### Output\nDisplay inline\n\n### Feedback\nsuccessCount: 0\nfailCount: 0\nlastFeedback: none\n\n---\n`,
    'ANCHOR.md':  `# ⚓ Anchor\n\nYou are Anchor — a private AI workspace.\nYou run 100% locally. Nothing leaves this machine.\nAnswer from vault context first. Cite sources.\n`,
  }

  for (const [filename, content] of Object.entries(templates)) {
    const full = path.join(vaultPath, filename)
    if (!fs.existsSync(full)) fs.writeFileSync(full, content, 'utf8')
  }

  const jsonDefaults = {
    'anchor-memory.json': {
      entities: {}, userDefined: [], userName: '', anchorName: 'Anchor',
      role: '', industry: '', goals: '', commStyle: 'conversational',
      workingHours: '9am-6pm', skillUsage: {}, lastUpdated: today(),
    },
    'anchor-session.json': {
      onboardingComplete: false, identityConfirmed: false, lastSession: null,
    },
    'anchor-health.json': {
      errors: [], lastHealthCheck: today(), ollamaStatus: 'unknown',
      lastMemoryConsolidation: 'never', lastNowRewrite: 'never',
      lastWeeklySynthesis: 'never',
    },
  }

  for (const [filename, data] of Object.entries(jsonDefaults)) {
    const full = path.join(vaultPath, filename)
    if (!fs.existsSync(full)) fs.writeFileSync(full, JSON.stringify(data, null, 2))
  }
}

// Alias — keeps old callers working
const createVault = ensureVault

function resetVault(vaultPath) {
  const keep = [
    'identity.md', 'people.md', 'skills.md', 'Notes', 'Projects',
    'Imports', 'Chats', 'ANCHOR.md',
  ]
  try {
    const entries = fs.readdirSync(vaultPath)
    for (const entry of entries) {
      if (keep.some(k => entry === k || entry.startsWith(k))) continue
      const full = path.join(vaultPath, entry)
      fs.rmSync(full, { recursive: true, force: true })
    }
    ensureVault(vaultPath)
  } catch (e) { logError('resetVault', e) }
}

function hardResetVault(vaultPath) {
  try {
    fs.rmSync(vaultPath, { recursive: true, force: true })
    ensureVault(vaultPath)
  } catch (e) { logError('hardResetVault', e) }
}

// ── File I/O ──────────────────────────────────────────────────────────────────

function readFile(vaultPath, relPath) {
  const filePath = path.join(vaultPath, relPath)
  if (!fs.existsSync(filePath)) return null
  try { return fs.readFileSync(filePath, 'utf8') }
  catch (e) { logError('readFile', e); return null }
}

// readNote — alias matching old signature readNote(vaultPath, relPath)
const readNote = readFile

function noteExists(vaultPath, relPath) {
  return fs.existsSync(path.join(vaultPath, relPath))
}

function writeFile(vaultPath, relPath, content) {
  const filePath = path.join(vaultPath, relPath)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  try { fs.writeFileSync(filePath, content, 'utf8') }
  catch (e) { logError('writeFile', e) }
}

const writeNote = writeFile

function appendNote(vaultPath, relPath, content) {
  const filePath = path.join(vaultPath, relPath)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  try { fs.appendFileSync(filePath, content, 'utf8') }
  catch (e) { logError('appendNote', e) }
}

// ── Vault scan ────────────────────────────────────────────────────────────────

function readVault(vaultPath) {
  const results = []
  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isDirectory() && !e.name.startsWith('.')) { walk(full); continue }
        if (!e.name.endsWith('.md') || e.name.startsWith('.')) continue
        try {
          const stat = fs.statSync(full)
          results.push({
            id:           full,
            name:         e.name.replace('.md', ''),
            path:         full,
            relativePath: path.relative(vaultPath, full),
            relPath:      path.relative(vaultPath, full),
            content:      fs.readFileSync(full, 'utf8').slice(0, 3000),
            modified:     stat.mtime,
            mtime:        stat.mtime,
          })
        } catch {}
      }
    } catch (e) { logError('readVault:walk', e) }
  }
  walk(vaultPath)
  return results
}

function getNotesModifiedToday(vaultPath) {
  const todayStr = today()
  return readVault(vaultPath).filter(n => {
    return n.mtime && n.mtime.toISOString().startsWith(todayStr)
  })
}

// ── Memory & session ──────────────────────────────────────────────────────────

function readMemory(vaultPath) {
  const p = path.join(vaultPath, 'anchor-memory.json')
  if (!fs.existsSync(p)) return {
    entities: {}, userDefined: [], userName: '', anchorName: 'Anchor',
    role: '', industry: '', goals: '', commStyle: 'conversational',
    workingHours: '9am-6pm', skillUsage: {}, lastUpdated: today(),
  }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) }
  catch { return { entities: {}, userDefined: [] } }
}

function writeMemory(vaultPath, data) {
  const p = path.join(vaultPath, 'anchor-memory.json')
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)) }
  catch (e) { logError('writeMemory', e) }
}

function readSession(vaultPath) {
  const p = path.join(vaultPath, 'anchor-session.json')
  if (!fs.existsSync(p)) return { onboardingComplete: false, identityConfirmed: false, lastSession: null }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) }
  catch { return { onboardingComplete: false, identityConfirmed: false, lastSession: null } }
}

function writeSession(vaultPath, data) {
  const p = path.join(vaultPath, 'anchor-session.json')
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)) }
  catch (e) { logError('writeSession', e) }
}

// ── Watcher ───────────────────────────────────────────────────────────────────

function watchVault(vaultPath, onChange) {
  const watcher = chokidar.watch(vaultPath, {
    ignored:       [/(^|[\/\\])\.\./, /\.anchor-index\.json$/, /anchor-health\.json$/],
    persistent:    true,
    ignoreInitial: true,
  })
  watcher.on('add',    (p) => onChange('add', p))
  watcher.on('change', (p) => onChange('change', p))
  watcher.on('unlink', (p) => onChange('unlink', p))
  return watcher
}

// ── Backlinks ─────────────────────────────────────────────────────────────────

function buildBacklinks(vaultPath) {
  const notes = readVault(vaultPath)
  const backlinks = {}
  for (const note of notes) {
    const links = [...(note.content || '').matchAll(/\[\[([^\]]+)\]\]/g)]
      .map(m => m[1].split('|')[0].trim())
    for (const link of links) {
      if (!backlinks[link]) backlinks[link] = []
      if (!backlinks[link].includes(note.name)) backlinks[link].push(note.name)
    }
  }
  return backlinks
}

module.exports = {
  ensureVault, createVault, resetVault, hardResetVault,
  readFile, readNote, noteExists, writeFile, writeNote, appendNote,
  readVault, getNotesModifiedToday,
  readMemory, writeMemory, readSession, writeSession,
  watchVault, buildBacklinks,
}
