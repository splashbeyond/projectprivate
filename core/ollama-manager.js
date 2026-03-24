'use strict'

// Ollama lifecycle + chat calls. Retry, 30s timeout, crash recovery.
// Also exposes ollamaStream for streaming token output to the UI.

const { execSync, spawn } = require('child_process')
const fs   = require('fs')
const { logError, updateHealth } = require('./health')

const MODEL      = 'llama3.2:3b'
const OLLAMA_URL = 'http://127.0.0.1:11434'
const TIMEOUT_MS = 30000
const MAX_RETRIES = 3

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
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
    const data = await r.json()
    const has = data.models?.some(m => m.name.startsWith(MODEL))
    if (has) { updateHealth('ollamaStatus', 'ready'); return }
  } catch {}

  if (onProgress) onProgress(`Downloading ${MODEL} (~2GB, one time only)...`)

  await new Promise((resolve, reject) => {
    const bin = (() => {
      try { execSync('which ollama', { stdio: 'ignore' }); return 'ollama' } catch {}
      return null
    })()
    if (!bin) return reject(new Error('Ollama not found'))
    const pull = spawn(bin, ['pull', MODEL], { stdio: 'inherit' })
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

// ── Chat (non-streaming) ──────────────────────────────────────────────────────

async function ollamaCall(messages, maxTokens = null, attempt = 0) {
  try {
    const body = { model: MODEL, messages, stream: false }
    if (maxTokens) body.options = { num_predict: maxTokens }

    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!res.ok) throw new Error(`Ollama returned ${res.status}`)
    const data = await res.json()
    return data.message?.content || ''

  } catch (e) {
    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      return ollamaCall(messages, maxTokens, attempt + 1)
    }
    logError('ollamaCall', e)
    return 'I am having trouble thinking right now. Please try again in a moment.'
  }
}

// ── Chat (streaming) ──────────────────────────────────────────────────────────

async function ollamaStream(messages, onToken) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model: MODEL, messages, stream: true }),
    signal:  AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) throw new Error(`Ollama returned ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const lines = decoder.decode(value).split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.message?.content) onToken(parsed.message.content)
      } catch {}
    }
  }
}

module.exports = { startOllama, stopOllama, ensureModel, ollamaCall, ollamaStream }
