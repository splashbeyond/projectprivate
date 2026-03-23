'use strict'

// PRIVACY: All AI calls go to 127.0.0.1:11434 only. Zero data egress.

const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const os   = require('os')
const fs   = require('fs')

// ── Vault path — Obsidian-style, separate from app ───────────────────────────
const VAULT_PATH   = path.join(os.homedir(), 'anchor-vault')
const OLLAMA_BIN   = app.isPackaged
  ? path.join(process.resourcesPath, 'ollama-mac')
  : path.join(__dirname, '../../binaries/ollama-mac')

// core/ lives at project root — two levels up from src/main/
const CORE = (m) => require(path.join(__dirname, '../../core', m))

// ── Core modules ─────────────────────────────────────────────────────────────
const { createVault, resetVault, hardResetVault,
        readNote, writeNote, readVault, watchVault,
        buildBacklinks } = CORE('vault')
const { buildIndex, reindexNote, findRelevant } = CORE('search')
const { readMemory }     = CORE('memory')
const { readSession, getGreeting, saveSessionOnExit } = CORE('session')
const { startOllama, ensureModel, setVaultPath,
        askAnchor, ollamaStream } = CORE('ollama')
const { detectIntent }   = CORE('intent')
const { handleCommand }  = CORE('commands')
const { startCron, stopCron } = CORE('cron')
const { runMonitor, getSources, addFeed, addUrl, removeFeed } = CORE('monitor')
const { ONBOARDING_SYSTEM, isOnboardingComplete,
        extractOnboardingData, writeOnboardingFiles } = CORE('onboarding')
const { listChats, loadChat, saveChat, createChat,
        deleteChat, updateChatTitle } = CORE('chats')
const { upsertEntry, generateEntryMeta,
        readCalendar, getDateSection }  = CORE('daily-log')

let mainWindow = null

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1200,
    height:          800,
    minWidth:        800,
    minHeight:       600,
    titleBarStyle:   'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0f0f0f',
    show:            false,
    webPreferences: {
      preload:           path.join(__dirname, '../preload/index.js'),
      contextIsolation:  true,
      nodeIntegration:   false,
      sandbox:           false,
    },
  })

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../out/renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // Open external links in browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('close', async () => {
    stopCron()
  })
}

// ── App boot ──────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow()

  try {
    // 1. Create vault if needed
    createVault(VAULT_PATH)

    // 2. Start Ollama + ensure model
    await startOllama(OLLAMA_BIN)
    await ensureModel()

    // 3. Set vault path in ollama module
    setVaultPath(VAULT_PATH)

    // 4. Build search index
    const notes = readVault(VAULT_PATH)
    buildIndex(notes)

    // 5. Watch vault for changes → re-index + notify renderer
    watchVault(VAULT_PATH, (event, filePath) => {
      reindexNote(VAULT_PATH)
      if (mainWindow && !mainWindow.isDestroyed()) {
        const relPath = path.relative(VAULT_PATH, filePath)
        mainWindow.webContents.send('anchor:vault-changed', { event, relPath })
      }
    })

    // 6. Start cron
    startCron(VAULT_PATH)

  } catch (e) {
    console.error('Boot error:', e.message)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ── IPC: Boot ─────────────────────────────────────────────────────────────────

ipcMain.handle('anchor:ready', async () => {
  const ses = readSession(VAULT_PATH)
  const mem = readMemory(VAULT_PATH)
  return {
    onboardingComplete: ses.onboardingComplete,
    greeting:           getGreeting(VAULT_PATH),
    anchorName:         mem.anchorName || 'Anchor',
    userName:           mem.userName   || '',
  }
})

// ── IPC: Chat (streaming) ─────────────────────────────────────────────────────

ipcMain.on('anchor:chat', async (event, { message, history }) => {
  try {
    // 1. Check intent detector first (<1ms)
    const intentResult = await detectIntent(message, VAULT_PATH)
    if (intentResult.matched) {
      event.sender.send('anchor:token',     intentResult.response)
      event.sender.send('anchor:token-end')
      return
    }

    // 2. Slash command check
    if (message.startsWith('/')) {
      const parts = message.slice(1).split(' ')
      const cmd   = parts[0].toLowerCase()
      const args  = parts.slice(1).join(' ') || null
      const result = await handleCommand(cmd, args, VAULT_PATH, history)
      event.sender.send('anchor:token',     result.response)
      event.sender.send('anchor:token-end')
      if (result.action === 'exit') {
        await saveSessionOnExit(VAULT_PATH, history)
      }
      return
    }

    // 3. RAG chat with streaming
    await ollamaStream(
      buildMessages(message, history),
      (tok) => event.sender.send('anchor:token', tok)
    )
    event.sender.send('anchor:token-end')

  } catch (e) {
    event.sender.send('anchor:token-err', e.message)
  }
})

function buildMessages(message, history) {
  // readNote already imported at top via CORE('vault') destructuring
  // buildSystemPrompt lives in ollama — reconstruct inline here

  // Import internal helpers — these are not exported but we can reconstruct
  const commandCenter = (() => {
    try { return readNote(VAULT_PATH, 'ANCHOR.md') } catch { return '' }
  })()
  const vaultContext = findRelevant(message)
  const { findSkill } = CORE('skills')
  const matchedSkill = findSkill(message, VAULT_PATH)

  // Build system prompt inline since buildSystemPrompt is in ollama.js
  const { readMemory: _rm }  = CORE('memory')
  const { readSession: _rs } = CORE('session')
  const readMemory  = _rm
  const readSession = _rs
  const mem = readMemory(VAULT_PATH)
  const ses = readSession(VAULT_PATH)

  const recallParts = []
  if (mem.userDefined?.length > 0) {
    recallParts.push('REMEMBERED FACTS:\n' + mem.userDefined.map(f => `- ${f.fact}`).join('\n'))
  }
  const profile = [
    mem.userName  ? `Name: ${mem.userName}`     : '',
    mem.role      ? `Role: ${mem.role}`         : '',
    mem.goals     ? `Goals: ${mem.goals}`       : '',
    mem.commStyle ? `Comm style: ${mem.commStyle}` : '',
  ].filter(Boolean).join('\n')
  if (profile) recallParts.push(`USER PROFILE:\n${profile}`)
  if (ses?.lastSession) {
    const days = Math.floor((Date.now() - new Date(ses.lastSession.date)) / 86400000)
    const when = days === 0 ? 'earlier today' : days === 1 ? 'yesterday' : `${days} days ago`
    recallParts.push(`LAST SESSION (${when}): ${ses.lastSession.topic}`)
  }

  const systemPrompt = [
    commandCenter,
    recallParts.length ? `\nMEMORY AND RECALL:\n${recallParts.join('\n\n')}` : '',
    matchedSkill ? `\nACTIVE SKILL — ${matchedSkill.name}:\n${matchedSkill.instructions}` : '',
    vaultContext  ? `\nVAULT CONTEXT:\n${vaultContext}` : '',
    '\nPRIVACY: Closed local system. Never transmit vault content externally.',
  ].filter(Boolean).join('\n')

  return [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10),
    { role: 'user', content: message },
  ]
}

// ── IPC: Commands ─────────────────────────────────────────────────────────────

ipcMain.handle('anchor:command', async (_, { cmd, args, history }) => {
  return await handleCommand(cmd, args, VAULT_PATH, history)
})

ipcMain.handle('anchor:intent', async (_, { message }) => {
  return await detectIntent(message, VAULT_PATH)
})

// ── IPC: Onboarding ───────────────────────────────────────────────────────────

ipcMain.on('anchor:onboarding-chat', async (event, { message, history }) => {
  try {
    const messages = [
      { role: 'system', content: ONBOARDING_SYSTEM },
      ...history.slice(-20),
      { role: 'user', content: message },
    ]
    await ollamaStream(messages, (tok) => event.sender.send('anchor:token', tok))
    event.sender.send('anchor:token-end')
  } catch (e) {
    event.sender.send('anchor:token-err', e.message)
  }
})

ipcMain.handle('anchor:onboarding-finish', async (_, { history }) => {
  const data = await extractOnboardingData(history)
  await writeOnboardingFiles(data, VAULT_PATH)
  // Rebuild index with new files
  buildIndex(readVault(VAULT_PATH))
  return { anchorName: data.anchorName || 'Anchor', userName: data.userName || '' }
})

// ── IPC: Vault ────────────────────────────────────────────────────────────────

ipcMain.handle('anchor:vault-list', () => {
  return readVault(VAULT_PATH).map(n => ({
    name:    n.name,
    relPath: n.relPath,
    mtime:   n.mtime,
  }))
})

ipcMain.handle('anchor:vault-read', (_, { relPath }) => {
  return readNote(VAULT_PATH, relPath)
})

ipcMain.handle('anchor:vault-write', (_, { relPath, content }) => {
  writeNote(VAULT_PATH, relPath, content)
  reindexNote(VAULT_PATH)
  return { ok: true }
})

ipcMain.handle('anchor:vault-search', (_, { query }) => {
  return findRelevant(query, 10)
})

ipcMain.handle('anchor:backlinks', () => {
  return buildBacklinks(VAULT_PATH)
})

ipcMain.handle('anchor:vault-path', () => VAULT_PATH)

// ── IPC: Memory & session ─────────────────────────────────────────────────────

ipcMain.handle('anchor:memory-get', () => readMemory(VAULT_PATH))
ipcMain.handle('anchor:session-get', () => readSession(VAULT_PATH))

// ── IPC: Web monitor ──────────────────────────────────────────────────────────

ipcMain.handle('anchor:monitor-sources',  () => getSources(VAULT_PATH))
ipcMain.handle('anchor:monitor-add-feed', (_, { url }) => addFeed(VAULT_PATH, url))
ipcMain.handle('anchor:monitor-add-url',  (_, { url }) => addUrl(VAULT_PATH, url))
ipcMain.handle('anchor:monitor-remove',   (_, { url }) => removeFeed(VAULT_PATH, url))
ipcMain.handle('anchor:monitor-run',      () => runMonitor(VAULT_PATH))

// ── IPC: System ───────────────────────────────────────────────────────────────

ipcMain.handle('anchor:status', () => {
  const notes = readVault(VAULT_PATH)
  const mem   = readMemory(VAULT_PATH)
  const ses   = readSession(VAULT_PATH)
  return {
    vault:        VAULT_PATH,
    notes:        notes.length,
    memoryFacts:  (mem.userDefined || []).length,
    model:        'llama3.2:3b',
    lastSession:  ses.lastSession,
    privacy:      '100% local — zero data egress',
  }
})

ipcMain.handle('anchor:reset', () => {
  resetVault(VAULT_PATH)
  buildIndex(readVault(VAULT_PATH))
  return { ok: true }
})

ipcMain.handle('anchor:reset-hard', () => {
  hardResetVault(VAULT_PATH)
  return { ok: true }
})

// ── IPC: Chats ────────────────────────────────────────────────────────────────

ipcMain.handle('anchor:chats-list',   () => listChats(VAULT_PATH))
ipcMain.handle('anchor:chat-load',    (_, { id }) => loadChat(VAULT_PATH, id))
ipcMain.handle('anchor:chat-new',     () => createChat(VAULT_PATH))
ipcMain.handle('anchor:chat-delete',  (_, { id }) => { deleteChat(VAULT_PATH, id); return { ok: true } })
ipcMain.handle('anchor:chat-save', (_, { chat }) => {
  return saveChat(VAULT_PATH, chat)
})

ipcMain.handle('anchor:chat-title', async (_, { id, messages }) => {
  const { askOllamaRaw } = CORE('ollama')
  const snippet = messages.slice(0, 2).map(m => `${m.role}: ${m.content.slice(0, 120)}`).join('\n')
  try {
    const title = await askOllamaRaw(
      `Summarize this conversation in 4-5 words. Return ONLY the summary, nothing else.\n\n${snippet}`
    )
    const clean = title.trim().replace(/^["']|["']$/g, '').slice(0, 60)
    updateChatTitle(VAULT_PATH, id, clean)

    // Write daily log entry (non-blocking)
    generateEntryMeta(messages).then(({ topics, summary }) => {
      upsertEntry(VAULT_PATH, { chatId: id, chatTitle: clean, topics, summary })
    }).catch(() => {})

    return clean
  } catch {
    return null
  }
})

// ── IPC: Memory Calendar ───────────────────────────────────────────────────────

ipcMain.handle('anchor:calendar-read', () => {
  const raw = readCalendar(VAULT_PATH)
  return raw.replace(/<!--[^>]*-->/g, '').replace(/\n{3,}/g, '\n\n').trim()
})
ipcMain.handle('anchor:calendar-date', (_, { date }) => getDateSection(VAULT_PATH, date))

ipcMain.handle('anchor:calendar-update', async (_, { id, title, messages }) => {
  generateEntryMeta(messages).then(({ topics, summary }) => {
    upsertEntry(VAULT_PATH, { chatId: id, chatTitle: title, topics, summary })
  }).catch(() => {})
  return { ok: true }
})
