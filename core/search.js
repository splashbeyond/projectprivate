'use strict'

const MiniSearch = require('minisearch')

let index = null

// ── Build index from vault notes ──────────────────────────────────────────────

function buildIndex(notes) {
  index = new MiniSearch({
    fields:        ['name', 'content'],
    storeFields:   ['name', 'relPath', 'content'],
    searchOptions: { boost: { name: 2 }, fuzzy: 0.2 },
  })
  index.addAll(notes.map((n, i) => ({ id: i, ...n })))
}

function reindexNote(vaultPath) {
  // Called by chokidar watcher — rebuild full index
  const { readVault } = require('./vault')
  buildIndex(readVault(vaultPath))
}

// ── Smart vault search ────────────────────────────────────────────────────────
// Surgical relevance — not a keyword dump
// Returns top-k results scored by keyword overlap

function findRelevant(question, topK = 5) {
  if (!index) return ''

  const results = index.search(question, { limit: topK * 2 })
  if (!results.length) return ''

  const questionWords = question.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3)

  const scored = results.map(r => ({
    content: `[Vault: ${r.name}]\n${r.content}`,
    score:   questionWords.filter(w =>
      r.content.toLowerCase().includes(w)
    ).length + r.score,
  }))

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(r => r.content)
    .join('\n\n---\n\n')
}

// ── Backlink search ───────────────────────────────────────────────────────────

function searchByName(noteName) {
  if (!index) return null
  const results = index.search(noteName, { fields: ['name'], limit: 1 })
  return results[0] || null
}

module.exports = { buildIndex, reindexNote, findRelevant, searchByName }
