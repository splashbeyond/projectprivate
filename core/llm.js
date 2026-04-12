'use strict'

// Provider-agnostic LLM adapter.
// Supports Ollama (default) and any OpenAI-compatible endpoint
// (LM Studio, LocalAI, llama.cpp server, etc.)
//
// Config lives in anchor-memory.json:
//   model       — model name, e.g. "llama3.2:3b" or "mistral:7b"
//   llmProvider — "ollama" (default) | "openai-compat"
//   llmBaseUrl  — base URL, default "http://127.0.0.1:11434"
//
// To switch providers, update anchor-memory.json — no code changes needed.

const { logError } = require('./health')

const TIMEOUT_MS  = 30_000
const MAX_RETRIES = 3

let _vaultPath = null

function configure(vaultPath) { _vaultPath = vaultPath }

function getConfig() {
  if (_vaultPath) {
    try {
      const { readMemory } = require('./vault')
      const mem = readMemory(_vaultPath)
      return {
        model:    mem.model       || 'llama3.2:3b',
        provider: mem.llmProvider || 'ollama',
        baseUrl:  mem.llmBaseUrl  || 'http://127.0.0.1:11434',
      }
    } catch {}
  }
  return { model: 'llama3.2:3b', provider: 'ollama', baseUrl: 'http://127.0.0.1:11434' }
}

function getModel()    { return getConfig().model }
function getProvider() { return getConfig().provider }

function chatUrl(config) {
  return config.provider === 'ollama'
    ? `${config.baseUrl}/api/chat`
    : `${config.baseUrl}/v1/chat/completions`
}

function buildBody(config, messages, isStream, maxTokens) {
  const body = { model: config.model, messages, stream: isStream }
  if (config.provider === 'ollama') {
    if (maxTokens) body.options = { num_predict: maxTokens }
  } else {
    if (maxTokens) body.max_tokens = maxTokens
  }
  return JSON.stringify(body)
}

function extractContent(config, data) {
  return config.provider === 'ollama'
    ? (data.message?.content || '')
    : (data.choices?.[0]?.message?.content || '')
}

// ── Non-streaming call with retry ─────────────────────────────────────────────

async function call(messages, maxTokens = null, attempt = 0) {
  const config = getConfig()
  try {
    const res = await fetch(chatUrl(config), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    buildBody(config, messages, false, maxTokens),
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`LLM returned ${res.status}`)
    return extractContent(config, await res.json())
  } catch (e) {
    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      return call(messages, maxTokens, attempt + 1)
    }
    logError('llm:call', e)
    return 'I am having trouble thinking right now. Please try again in a moment.'
  }
}

// ── Streaming call ────────────────────────────────────────────────────────────

async function stream(messages, onToken) {
  const config = getConfig()
  const res = await fetch(chatUrl(config), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    buildBody(config, messages, true, null),
    signal:  AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`LLM returned ${res.status}`)

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const lines = decoder.decode(value).split('\n').filter(Boolean)
    for (const line of lines) {
      // OpenAI-compat uses SSE "data: {...}" framing; Ollama uses raw JSON lines
      const text = line.startsWith('data: ') ? line.slice(6) : line
      if (text === '[DONE]') continue
      try {
        const parsed = JSON.parse(text)
        const tok = config.provider === 'ollama'
          ? parsed.message?.content
          : parsed.choices?.[0]?.delta?.content
        if (tok) onToken(tok)
      } catch {}
    }
  }
}

// ── Raw prompt (single string, no messages array) ─────────────────────────────
// Used for metadata/summary extraction in daily-log.js.
// Ollama: uses /api/generate. OpenAI-compat: wraps as a user message.

async function raw(prompt) {
  const config = getConfig()
  if (config.provider === 'ollama') {
    try {
      const res = await fetch(`${config.baseUrl}/api/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: config.model, prompt, stream: false }),
        signal:  AbortSignal.timeout(TIMEOUT_MS),
      })
      const data = await res.json()
      return data.response || ''
    } catch (e) {
      logError('llm:raw', e)
      return ''
    }
  }
  // OpenAI-compat: treat as a single user turn
  return call([{ role: 'user', content: prompt }])
}

module.exports = { configure, getModel, getProvider, getConfig, call, stream, raw }
