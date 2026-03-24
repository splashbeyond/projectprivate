'use strict'

// Thin shim — redirects to vault.js + startup.js.

const { readSession, writeSession } = require('./vault')
const { generateStartupBrief }      = require('./startup')

async function getGreeting(vaultPath) {
  return generateStartupBrief(vaultPath)
}

async function saveSessionOnExit(vaultPath, conversation) {
  // Handled by MemoryEngine.onAppClose — this is a no-op stub
}

module.exports = { readSession, writeSession, getGreeting, saveSessionOnExit }
