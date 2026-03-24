'use strict'

// Error logging → anchor-health.json. Used everywhere — no silent catch blocks.

const fs   = require('fs')
const path = require('path')

let vaultPath = null

function init(vp) { vaultPath = vp }

function getHealthPath() {
  return path.join(vaultPath, 'anchor-health.json')
}

function readHealth() {
  try { return JSON.parse(fs.readFileSync(getHealthPath(), 'utf8')) }
  catch { return { errors: [] } }
}

function logError(system, error) {
  if (!vaultPath) { console.error(`[${system}]`, error.message || error); return }
  try {
    const h = readHealth()
    h.errors = h.errors || []
    h.errors.push({
      system,
      error: error.message || String(error),
      time:  new Date().toISOString()
    })
    h.errors = h.errors.slice(-20)
    fs.writeFileSync(getHealthPath(), JSON.stringify(h, null, 2))
  } catch {}
}

function updateHealth(key, value) {
  if (!vaultPath) return
  try {
    const h = readHealth()
    h[key] = value
    h.lastHealthCheck = new Date().toISOString()
    fs.writeFileSync(getHealthPath(), JSON.stringify(h, null, 2))
  } catch {}
}

function getStatus() {
  const h = readHealth()
  const recentErrors = (h.errors || [])
    .filter(e => Date.now() - new Date(e.time) < 86400000)
  return {
    healthy:                 recentErrors.length === 0,
    ollamaStatus:            h.ollamaStatus || 'unknown',
    recentErrors,
    lastMemoryConsolidation: h.lastMemoryConsolidation || 'never',
    lastNowRewrite:          h.lastNowRewrite          || 'never',
    lastWeeklySynthesis:     h.lastWeeklySynthesis      || 'never',
  }
}

module.exports = { init, logError, updateHealth, getStatus }
