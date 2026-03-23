'use strict'

// PRIVACY: All network calls go to localhost:11434 only. Zero data egress.

const { execSync, spawn } = require('child_process')
const { readMemory }  = require('./memory')
const { readSession } = require('./session')
const { findRelevant } = require('./search')
const { readNote, noteExists } = require('./vault')
const path = require('path')
const fs   = require('fs')

const OLLAMA_URL = 'http://127.0.0.1:11434'
const MODEL      = 'llama3.2:3b' // fixed — do not change

let ollamaProcess = null
let vaultPath     = null

function setVaultPath(p) { vaultPath = p }

// ── Ollama lifecycle ──────────────────────────────────────────────────────────

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
  // Check if already running
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`)
    if (r.ok) return
  } catch {}

  // Try system ollama first, then bundled binary
  const bin = (() => {
    try { execSync('which ollama', { stdio: 'ignore' }); return 'ollama' } catch {}
    if (binaryPath && fs.existsSync(binaryPath)) return binaryPath
    return null
  })()

  if (!bin) throw new Error('Ollama not found. Install from https://ollama.ai')

  ollamaProcess = spawn(bin, ['serve'], { detached: true, stdio: 'ignore' })
  ollamaProcess.unref()

  const started = await waitForOllama()
  if (!started) throw new Error('Ollama failed to start')
}

async function ensureModel() {
  const r = await fetch(`${OLLAMA_URL}/api/tags`)
  const { models = [] } = await r.json()
  if (models.some(m => m.name.startsWith(MODEL))) return

  // Pull model — returns a stream we ignore for now
  await new Promise((resolve, reject) => {
    const p = spawn('ollama', ['pull', MODEL], { stdio: 'inherit' })
    p.on('close', code => code === 0 ? resolve() : reject(new Error('Pull failed')))
  })
}

function stopOllama() {
  if (ollamaProcess) { ollamaProcess.kill(); ollamaProcess = null }
}

// ── Core Ollama calls ─────────────────────────────────────────────────────────

async function ollamaCall(messages, maxTokens = null) {
  const body = { model: MODEL, messages, stream: false }
  if (maxTokens) body.options = { num_predict: maxTokens }
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)
  const data = await res.json()
  return data.message?.content || ''
}

// Streaming version — calls onToken(chunk) for each token
async function ollamaStream(messages, onToken) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model: MODEL, messages, stream: true }),
  })
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)

  let full = ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const lines = decoder.decode(value).split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const data = JSON.parse(line)
        const tok  = data.message?.content || ''
        if (tok) { onToken(tok); full += tok }
      } catch {}
    }
  }
  return full
}

async function askOllamaRaw(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model: MODEL, prompt, stream: false }),
  })
  const data = await res.json()
  return data.response || ''
}

// ── Recall system ─────────────────────────────────────────────────────────────

function buildRecallContext() {
  if (!vaultPath) return ''
  const memory  = readMemory(vaultPath)
  const session = readSession(vaultPath)
  const parts   = []

  // Remembered facts — highest priority
  if (memory.userDefined?.length > 0) {
    parts.push('REMEMBERED FACTS (always use these):\n' +
      memory.userDefined.map(f => `- ${f.fact}`).join('\n')
    )
  }

  // User profile
  const profile = [
    memory.userName   ? `Name: ${memory.userName}`        : '',
    memory.role       ? `Role: ${memory.role}`            : '',
    memory.industry   ? `Industry: ${memory.industry}`    : '',
    memory.goals      ? `Goals: ${memory.goals}`          : '',
    memory.commStyle  ? `Comm style: ${memory.commStyle}` : '',
  ].filter(Boolean).join('\n')
  if (profile) parts.push(`USER PROFILE:\n${profile}`)

  // Known entities — capped at 10 for speed
  if (Object.keys(memory.entities || {}).length > 0) {
    parts.push('KNOWN ENTITIES:\n' +
      Object.entries(memory.entities)
        .slice(0, 10)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join('\n')
    )
  }

  // Last session
  if (session?.lastSession) {
    const days = Math.floor(
      (Date.now() - new Date(session.lastSession.date)) / 86400000
    )
    const when = days === 0 ? 'earlier today'
      : days === 1 ? 'yesterday'
      : `${days} days ago`
    parts.push(`LAST SESSION (${when}): ${session.lastSession.topic}`)
  }

  return parts.join('\n\n')
}

function getCommandCenter() {
  if (!vaultPath) return 'You are Anchor, a private AI assistant.'
  try { return readNote(vaultPath, 'ANCHOR.md') } catch { return '' }
}

function buildSystemPrompt(vaultContext, matchedSkill) {
  return [
    getCommandCenter(),
    buildRecallContext() ? `\nMEMORY AND RECALL:\n${buildRecallContext()}` : '',
    matchedSkill ? `\nACTIVE SKILL — ${matchedSkill.name}:\n${matchedSkill.instructions}` : '',
    vaultContext  ? `\nVAULT CONTEXT:\n${vaultContext}` : '',
    '\nPRIVACY: Closed local system. Never transmit vault content externally.',
  ].filter(Boolean).join('\n')
}

// ── Simple vs complex query ───────────────────────────────────────────────────

const SIMPLE_PATTERNS = [
  /^(hi|hello|hey|thanks|ok|yes|no|sure)/i,
  /^(show|list|open|read)\s.{0,30}$/i,
  /^what(?:'s| is) (?:my|the) \w+\??$/i,
]

function isSimpleQuery(msg) {
  return SIMPLE_PATTERNS.some(p => p.test(msg.trim()))
}

// ── Main reasoning pipeline ───────────────────────────────────────────────────

async function askAnchor(question, history = [], onToken = null) {
  const { findSkill } = require('./skills')
  const vaultContext  = findRelevant(question)
  const matchedSkill  = vaultPath ? findSkill(question, vaultPath) : null
  const systemPrompt  = buildSystemPrompt(vaultContext, matchedSkill)

  // Keep last 10 messages only
  const recent = history.slice(-10)

  if (isSimpleQuery(question)) {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...recent,
      { role: 'user', content: question },
    ]
    if (onToken) return await ollamaStream(messages, onToken)
    return await ollamaCall(messages)
  }

  // Complex query — planning pass first (100 tokens, fast)
  const planningResult = await ollamaCall([
    {
      role:    'system',
      content: 'You are a reasoning planner. In 2 sentences max identify: what is being asked and what context is most relevant. Be brief.',
    },
    {
      role:    'user',
      content: `Question: ${question}\nContext preview: ${vaultContext.slice(0, 300)}`,
    },
  ], 100)

  // Full answer informed by planning
  const messages = [
    { role: 'system', content: systemPrompt },
    ...recent,
    { role: 'user', content: question },
    { role: 'assistant', content: `I have considered: ${planningResult}\n\nMy answer:` },
  ]

  if (onToken) return await ollamaStream(messages, onToken)
  return await ollamaCall(messages)
}

// Structured extraction — precise output format
async function askOllamaStructured(instruction, context, outputFormat) {
  return await ollamaCall([{
    role:    'system',
    content: `Extract precisely. Return in exactly this format:\n\n${outputFormat}\n\nDo not deviate.`,
  }, {
    role:    'user',
    content: `${instruction}\n\nContent:\n${context}`,
  }])
}

module.exports = {
  startOllama, stopOllama, ensureModel, setVaultPath,
  askAnchor, askOllamaRaw, askOllamaStructured, ollamaStream,
}
