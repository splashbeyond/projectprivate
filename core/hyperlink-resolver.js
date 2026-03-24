'use strict'

// Five link types, large files compressed, loop protection (depth limit 3).

const fs   = require('fs')
const path = require('path')
const { logError } = require('./health')

function parseAllLinks(content) {
  return {
    wikilinks: [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]),
    markdown:  [...content.matchAll(/\[([^\]]+)\]\(([^)]+\.md)\)/g)]
                 .map(m => ({ text: m[1], file: m[2] })),
    tags:      [...content.matchAll(/#([\w-]+)/g)].map(m => m[1]),
    mentions:  [...content.matchAll(/@([\w\s-]{2,40})/g)].map(m => m[1].trim()),
    embeds:    [...content.matchAll(/!\[\[([^\]]+)\]\]/g)].map(m => m[1]),
  }
}

function findFileByName(name, vaultPath) {
  const notes = require('./vault').readVault(vaultPath)
  const lower = name.toLowerCase()
  return (
    notes.find(n => n.name.toLowerCase() === lower) ||
    notes.find(n => n.name.toLowerCase().includes(lower))
  )?.path || null
}

function searchWithinFile(content, query, topN = 3) {
  if (!query) return content.slice(0, 1000)
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  return content.split('\n\n')
    .filter(p => p.trim().length > 30)
    .map(p => ({
      text:  p,
      score: queryWords.filter(w => p.toLowerCase().includes(w)).length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(p => p.text)
    .join('\n\n')
}

function compressLargeFile(name, content, vaultPath, query) {
  try {
    const memory      = require('./vault').readMemory(vaultPath)
    const entityEntry = memory.entities?.[name]
    const entitySummary = entityEntry ? `Known: ${JSON.stringify(entityEntry)}` : ''

    const logPath   = path.join(vaultPath, 'Projects', name, 'log.md')
    const projectLog = fs.existsSync(logPath)
      ? fs.readFileSync(logPath, 'utf8').slice(-500) : ''

    const sections = searchWithinFile(content, query, 3)

    return [
      entitySummary ? `ENTITY:\n${entitySummary}` : '',
      projectLog    ? `LOG:\n${projectLog}` : '',
      `CONTENT:\n${sections}`,
    ].filter(Boolean).join('\n\n').slice(0, 1200)

  } catch (e) { logError('compressLargeFile', e); return content.slice(0, 500) }
}

async function resolveLink(linkText, vaultPath, currentQuery = '', visited = new Set()) {
  if (visited.has(linkText)) return `[Circular link: ${linkText}]`
  if (visited.size >= 3) return `[Link depth limit reached]`
  visited.add(linkText)

  const file = findFileByName(linkText, vaultPath)
  if (!file) return `[No file found: ${linkText}]`

  const content = fs.readFileSync(file, 'utf8')
  if (content.split(/\s+/).length < 500) {
    return `[Note: ${linkText}]\n${content}`
  }

  return `[Note: ${linkText} — compressed]\n` +
    compressLargeFile(linkText, content, vaultPath, currentQuery)
}

async function followLinkInContext(linkText, vaultPath, currentQuery, visited = new Set()) {
  const resolved = await resolveLink(linkText, vaultPath, currentQuery, visited)
  return {
    context:     resolved,
    instruction: `You followed [[${linkText}]]. Use this context to continue your answer. Do not restart.`,
  }
}

module.exports = { parseAllLinks, findFileByName, resolveLink, followLinkInContext }
