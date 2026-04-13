'use strict'

// In-process reminder scheduler.
// Each reminder fires a setTimeout that pushes a notification to the renderer.
// Reminders are also stored in reminders.json so they survive restarts —
// boot loads them and re-arms any that haven't fired yet.

const fs   = require('fs')
const path = require('path')
const { logError } = require('./health')

// Injected at boot from main/index.js
let _mainWindow = null

function setMainWindow(win) { _mainWindow = win }

const activeTimers = new Map()

// Called by the intent handler to arm a timeout
function _fireReminder(id, text, delayMs, vaultPath) {
  if (activeTimers.has(id)) clearTimeout(activeTimers.get(id))

  const timer = setTimeout(() => {
    activeTimers.delete(id)
    _dispatch(text)
    _clearFromVault(id, vaultPath)
  }, delayMs)

  // Node timeouts are objects; unref() so they don't block app quit
  if (timer?.unref) timer.unref()
  activeTimers.set(id, timer)
}

// Push notification to renderer
function _dispatch(text) {
  try {
    if (_mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send('anchor:reminder', { text })
    }
  } catch (e) { logError('reminder-scheduler:dispatch', e) }
}

// Remove fired reminder from vault JSON
function _clearFromVault(id, vaultPath) {
  try {
    const p = path.join(vaultPath, 'reminders.json')
    if (!fs.existsSync(p)) return
    const list = JSON.parse(fs.readFileSync(p, 'utf8'))
    fs.writeFileSync(p, JSON.stringify(list.filter(r => r.id !== id), null, 2))
  } catch {}
}

// Called at boot — reload any reminders that haven't fired yet
function loadPersistedReminders(vaultPath) {
  try {
    const p = path.join(vaultPath, 'reminders.json')
    if (!fs.existsSync(p)) return

    const now       = Date.now()
    const reminders = JSON.parse(fs.readFileSync(p, 'utf8'))
    const active    = reminders.filter(r => new Date(r.fireAt) > new Date())

    if (active.length !== reminders.length) {
      // Prune stale
      fs.writeFileSync(p, JSON.stringify(active, null, 2))
    }

    for (const r of active) {
      const delayMs = new Date(r.fireAt) - now
      _fireReminder(r.id, r.text, Math.max(delayMs, 0), vaultPath)
    }

    if (active.length) {
      console.log(`[reminders] Reloaded ${active.length} pending reminder(s)`)
    }
  } catch (e) { logError('reminder-scheduler:load', e) }
}

module.exports = { setMainWindow, _fireReminder, loadPersistedReminders }
