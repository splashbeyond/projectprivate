'use strict'

// Ollama lifecycle — start, stop, model pull.
// Inference calls have moved to llm.js (provider-agnostic).
// ollamaCall / ollamaStream are kept here as thin shims for backwards compatibility.

const { execSync, spawn } = require('child_process')
const fs   = require('fs')
const { logError, updateHealth } = require('./health')
const { getModel, call: llmCall, stream: llmStream } = require('./llm')

const OLLAMA_URL = 'http://127.0.0.1:11434'
let ollamaProcess = null

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function waitForOllama(retries = 12) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`${OLLAMA_URL}/api/tags`)
      if (r.ok) return true
    } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

async function startOllama(binaryPath) {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`)
    if (r.ok) { updateHealth('ollamaStatus', 'ready'); return }
  } catch {}

  const bin = (() => {
    try { execSync('which ollama', { stdio: 'ignore' }); return 'ollama' } catch {}
    if (binaryPath && fs.existsSync(binaryPath)) return binaryPath
    return null
  })()

  if (!bin) throw new Error('Ollama not found. Install from https://ollama.ai')

  ollamaProcess = spawn(bin, ['serve'], { detached: true, stdio: 'ignore' })
  ollamaProcess.unref()

  ollamaProcess.on('exit', (code) => {
    updateHealth('ollamaStatus', 'crashed')
    logError('ollama', new Error(`Exited with code ${code}`))
  })

  const started = await waitForOllama()
  if (!started) throw new Error('Ollama failed to start')
  updateHealth('ollamaStatus', 'ready')
}

async function ensureModel(onProgress) {
  const model = getModel()
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
    const data = await r.json()
    const has = data.models?.some(m => m.name.startsWith(model))
    if (has) { updateHealth('ollamaStatus', 'ready'); return }
  } catch {}

  if (onProgress) onProgress(`Downloading ${model} (~2GB, one time only)...`)

  await new Promise((resolve, reject) => {
    const bin = (() => {
      try { execSync('which ollama', { stdio: 'ignore' }); return 'ollama' } catch {}
      return null
    })()
    if (!bin) return reject(new Error('Ollama not found'))
    const pull = spawn(bin, ['pull', model], { stdio: 'inherit' })
    pull.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error('Model pull failed'))
    })
  })
  updateHealth('ollamaStatus', 'ready')
}

async function stopOllama() {
  if (ollamaProcess) { ollamaProcess.kill(); ollamaProcess = null }
}

// ── Shims — delegate to llm.js ────────────────────────────────────────────────
// Kept so existing callers don't break. New code should import llm.js directly.

const ollamaCall   = (messages, maxTokens) => llmCall(messages, maxTokens)
const ollamaStream = (messages, onToken)   => llmStream(messages, onToken)

module.exports = { startOllama, stopOllama, ensureModel, ollamaCall, ollamaStream }
