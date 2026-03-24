'use strict'

// Master pipeline: intent first → skills second → RAG chat last.
// Two-step reasoning for complex queries.

const { ollamaCall }  = require('./ollama-manager')
const { buildContext } = require('./context-builder')
const { detectIntent } = require('./intent')
const { matchSkill, executeSkill } = require('./skill-engine')
const { logError }    = require('./health')

const SIMPLE_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|got it)/i,
  /^(show|list|open|read)\s.{0,40}$/i,
  /^what(?:'s| is) (?:my|the) \w+\??$/i,
  /^(how are you|are you ok|status)/i,
]

const DECISION_PATTERNS =
  /\b(should|decide|change|switch|cancel|start|stop|approve|reject|commit)\b/i

function isSimpleQuery(msg) {
  return SIMPLE_PATTERNS.some(p => p.test(msg.trim()))
}

async function compressHistory(history) {
  if (history.length < 6) return history
  const summary = await ollamaCall([{
    role: 'system',
    content: 'Summarise this conversation in 2 sentences. What was discussed and what was decided.',
  }, {
    role: 'user',
    content: history.map(m => `${m.role}: ${m.content}`).join('\n'),
  }], 80)
  return [
    { role: 'system', content: `PRIOR CONVERSATION: ${summary}` },
    ...history.slice(-4),
  ]
}

async function checkContradictions(response, vaultPath) {
  const fs   = require('fs')
  const path = require('path')
  const p    = path.join(vaultPath, 'Notes', 'decisions.md')
  if (!fs.existsSync(p)) return response
  const decisions = fs.readFileSync(p, 'utf8')
  if (!decisions.trim() || decisions.length < 50) return response
  const check = await ollamaCall([{
    role: 'system',
    content: 'Does this response contradict any past decision? Reply CONTRADICTION: [conflict] or CLEAR. Nothing else.',
  }, {
    role: 'user',
    content: `Response: ${response.slice(0, 500)}\n\nPast decisions:\n${decisions.slice(-800)}`,
  }], 80)
  return check.startsWith('CONTRADICTION')
    ? `⚠️ ${check}\n\n${response}` : response
}

async function processQuery(message, vaultPath, history, memoryEngine) {
  try {
    if (memoryEngine) memoryEngine.extractEntitiesAsync(message)

    const intent = await detectIntent(message, vaultPath)
    if (intent.matched) return intent.response

    const skillMatch = matchSkill(message, vaultPath)
    if (skillMatch) return await executeSkill(skillMatch, vaultPath, buildContext)

    const compressedHistory = await compressHistory(history)
    const context           = buildContext(message, vaultPath)

    if (isSimpleQuery(message)) {
      return await ollamaCall([
        { role: 'system', content: context },
        ...compressedHistory,
        { role: 'user', content: message },
      ])
    }

    const plan = await ollamaCall([{
      role: 'system',
      content: 'Two sentences only: what is being asked, and what context matters most to answer it well.',
    }, {
      role: 'user',
      content: `Question: ${message}\nContext preview: ${context.slice(0, 400)}`,
    }], 100)

    const response = await ollamaCall([
      { role: 'system', content: context },
      ...compressedHistory,
      { role: 'user', content: message },
      { role: 'assistant', content: `My reasoning: ${plan}\n\nAnswer:` },
    ])

    return DECISION_PATTERNS.test(message)
      ? await checkContradictions(response, vaultPath)
      : response

  } catch (e) {
    logError('processQuery', e)
    return 'Something went wrong. Please try again.'
  }
}

module.exports = { processQuery }
