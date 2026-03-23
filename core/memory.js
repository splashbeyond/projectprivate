'use strict'

const fs   = require('fs')
const path = require('path')
const { DEFAULT_MEMORY } = require('./templates')

const memPath = (vaultPath) => path.join(vaultPath, 'anchor-memory.json')

function readMemory(vaultPath) {
  try {
    return { ...DEFAULT_MEMORY(), ...JSON.parse(fs.readFileSync(memPath(vaultPath), 'utf8')) }
  } catch {
    return DEFAULT_MEMORY()
  }
}

function writeMemory(vaultPath, data) {
  fs.writeFileSync(memPath(vaultPath), JSON.stringify(data, null, 2), 'utf8')
}

function rememberFact(fact, vaultPath) {
  const mem = readMemory(vaultPath)
  const exists = mem.userDefined.some(f => f.fact.toLowerCase() === fact.toLowerCase())
  if (!exists) {
    mem.userDefined.push({ fact, savedAt: new Date().toISOString() })
    writeMemory(vaultPath, mem)
  }
  return `Got it. I'll remember: "${fact}"`
}

function forgetTopic(topic, vaultPath) {
  const mem = readMemory(vaultPath)
  const before = mem.userDefined.length
  mem.userDefined = mem.userDefined.filter(
    f => !f.fact.toLowerCase().includes(topic.toLowerCase())
  )
  writeMemory(vaultPath, mem)
  const removed = before - mem.userDefined.length
  return removed > 0
    ? `Removed ${removed} fact${removed > 1 ? 's' : ''} about "${topic}"`
    : `Nothing found about "${topic}" to forget`
}

function getRecap(vaultPath) {
  const mem = readMemory(vaultPath)
  const lines = []

  if (mem.userName)     lines.push(`Name: ${mem.userName}`)
  if (mem.role)         lines.push(`Role: ${mem.role}`)
  if (mem.industry)     lines.push(`Industry: ${mem.industry}`)
  if (mem.goals)        lines.push(`Goals: ${mem.goals}`)
  if (mem.commStyle)    lines.push(`Comm style: ${mem.commStyle}`)
  if (mem.workingHours) lines.push(`Hours: ${mem.workingHours}`)

  if (mem.userDefined?.length > 0) {
    lines.push('\nRemembered facts:')
    mem.userDefined.forEach(f => lines.push(`  - ${f.fact}`))
  }

  if (Object.keys(mem.entities || {}).length > 0) {
    lines.push('\nKnown entities:')
    Object.entries(mem.entities).slice(0, 10).forEach(([k, v]) =>
      lines.push(`  - ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    )
  }

  return lines.length > 0 ? lines.join('\n') : 'No memory stored yet.'
}

module.exports = { readMemory, writeMemory, rememberFact, forgetTopic, getRecap }
