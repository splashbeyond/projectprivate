'use strict'

// Thin shim — redirects to vault.js which owns all memory I/O.

const { readMemory, writeMemory } = require('./vault')

function rememberFact(vaultPath, fact) {
  const mem = readMemory(vaultPath)
  mem.userDefined = mem.userDefined || []
  mem.userDefined.push({ fact, date: new Date().toISOString() })
  writeMemory(vaultPath, mem)
  return `Remembered: "${fact}"`
}

function forgetTopic(vaultPath, topic) {
  const mem = readMemory(vaultPath)
  const lower = topic.toLowerCase()
  mem.userDefined = (mem.userDefined || []).filter(f => {
    const text = typeof f === 'object' ? f.fact : f
    return !text.toLowerCase().includes(lower)
  })
  writeMemory(vaultPath, mem)
  return `Forgot items related to: "${topic}"`
}

function getRecap(vaultPath) {
  const mem = readMemory(vaultPath)
  const facts = (mem.userDefined || []).map(f => typeof f === 'object' ? f.fact : f)
  return facts.length ? facts.join('\n') : 'No remembered facts yet.'
}

module.exports = { readMemory, writeMemory, rememberFact, forgetTopic, getRecap }
