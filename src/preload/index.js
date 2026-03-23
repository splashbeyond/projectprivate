'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// Secure IPC bridge — renderer can only call what's explicitly exposed here
// No direct Node.js access from the UI

contextBridge.exposeInMainWorld('anchor', {

  // ── Boot ────────────────────────────────────────────────────────────────────
  ready: () => ipcRenderer.invoke('anchor:ready'),

  // ── Chat ────────────────────────────────────────────────────────────────────
  // Streaming: sends message, tokens arrive via onToken listener
  chat:    (message, history) => ipcRenderer.send('anchor:chat', { message, history }),
  command: (cmd, args, history) => ipcRenderer.invoke('anchor:command', { cmd, args, history }),
  intent:  (message) => ipcRenderer.invoke('anchor:intent', { message }),

  // Streaming token listeners
  onToken:    (fn) => ipcRenderer.on('anchor:token',     (_, tok) => fn(tok)),
  onTokenEnd: (fn) => ipcRenderer.on('anchor:token-end', () => fn()),
  onTokenErr: (fn) => ipcRenderer.on('anchor:token-err', (_, msg) => fn(msg)),

  // Remove streaming listeners (call on unmount)
  offStreaming: () => {
    ipcRenderer.removeAllListeners('anchor:token')
    ipcRenderer.removeAllListeners('anchor:token-end')
    ipcRenderer.removeAllListeners('anchor:token-err')
  },

  // ── Onboarding ──────────────────────────────────────────────────────────────
  onboardingChat:   (message, history) => ipcRenderer.send('anchor:onboarding-chat', { message, history }),
  onboardingFinish: (history) => ipcRenderer.invoke('anchor:onboarding-finish', { history }),

  // ── Vault ───────────────────────────────────────────────────────────────────
  vaultList:   ()             => ipcRenderer.invoke('anchor:vault-list'),
  vaultRead:   (relPath)      => ipcRenderer.invoke('anchor:vault-read',   { relPath }),
  vaultWrite:  (relPath, content) => ipcRenderer.invoke('anchor:vault-write', { relPath, content }),
  vaultSearch: (query)        => ipcRenderer.invoke('anchor:vault-search', { query }),
  backlinks:   ()             => ipcRenderer.invoke('anchor:backlinks'),

  // Vault change events (chokidar → renderer)
  onVaultChange: (fn) => ipcRenderer.on('anchor:vault-changed', (_, event) => fn(event)),
  offVaultChange: () => ipcRenderer.removeAllListeners('anchor:vault-changed'),

  // ── Memory & session ────────────────────────────────────────────────────────
  memoryGet:  () => ipcRenderer.invoke('anchor:memory-get'),
  sessionGet: () => ipcRenderer.invoke('anchor:session-get'),

  // ── Web monitor ─────────────────────────────────────────────────────────────
  monitorSources:   ()    => ipcRenderer.invoke('anchor:monitor-sources'),
  monitorAddFeed:   (url) => ipcRenderer.invoke('anchor:monitor-add-feed',   { url }),
  monitorAddUrl:    (url) => ipcRenderer.invoke('anchor:monitor-add-url',    { url }),
  monitorRemove:    (url) => ipcRenderer.invoke('anchor:monitor-remove',     { url }),
  monitorRunNow:    ()    => ipcRenderer.invoke('anchor:monitor-run'),

  // ── Chats ───────────────────────────────────────────────────────────────────
  chatsList:  ()             => ipcRenderer.invoke('anchor:chats-list'),
  chatLoad:   (id)           => ipcRenderer.invoke('anchor:chat-load',   { id }),
  chatNew:    ()             => ipcRenderer.invoke('anchor:chat-new'),
  chatDelete: (id)           => ipcRenderer.invoke('anchor:chat-delete', { id }),
  chatSave:   (chat)         => ipcRenderer.invoke('anchor:chat-save',   { chat }),
  chatTitle:  (id, messages) => ipcRenderer.invoke('anchor:chat-title',  { id, messages }),

  // ── System ──────────────────────────────────────────────────────────────────
  status:    () => ipcRenderer.invoke('anchor:status'),
  reset:     () => ipcRenderer.invoke('anchor:reset'),
  resetHard: () => ipcRenderer.invoke('anchor:reset-hard'),
  getVaultPath: () => ipcRenderer.invoke('anchor:vault-path'),
})
