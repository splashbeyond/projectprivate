'use strict'

// 4-strategy JSON fallback. Used everywhere — no raw JSON.parse() calls elsewhere.

function safeParseJSON(raw, fallback = {}) {
  if (!raw || typeof raw !== 'string') return fallback

  try { return JSON.parse(raw) } catch {}

  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]+?)```/)
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()) } catch {}
  }

  const objMatch = raw.match(/\{[\s\S]+\}/)
  if (objMatch) {
    try { return JSON.parse(objMatch[0]) } catch {}
  }

  const arrMatch = raw.match(/\[[\s\S]+\]/)
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]) } catch {}
  }

  try {
    require('./health').logError('safe-parse',
      new Error(`All strategies failed: ${raw.slice(0, 100)}`))
  } catch {}

  return fallback
}

module.exports = { safeParseJSON }
