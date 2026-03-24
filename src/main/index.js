'use strict'

// PRIVACY: All AI calls go to 127.0.0.1:11434 only. Zero data egress.

const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const os   = require('os')
const fs   = require('fs')

// ── Vault path ────────────────────────────────────────────────────────────────
const VAULT_PATH = path.join(os.homedir(), 'Documents', 'AnchorVault')
const OLLAMA_BIN = app.isPackaged
  ? path.join(process.resourcesPath, 'ollama-mac')
  : path.join(__dirname, '../../binaries/ollama-mac')

// core/ lives two levels up from src/main/
const CORE = (m) => require(path.join(__dirname, '../../core', m))

// ── Core modules ──────────────────────────────────────────────────────────────
const {
  ensureVault, createVault, resetVault, hardResetVault,
  readNote, writeNote, readVault, watchVault, buildBacklinks,
} = CORE('vault')

const { buildIndex, loadOrBuildIndex, reindexNote, findRelevant } = CORE('context-builder')
const { readMemory }  = CORE('vault')
const { readSession } = CORE('vault')

const { startOllama, stopOllama, ensureModel, ollamaCall, ollamaStream } = CORE('ollama-manager')
const { init: initHealth, getStatus } = CORE('health')
const { detectIntent }   = CORE('intent')
const { matchSkill, findSkill, learnSkill, analyzeForSkillOpportunities } = CORE('skill-engine')
const { processQuery }   = CORE('query')
const { MemoryEngine }   = CORE('memory-engine')
const { generateStartupBrief } = CORE('startup')
const {
  ONBOARDING_SYSTEM,
  runOnboarding, extractOnboardingData, writeOnboardingFiles,
  confirmIdentity, handleIdentityConfirmation,
} = CORE('onboarding')
const { parseFile }  = CORE('parser')
const {
  init: initCron, startCron, stopCron,
  startWeeklySynthesis, startScheduledSkills,
  addJob, pauseJob, resumeJob, removeJob, listJobs, runJobNow,
} = CORE('cron')

// Chats + calendar — kept from v1 (not in spec scope)
const { listChats, loadChat, saveChat, createChat, deleteChat, updateChatTitle } = CORE('chats')
const { upsertEntry, generateEntryMeta, readCalendar, getDateSection } = CORE('daily-log')

let mainWindow   = null
let memoryEngine = null
let conversation = []

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1200,
    height: 800,
    minWidth:  800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0f0f0f',
    show: false,
    webPreferences: {
      preload:          path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  })

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../out/renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())

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
  initHealth(VAULT_PATH)
  initCron(VAULT_PATH, mainWindow)

  try {
    // 1. Ensure vault exists
    ensureVault(VAULT_PATH)

    // 2. Start Ollama + ensure model
    await startOllama(OLLAMA_BIN)
    await ensureModel()

    // 3. Build / load search index
    loadOrBuildIndex(readVault(VAULT_PATH), VAULT_PATH)

    // 4. Watch vault → re-index + notify renderer + auto-parse dropped files
    watchVault(VAULT_PATH, async (event, filePath) => {
      const ext = path.extname(filePath || '').toLowerCase()
      if (['.pdf', '.docx'].includes(ext)) {
        parseFile(filePath, VAULT_PATH).catch(() => {})
      }
      buildIndex(readVault(VAULT_PATH), VAULT_PATH)
      if (mainWindow && !mainWindow.isDestroyed()) {
        const relPath = path.relative(VAULT_PATH, filePath)
        mainWindow.webContents.send('anchor:vault-changed', { event, relPath })
      }
    })

    // 5. Start cron (weekly synthesis + scheduled skills)
    startCron(VAULT_PATH)

    // 6. Memory engine
    memoryEngine = new MemoryEngine(VAULT_PATH)
    memoryEngine.enforceRetention()

    // 7. Weekly skill auto-suggestion — Friday 4pm
    require('node-cron').schedule('0 16 * * 5', async () => {
      try {
        const suggestion = await analyzeForSkillOpportunities(conversation, VAULT_PATH)
        if (suggestion && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('anchor-message', { role: 'ai', text: suggestion })
        }
      } catch {}
    })

  } catch (e) {
    console.error('Boot error:', e.message)
    require('./health').logError?.('boot', e)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', async () => {
  if (memoryEngine) await memoryEngine.onAppClose(conversation).catch(() => {})
  await stopOllama().catch(() => {})
})

// ── IPC: Boot ─────────────────────────────────────────────────────────────────

ipcMain.handle('anchor:ready', async () => {
  const ses = readSession(VAULT_PATH)
  const mem = readMemory(VAULT_PATH)
  return {
    onboardingComplete: ses.onboardingComplete,
    greeting:           await generateStartupBrief(VAULT_PATH),
    anchorName:         mem.anchorName || 'Anchor',
    userName:           mem.userName   || '',
  }
})

// ── IPC: Chat (streaming) ─────────────────────────────────────────────────────

ipcMain.on('anchor:chat', async (event, { message, history }) => {
  try {
    // 1. Intent check (<1ms, pure JS)
    const intentResult = await detectIntent(message, VAULT_PATH)
    if (intentResult.matched) {
      event.sender.send('anchor:token',     intentResult.response)
      event.sender.send('anchor:token-end')
      if (memoryEngine) memoryEngine.onExchange(message, intentResult.response).catch(() => {})
      conversation.push(
        { role: 'user',      content: message },
        { role: 'assistant', content: intentResult.response }
      )
      return
    }

    // 2. Skill check
    const skillMatch = matchSkill(message, VAULT_PATH)
    if (skillMatch) {
      const { executeSkill } = CORE('skill-engine')
      const { buildContext }  = CORE('context-builder')
      const result = await executeSkill(skillMatch, VAULT_PATH, buildContext)
      event.sender.send('anchor:token',     result)
      event.sender.send('anchor:token-end')
      if (memoryEngine) memoryEngine.onExchange(message, result).catch(() => {})
      conversation.push(
        { role: 'user',      content: message },
        { role: 'assistant', content: result  }
      )
      return
    }

    // 3. RAG streaming chat
    const { buildContext } = CORE('context-builder')
    const context = buildContext(message, VAULT_PATH)

    const msgs = [
      { role: 'system', content: context },
      ...history.slice(-10),
      { role: 'user', content: message },
    ]

    let fullResponse = ''
    await ollamaStream(msgs, (tok) => {
      fullResponse += tok
      event.sender.send('anchor:token', tok)
    })
    event.sender.send('anchor:token-end')

    if (memoryEngine) memoryEngine.onExchange(message, fullResponse).catch(() => {})
    conversation.push(
      { role: 'user',      content: message      },
      { role: 'assistant', content: fullResponse }
    )

  } catch (e) {
    event.sender.send('anchor:token-err', e.message)
  }
})

// ── IPC: Commands ─────────────────────────────────────────────────────────────

ipcMain.handle('anchor:command', async (_, { cmd, args, history }) => {
  const { handleCommand } = CORE('commands')
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
  buildIndex(readVault(VAULT_PATH), VAULT_PATH)
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

ipcMain.handle('anchor:vault-read',   (_, { relPath }) => readNote(VAULT_PATH, relPath))

ipcMain.handle('anchor:vault-write', (_, { relPath, content }) => {
  writeNote(VAULT_PATH, relPath, content)
  reindexNote(VAULT_PATH)
  return { ok: true }
})

ipcMain.handle('anchor:vault-search', (_, { query }) => findRelevant(query, 10))
ipcMain.handle('anchor:backlinks',    () => buildBacklinks(VAULT_PATH))
ipcMain.handle('anchor:vault-path',   () => VAULT_PATH)

// ── IPC: Memory & session ─────────────────────────────────────────────────────

ipcMain.handle('anchor:memory-get',  () => readMemory(VAULT_PATH))
ipcMain.handle('anchor:session-get', () => readSession(VAULT_PATH))

// ── IPC: Web monitor (stub — not in this build scope) ─────────────────────────

ipcMain.handle('anchor:monitor-sources',  () => [])
ipcMain.handle('anchor:monitor-add-feed', () => ({ ok: true }))
ipcMain.handle('anchor:monitor-add-url',  () => ({ ok: true }))
ipcMain.handle('anchor:monitor-remove',   () => ({ ok: true }))
ipcMain.handle('anchor:monitor-run',      () => ({ ok: true }))

// ── IPC: System ───────────────────────────────────────────────────────────────

ipcMain.handle('anchor:status', () => {
  const { getStatus } = CORE('health')
  const health = getStatus()
  const notes  = readVault(VAULT_PATH)
  const mem    = readMemory(VAULT_PATH)
  const ses    = readSession(VAULT_PATH)
  return {
    ...health,
    vault:       VAULT_PATH,
    notes:       notes.length,
    memoryFacts: (mem.userDefined || []).length,
    entityCount: Object.keys(mem.entities || {}).length,
    model:       'llama3.2:3b',
    lastSession: ses.lastSession,
    activeJobs:  listJobs(),
    privacy:     '100% local — zero data egress',
  }
})

ipcMain.handle('anchor:reset', () => {
  resetVault(VAULT_PATH)
  buildIndex(readVault(VAULT_PATH), VAULT_PATH)
  return { ok: true }
})

ipcMain.handle('anchor:reset-hard', () => {
  hardResetVault(VAULT_PATH)
  return { ok: true }
})

// ── IPC: Chats ────────────────────────────────────────────────────────────────

ipcMain.handle('anchor:chats-list',  () => listChats(VAULT_PATH))
ipcMain.handle('anchor:chat-load',   (_, { id }) => loadChat(VAULT_PATH, id))
ipcMain.handle('anchor:chat-new',    () => createChat(VAULT_PATH))
ipcMain.handle('anchor:chat-delete', (_, { id }) => { deleteChat(VAULT_PATH, id); return { ok: true } })
ipcMain.handle('anchor:chat-save',   (_, { chat }) => saveChat(VAULT_PATH, chat))

ipcMain.handle('anchor:chat-title', async (_, { id, messages }) => {
  const snippet = messages.slice(0, 2)
    .map(m => `${m.role}: ${m.content.slice(0, 120)}`).join('\n')
  try {
    const title = await ollamaCall([{
      role: 'user',
      content: `Summarize this conversation in 4-5 words. Return ONLY the summary, nothing else.\n\n${snippet}`,
    }], 20)
    const clean = title.trim().replace(/^["']|["']$/g, '').slice(0, 60)
    updateChatTitle(VAULT_PATH, id, clean)
    generateEntryMeta(messages).then(({ topics, summary }) => {
      upsertEntry(VAULT_PATH, { chatId: id, chatTitle: clean, topics, summary })
    }).catch(() => {})
    return clean
  } catch {
    return null
  }
})

// ── IPC: Memory Calendar ──────────────────────────────────────────────────────

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
