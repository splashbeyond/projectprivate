'use strict'

// RAG context assembly. MiniSearch index persisted to disk — no rebuild on every boot.

const fs         = require('fs')
const path       = require('path')
const MiniSearch = require('minisearch')
const { readMemory, readSession, readFile } = require('./vault')
const { logError } = require('./health')

let searchIndex = null

const MINI_OPTIONS = {
  fields:       ['name', 'content'],
  storeFields:  ['name', 'content', 'relativePath'],
  searchOptions: { boost: { name: 2 }, fuzzy: 0.2 },
}

// ── Index build / load ────────────────────────────────────────────────────────

function buildIndex(notes, vaultPath) {
  const filtered = notes.filter(n =>
    n.relativePath &&
    !n.relativePath.startsWith('Conversations/') &&
    !n.relativePath.startsWith('Digests/') &&
    !n.relativePath.startsWith('Synthesis/') &&
    !n.name.startsWith('anchor-') &&
    n.name !== 'identity'
  )

  searchIndex = new MiniSearch(MINI_OPTIONS)
  for (const note of filtered) {
    try { searchIndex.add(note) } catch {}
  }

  try {
    fs.writeFileSync(
      path.join(vaultPath, '.anchor-index.json'),
      JSON.stringify(searchIndex.toJSON())
    )
  } catch (e) { logError('buildIndex:persist', e) }

  return searchIndex
}

function loadOrBuildIndex(notes, vaultPath) {
  const indexPath = path.join(vaultPath, '.anchor-index.json')
  if (fs.existsSync(indexPath)) {
    try {
      searchIndex = MiniSearch.loadJSON(
        fs.readFileSync(indexPath, 'utf8'),
        MINI_OPTIONS
      )
      return searchIndex
    } catch {}
  }
  return buildIndex(notes, vaultPath)
}

// Reindex a single note by rebuilding the full index
function reindexNote(vaultPath) {
  try {
    const { readVault } = require('./vault')
    buildIndex(readVault(vaultPath), vaultPath)
  } catch (e) { logError('reindexNote', e) }
}

// ── Context assembly ──────────────────────────────────────────────────────────

function buildVaultContext(query, topK = 5) {
  if (!searchIndex || !query) return ''
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  let candidates = []
  try { candidates = searchIndex.search(query, { limit: topK * 2 }) }
  catch (e) { logError('buildVaultContext', e); return '' }
  if (!candidates.length) return ''

  return candidates
    .map(r => ({
      text:  `### ${r.name}\n${r.content}`,
      score: queryWords.filter(w =>
        (r.content + ' ' + r.name).toLowerCase().includes(w)
      ).length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(r => r.text)
    .join('\n\n---\n\n')
}

// Alias used by old search.js callers
function findRelevant(query, topK = 5) {
  return buildVaultContext(query, topK)
}

function buildMemoryContext(vaultPath) {
  try {
    const m = readMemory(vaultPath)
    const s = readSession(vaultPath)
    const parts = []

    if (m.userDefined?.length > 0) {
      parts.push('REMEMBERED:\n' + m.userDefined
        .map(f => `- ${typeof f === 'object' ? f.fact : f}`).join('\n'))
    }

    const profile = [
      m.userName ? `Name: ${m.userName}` : '',
      m.role     ? `Role: ${m.role}`     : '',
      m.industry ? `Industry: ${m.industry}` : '',
      m.goals    ? `Goals: ${m.goals}`   : '',
      m.commStyle ? `Comm style: ${m.commStyle}` : '',
    ].filter(Boolean)
    if (profile.length) parts.push(`PROFILE:\n${profile.join('\n')}`)

    const entities = Object.entries(m.entities || {})
      .sort((a, b) =>
        new Date(b[1].lastMentioned || 0) - new Date(a[1].lastMentioned || 0)
      )
      .slice(0, 8)
    if (entities.length) {
      parts.push('KNOWN:\n' + entities.map(([n]) => `- ${n}`).join('\n'))
    }

    if (s?.lastSession?.date) {
      const days = Math.floor((Date.now() - new Date(s.lastSession.date)) / 86400000)
      const when = days === 0 ? 'earlier today' : days === 1 ? 'yesterday' : `${days} days ago`
      parts.push(`LAST SESSION (${when}): ${s.lastSession.topic || 'general'}`)

      if (s.lastSession.openThreads?.length > 0) {
        parts.push('OPEN:\n' + s.lastSession.openThreads.map(t => `- ${t}`).join('\n'))
      }
    }

    return parts.join('\n\n')
  } catch (e) { logError('buildMemoryContext', e); return '' }
}

function queryMentionsPerson(query, vaultPath) {
  try {
    const p = path.join(vaultPath, 'people.md')
    if (!fs.existsSync(p)) return false
    const people = fs.readFileSync(p, 'utf8')
    const names = [...people.matchAll(/^## (.+)$/gm)].map(m => m[1].toLowerCase())
    const q = query.toLowerCase()
    return names.some(n => n.length > 2 && q.includes(n))
  } catch { return false }
}

function getPeopleContext(query, vaultPath) {
  try {
    const p = path.join(vaultPath, 'people.md')
    if (!fs.existsSync(p)) return ''
    const people = fs.readFileSync(p, 'utf8')
    const q = query.toLowerCase()
    return people.split(/^---$/m)
      .filter(s => {
        const m = s.match(/^## (.+)$/m)
        return m && q.includes(m[1].toLowerCase())
      })
      .slice(0, 2).join('\n---\n').slice(0, 600)
  } catch (e) { logError('getPeopleContext', e); return '' }
}

// Detect if a query is asking about past conversations or history
function isPastQuery(query) {
  return /\b(we|our|discussed|talked|said|mentioned|last time|before|remember|recall|conversation|chat|told|asked)\b/i.test(query)
}

function buildRecallContext(query, vaultPath) {
  try {
    const { searchIndex, getRecent } = require('./recall-index')
    // Always include last 3 chats as lightweight recent context
    const recent  = getRecent(vaultPath, 3)
    // If query looks like a past-context question, also search for relevant chats
    const matches = isPastQuery(query) ? searchIndex(vaultPath, query, 3) : []

    const parts = []
    if (recent.length)  parts.push(`Recent chats:\n${recent.join('\n')}`)
    if (matches.length) parts.push(`Relevant past chats:\n${matches.join('\n')}`)
    return parts.join('\n\n')
  } catch { return '' }
}

function buildContext(query, vaultPath) {
  try {
    const identity  = readFile(vaultPath, 'identity.md') || ''
    const now       = readFile(vaultPath, 'now.md') || ''
    const memory    = buildMemoryContext(vaultPath)
    const recall    = buildRecallContext(query, vaultPath)
    const vault     = buildVaultContext(query)
    const people    = queryMentionsPerson(query, vaultPath)
      ? getPeopleContext(query, vaultPath) : ''

    let skillContext = ''
    try {
      const { matchSkill } = require('./skill-engine')
      const m = matchSkill(query, vaultPath)
      if (m) skillContext = `ACTIVE SKILL — ${m.skill.name}:\n${m.skill.instructions}`
    } catch {}

    return [
      identity,
      now       ? `\nCURRENT STATE:\n${now}` : '',
      memory    ? `\nMEMORY:\n${memory}` : '',
      recall    ? `\nCONVERSATION HISTORY:\n${recall}` : '',
      people    ? `\nPEOPLE:\n${people}` : '',
      skillContext ? `\n${skillContext}` : '',
      vault     ? `\nVAULT:\n${vault}` : '',
      '\nPRIVACY: Closed local system. Nothing leaves this machine.',
      '\nBEHAVIOR RULES — non-negotiable:\n- Do exactly what was asked. Nothing more.\n- Answer from PROFILE and MEMORY first — if the answer is there, use it directly.\n- Never say "I don\'t have that" when the answer is in PROFILE, MEMORY, or VAULT above.\n- Never speculate about why the user is asking something. Never say "this seems like a test" or comment on the pattern of their questions. Just answer.\n- Never add items to lists, logs, files, or todos unless explicitly instructed.\n- Never announce that something was saved, remembered, or logged unless the user asked.\n- If the user shares a personal fact, acknowledge it naturally — the system handles memory silently.\n- Minimum action principle: only include what was explicitly asked. No scope expansion.\n- After completing something that could be extended, offer once: "Want me to add more?" — never add without asking.',
    ].filter(Boolean).join('\n')

  } catch (e) {
    logError('buildContext', e)
    return 'You are Anchor, a private AI assistant. Answer helpfully.'
  }
}

module.exports = {
  buildIndex, loadOrBuildIndex, reindexNote,
  buildVaultContext, findRelevant,
  buildMemoryContext, buildContext,
}
