'use strict'

const fs      = require('fs')
const path    = require('path')
const chokidar = require('chokidar')
const { TEMPLATES } = require('./templates')

// ── Vault init ────────────────────────────────────────────────────────────────

function createVault(vaultPath) {
  const dirs = [
    vaultPath,
    path.join(vaultPath, 'Projects'),
    path.join(vaultPath, 'Daily Digests'),
    path.join(vaultPath, 'Morning Briefings'),
    path.join(vaultPath, 'Weekly'),
    path.join(vaultPath, 'Web Monitor'),
    path.join(vaultPath, 'Archive'),
  ]
  for (const d of dirs) fs.mkdirSync(d, { recursive: true })

  // Write template files only if they don't already exist
  for (const [name, fn] of Object.entries(TEMPLATES)) {
    const p = path.join(vaultPath, name)
    if (!fs.existsSync(p)) fs.writeFileSync(p, fn(), 'utf8')
  }

  // Write memory/session defaults if missing
  const memP = path.join(vaultPath, 'anchor-memory.json')
  const sesP = path.join(vaultPath, 'anchor-session.json')
  const { DEFAULT_MEMORY, DEFAULT_SESSION } = require('./templates')
  if (!fs.existsSync(memP)) fs.writeFileSync(memP, JSON.stringify(DEFAULT_MEMORY(), null, 2), 'utf8')
  if (!fs.existsSync(sesP)) fs.writeFileSync(sesP, JSON.stringify(DEFAULT_SESSION(), null, 2), 'utf8')
}

function resetVault(vaultPath) {
  // Soft reset — rewrite all system templates, wipe memory + session
  // Does NOT delete user notes
  const { DEFAULT_MEMORY, DEFAULT_SESSION } = require('./templates')
  for (const [name, fn] of Object.entries(TEMPLATES)) {
    fs.writeFileSync(path.join(vaultPath, name), fn(), 'utf8')
  }
  fs.writeFileSync(
    path.join(vaultPath, 'anchor-memory.json'),
    JSON.stringify(DEFAULT_MEMORY(), null, 2), 'utf8'
  )
  fs.writeFileSync(
    path.join(vaultPath, 'anchor-session.json'),
    JSON.stringify(DEFAULT_SESSION(), null, 2), 'utf8'
  )
}

function hardResetVault(vaultPath) {
  fs.rmSync(vaultPath, { recursive: true, force: true })
}

// ── Read/write notes ──────────────────────────────────────────────────────────

function readNote(vaultPath, relPath) {
  return fs.readFileSync(path.join(vaultPath, relPath), 'utf8')
}

function writeNote(vaultPath, relPath, content) {
  const full = path.join(vaultPath, relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf8')
}

function appendNote(vaultPath, relPath, content) {
  const full = path.join(vaultPath, relPath)
  fs.appendFileSync(full, content, 'utf8')
}

function noteExists(vaultPath, relPath) {
  return fs.existsSync(path.join(vaultPath, relPath))
}

// ── Walk vault — returns array of { name, relPath, content, mtime } ───────────

function readVault(vaultPath) {
  const notes = []
  function walk(dir) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.name.endsWith('.md')) continue
      try {
        const stat    = fs.statSync(full)
        const relPath = path.relative(vaultPath, full)
        notes.push({
          name:    entry.name.replace('.md', ''),
          relPath,
          content: fs.readFileSync(full, 'utf8'),
          mtime:   stat.mtimeMs,
        })
      } catch {}
    }
  }
  walk(vaultPath)
  return notes
}

function getNotesModifiedToday(vaultPath) {
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  return readVault(vaultPath).filter(n => n.mtime >= midnight.getTime())
}

// ── File watcher ──────────────────────────────────────────────────────────────

function watchVault(vaultPath, onChange) {
  const watcher = chokidar.watch(vaultPath, {
    ignored:        /(^|[/\\])\..|(anchor-memory\.json|anchor-session\.json)/,
    persistent:     true,
    ignoreInitial:  true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  })
  watcher.on('add',    f => onChange('add',    f))
  watcher.on('change', f => onChange('change', f))
  watcher.on('unlink', f => onChange('unlink', f))
  return watcher
}

// ── Backlinks ─────────────────────────────────────────────────────────────────

function buildBacklinks(vaultPath) {
  const notes   = readVault(vaultPath)
  const backlinks = {}
  const wikilinkRx = /\[\[([^\]]+)\]\]/g

  for (const note of notes) {
    let m
    while ((m = wikilinkRx.exec(note.content)) !== null) {
      const target = m[1].split('|')[0].trim()
      if (!backlinks[target]) backlinks[target] = []
      if (!backlinks[target].includes(note.name)) {
        backlinks[target].push(note.name)
      }
    }
  }
  return backlinks
}

module.exports = {
  createVault, resetVault, hardResetVault,
  readNote, writeNote, appendNote, noteExists,
  readVault, getNotesModifiedToday,
  watchVault, buildBacklinks,
}
