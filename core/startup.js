'use strict'

// Generates startup brief on every boot: last session topic + open threads + this week.

const { ollamaCall } = require('./ollama-manager')
const { readSession, readMemory, readFile } = require('./vault')
const { logError } = require('./health')

async function generateStartupBrief(vaultPath) {
  try {
    const session = readSession(vaultPath)
    const memory  = readMemory(vaultPath)
    const now     = readFile(vaultPath, 'now.md') || ''
    const name    = memory.userName || ''

    if (!session?.lastSession?.date) {
      return `Your vault is ready${name ? `, ${name}` : ''}. What do you want to work on?`
    }

    const days = Math.floor(
      (Date.now() - new Date(session.lastSession.date)) / 86400000
    )
    const when = days === 0 ? 'earlier today'
      : days === 1 ? 'yesterday' : `${days} days ago`

    const brief = await ollamaCall([{
      role: 'system',
      content: `Generate a startup brief. Direct, specific, under 120 words. No pleasantries. No "Welcome back!".

Format exactly:

Last session (${when}): [one sentence on what was discussed]

This week:
[3-4 bullet points from current state]

${session.lastSession.openThreads?.length > 0
  ? `Still open:\n${session.lastSession.openThreads.map(t => `- ${t}`).join('\n')}\n`
  : ''}
Where do you want to start?`,
    }, {
      role: 'user',
      content: JSON.stringify({
        lastSession:  session.lastSession,
        currentState: now,
        openThreads:  session.lastSession.openThreads || [],
      }),
    }], 200)

    return brief

  } catch (e) {
    logError('generateStartupBrief', e)
    return 'Ready. What do you want to work on?'
  }
}

// Alias used in old session.js interface
async function getGreeting(vaultPath) {
  return generateStartupBrief(vaultPath)
}

module.exports = { generateStartupBrief, getGreeting }
