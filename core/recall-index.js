'use strict'

// Recall index — pre-digested summaries of every chat.
// Stored as recall-index.json in the vault.
//
// Why this exists:
//   MiniSearch over raw .md transcripts gives the model 3000-char chunks
//   of noisy conversation text. A 3B model drowns in that.
//   This index stores a compact entry per chat (title, date, topics, 1-line summary)
//   so the model gets 50 words of pre-digested signal instead of 3000 words of noise.
//
// Updated automatically whenever a chat gets a title.
// Searched in context-builder on every query (recent chats) and by recall_topic intent.

const fs   = require('fs')
const path = require('path')
const { logError } = require('./health')

const INDEX_FILE = 'recall-index.json'

function indexPath(vaultPath) {
  return path.join(vaultPath, INDEX_FILE)
}

function readIndex(vaultPath) {
  const p = indexPath(vaultPath)
  if (!fs.existsSync(p)) return { entries: [] }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) }
  catch { return { entries: [] } }
}

function writeIndex(vaultPath, index) {
  try {
    fs.writeFileSync(indexPath(vaultPath), JSON.stringify(index, null, 2))
  } catch (e) { logError('recall-index:write', e) }
}

// Called when a chat is titled — upsert its entry into the index
function updateIndex(vaultPath, { chatId, title, date, topics, summary }) {
  try {
    const index = readIndex(vaultPath)
    const existing = index.entries.findIndex(e => e.id === chatId)
    const entry = {
      id:      chatId,
      title:   title || 'Untitled',
      date:    date  || new Date().toISOString().split('T')[0],
      topics:  Array.isArray(topics) ? topics : [],
      summary: (summary || '').split('\n').map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean).join('. ').slice(0, 120),
      file:    `Chats/${title ? title.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 80) : chatId}.md`,
    }
    if (existing !== -1) {
      index.entries[existing] = entry
    } else {
      index.entries.unshift(entry)
    }
    // Keep index capped at 500 entries — enough for years of daily use
    if (index.entries.length > 500) index.entries = index.entries.slice(0, 500)
    index.updated = new Date().toISOString()
    writeIndex(vaultPath, index)
  } catch (e) { logError('recall-index:update', e) }
}

// Search index by keyword — used by recall_topic intent
// Returns top matches as formatted strings ready to inject into context
function searchIndex(vaultPath, query, limit = 5) {
  try {
    const index   = readIndex(vaultPath)
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    if (!keywords.length) return []

    return index.entries
      .map(entry => {
        const haystack = [entry.title, ...entry.topics, entry.summary].join(' ').toLowerCase()
        const score    = keywords.filter(w => haystack.includes(w)).length
        return { entry, score }
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ entry }) => formatEntry(entry))
  } catch (e) {
    logError('recall-index:search', e)
    return []
  }
}

// Get the N most recent entries — injected into every context build
function getRecent(vaultPath, limit = 5) {
  try {
    const index = readIndex(vaultPath)
    return index.entries.slice(0, limit).map(formatEntry)
  } catch { return [] }
}

function formatEntry(entry) {
  const topics = entry.topics.length ? ` · ${entry.topics.slice(0, 3).join(', ')}` : ''
  const summary = entry.summary ? `\n  ${entry.summary}` : ''
  return `[${entry.date}] "${entry.title}"${topics}${summary}`
}

module.exports = { updateIndex, searchIndex, getRecent, readIndex }
