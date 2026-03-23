'use strict'

const fs   = require('fs')
const path = require('path')
const { DEFAULT_SESSION } = require('./templates')

const sesPath = (vaultPath) => path.join(vaultPath, 'anchor-session.json')

function readSession(vaultPath) {
  try {
    return { ...DEFAULT_SESSION(), ...JSON.parse(fs.readFileSync(sesPath(vaultPath), 'utf8')) }
  } catch {
    return DEFAULT_SESSION()
  }
}

function writeSession(vaultPath, data) {
  fs.writeFileSync(sesPath(vaultPath), JSON.stringify(data, null, 2), 'utf8')
}

function getGreeting(vaultPath) {
  const ses = readSession(vaultPath)
  const { readMemory } = require('./memory')
  const mem = readMemory(vaultPath)
  const name = mem.userName ? `, ${mem.userName}` : ''

  if (!ses.lastSession) return `Welcome back${name}.`

  const days = Math.floor(
    (Date.now() - new Date(ses.lastSession.date)) / 86400000
  )
  const when = days === 0 ? 'earlier today'
    : days === 1 ? 'yesterday'
    : `${days} days ago`

  return `Welcome back${name}. Last time (${when}) we discussed: ${ses.lastSession.topic}.`
}

async function saveSessionOnExit(vaultPath, history) {
  if (history.length < 2) return
  const { askOllamaRaw } = require('./ollama')
  const conv = history.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n')
  try {
    const topic = await askOllamaRaw(
      `In one short sentence, what was this conversation about?\n\n${conv}`
    )
    const ses = readSession(vaultPath)
    ses.lastSession = {
      date: new Date().toISOString().split('T')[0],
      topic: topic.trim().slice(0, 150),
      messageCount: history.length,
    }
    writeSession(vaultPath, ses)
  } catch (e) {
    console.error('Session save failed:', e.message)
  }
}

module.exports = { readSession, writeSession, getGreeting, saveSessionOnExit }
