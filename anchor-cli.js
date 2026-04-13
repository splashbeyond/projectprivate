#!/usr/bin/env node
'use strict'

// anchor-cli.js — terminal interface to Anchor's core
// Usage:
//   node anchor-cli.js "what's my primary goal"
//   node anchor-cli.js                          ← interactive REPL
//
// Loads the exact same modules the Electron app uses.
// No Electron needed — Ollama must be running.

const path    = require('path')
const os      = require('os')
const readline = require('readline')

const VAULT_PATH = path.join(os.homedir(), 'Documents', 'AnchorVault')
const CORE = (m) => require(path.join(__dirname, 'core', m))

// Boot the core stack
const { configure } = CORE('llm')
configure(VAULT_PATH)

const { detectIntent }  = CORE('intent')
const { matchSkill, executeSkill } = CORE('skill-engine')
const { buildContext }  = CORE('context-builder')
const { call: llmCall, stream: llmStream } = CORE('llm')

const ANSI = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  green:  '\x1b[32m',
  bold:   '\x1b[1m',
}

async function ask(message, opts = {}) {
  const { silent = false } = opts

  // 1. Intent check
  const intent = await detectIntent(message, VAULT_PATH)
  if (intent.matched) {
    if (!silent) process.stdout.write(`${ANSI.dim}[intent: ${intent.intent}]${ANSI.reset}\n`)
    return intent.response
  }

  // 2. Skill check
  const skillMatch = matchSkill(message, VAULT_PATH)
  if (skillMatch) {
    if (!silent) process.stdout.write(`${ANSI.dim}[skill: ${skillMatch.skill.name}]${ANSI.reset}\n`)
    return await executeSkill(skillMatch, VAULT_PATH, buildContext)
  }

  // 3. RAG + LLM
  const context = buildContext(message, VAULT_PATH)
  const msgs = [
    { role: 'system', content: context },
    { role: 'user',   content: message },
  ]

  if (silent) {
    return await llmCall(msgs)
  }

  // Streaming output for interactive mode
  let full = ''
  await llmStream(msgs, (tok) => {
    process.stdout.write(tok)
    full += tok
  })
  process.stdout.write('\n')
  return full
}

async function repl() {
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    prompt: `${ANSI.cyan}you${ANSI.reset} › `,
  })

  console.log(`${ANSI.bold}Anchor CLI${ANSI.reset} ${ANSI.dim}— vault: ${VAULT_PATH}${ANSI.reset}`)
  console.log(`${ANSI.dim}Type your message. Ctrl+C to exit.${ANSI.reset}\n`)

  rl.prompt()

  rl.on('line', async (line) => {
    const msg = line.trim()
    if (!msg) { rl.prompt(); return }

    process.stdout.write(`\n${ANSI.yellow}anchor${ANSI.reset} › `)
    try {
      const response = await ask(msg)
      // If intent handled it (non-streaming), print it now
      if (typeof response === 'string' && !response.includes('\x1b')) {
        console.log(response)
      }
    } catch (e) {
      console.error(`\n${ANSI.dim}Error: ${e.message}${ANSI.reset}`)
    }
    console.log()
    rl.prompt()
  })

  rl.on('close', () => {
    console.log('\nGoodbye.')
    process.exit(0)
  })
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    await repl()
  } else {
    const message = args.join(' ')
    try {
      const response = await ask(message, { silent: true })
      console.log(response)
    } catch (e) {
      console.error(`Error: ${e.message}`)
      process.exit(1)
    }
    process.exit(0)
  }
}

main()
