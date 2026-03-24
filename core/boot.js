'use strict'

// Boot state machine — sends progress to renderer via IPC boot-status events.

const { startOllama, ensureModel } = require('./ollama-manager')
const { ensureVault, readVault }   = require('./vault')
const { loadOrBuildIndex }         = require('./context-builder')
const { logError }                 = require('./health')

async function bootSequence(mainWindow, vaultPath, ollamaBin) {
  const send = (step, message, progress) => {
    try {
      mainWindow.webContents.send('boot-status', { step, message, progress })
    } catch {}
  }

  try {
    send('ollama', 'Starting AI engine...', 15)
    await startOllama(ollamaBin)

    send('model', `Loading llama3.2:3b...`, 35)
    await ensureModel((msg) => send('model', msg, 35))

    send('vault', 'Setting up your vault...', 55)
    await ensureVault(vaultPath)

    send('index', 'Indexing your notes...', 75)
    loadOrBuildIndex(readVault(vaultPath), vaultPath)

    send('ready', 'Ready', 100)
    return true

  } catch (e) {
    logError('bootSequence', e)
    send('error', `Boot failed: ${e.message}`, 0)
    return false
  }
}

module.exports = { bootSequence }
