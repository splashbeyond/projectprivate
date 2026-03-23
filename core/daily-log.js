'use strict'

const fs   = require('fs')
const path = require('path')

const CALENDAR_FILE = 'Memory-Calendar.md'

function getCalendarPath(vaultPath) {
  return path.join(vaultPath, CALENDAR_FILE)
}

function getTodayKey() {
  return new Date().toISOString().split('T')[0]
}

function getDayLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function getTime() {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function readCalendar(vaultPath) {
  const p = getCalendarPath(vaultPath)
  if (!fs.existsSync(p)) {
    const init = `# Memory Calendar\n\n> A daily log of everything discussed with Anchor. Auto-updated after every conversation.\n\n`
    fs.writeFileSync(p, init, 'utf8')
    return init
  }
  return fs.readFileSync(p, 'utf8')
}

function writeCalendar(vaultPath, content) {
  fs.writeFileSync(getCalendarPath(vaultPath), content, 'utf8')
}

function buildEntry(chatId, time, title, topics, summaryLines) {
  const open  = `<!-- anchor:${chatId} -->`
  const close = `<!-- /anchor:${chatId} -->`
  const link  = `**${time}** · [[Chats/${title}]]`
  const body  = [link]
  if (topics?.length) body.push(`Topics: ${topics.join(', ')}`)
  body.push(...summaryLines.map(l => l.startsWith('-') ? l : `- ${l}`))
  return `${open}\n${body.join('\n')}\n${close}`
}

// Insert or update a chat's daily log entry
function upsertEntry(vaultPath, { chatId, chatTitle, summary, topics }) {
  const today     = getTodayKey()
  const dayLabel  = getDayLabel(today)
  const time      = getTime()
  const openTag   = `<!-- anchor:${chatId} -->`
  const closeTag  = `<!-- /anchor:${chatId} -->`
  const summaryLines = (summary || '').split('\n').map(l => l.trim()).filter(Boolean)
  const entry     = buildEntry(chatId, time, chatTitle, topics || [], summaryLines)

  let content = readCalendar(vaultPath)

  // Replace existing entry for this chat
  if (content.includes(openTag)) {
    const start = content.indexOf(openTag)
    const end   = content.indexOf(closeTag)
    if (end !== -1) {
      content = content.slice(0, start) + entry + content.slice(end + closeTag.length)
    }
    writeCalendar(vaultPath, content)
    return
  }

  // Insert into today's section, or create it
  const sectionMarker = `## ${today}`
  if (content.includes(sectionMarker)) {
    const idx     = content.indexOf(sectionMarker)
    const lineEnd = content.indexOf('\n', idx) + 1
    content = content.slice(0, lineEnd) + '\n' + entry + '\n\n' + content.slice(lineEnd)
  } else {
    // New day section — insert after the calendar header block
    const insertAt  = findInsertPoint(content)
    const newSection = `## ${today} — ${dayLabel}\n\n${entry}\n\n`
    content = content.slice(0, insertAt) + newSection + content.slice(insertAt)
  }

  writeCalendar(vaultPath, content)
}

function findInsertPoint(content) {
  // Insert before the first existing ## section, or at end of header
  const firstSection = content.indexOf('\n## ')
  if (firstSection !== -1) return firstSection + 1
  const firstHr = content.indexOf('\n---\n')
  if (firstHr !== -1) return firstHr + 5
  return content.length
}

// Strip internal HTML comment anchors before showing to user
function cleanForDisplay(text) {
  return text.replace(/<!--[^>]*-->/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

// Return just a single date's section from the calendar
function getDateSection(vaultPath, dateStr) {
  const content = readCalendar(vaultPath)
  const marker  = `## ${dateStr}`
  if (!content.includes(marker)) return null
  const start = content.indexOf(marker)
  const next  = content.indexOf('\n## ', start + 1)
  const raw   = next === -1 ? content.slice(start) : content.slice(start, next)
  return cleanForDisplay(raw)
}

// Use Ollama to generate topics + summary bullet points for a chat
async function generateEntryMeta(messages) {
  const { askOllamaRaw } = require('./ollama')
  const snippet = messages.slice(-12)
    .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
    .join('\n')

  const prompt = `Given this conversation, respond in EXACTLY this format:
TOPICS: keyword1, keyword2, keyword3
SUMMARY:
- key point one
- key point two
- key point three

Keep topics to 3-5 short keywords. Keep summary to 2-4 bullet points.

Conversation:
${snippet}`

  try {
    const raw = await askOllamaRaw(prompt)
    const topicsMatch  = raw.match(/TOPICS:\s*(.+)/i)
    const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]+)/i)
    const topics = topicsMatch
      ? topicsMatch[1].split(',').map(t => t.trim()).filter(Boolean)
      : []
    const summary = summaryMatch ? summaryMatch[1].trim() : ''
    return { topics, summary }
  } catch {
    return { topics: [], summary: '' }
  }
}

module.exports = { readCalendar, upsertEntry, getDateSection, generateEntryMeta, getCalendarPath, getTodayKey, getDayLabel }
