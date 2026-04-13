#!/usr/bin/env node
'use strict'

// anchor-eval.js — automated quality eval for the feedback loop
//
// Usage:
//   node anchor-eval.js          ← run all tests, print report, write to vault
//   node anchor-eval.js --quick  ← intent + context only, skip model calls
//
// Output:
//   stdout: pass/fail summary
//   ~/Documents/AnchorVault/Eval/latest.md  ← Claude reads this on /loop
//
// The eval covers four layers:
//   1. Intent accuracy  — does the right intent fire (or not fire)?
//   2. Context quality  — is the right data in the system prompt?
//   3. Response quality — does the model answer correctly?
//   4. Regression guard — things that were broken and got fixed stay fixed

const path = require('path')
const os   = require('os')
const fs   = require('fs')

const VAULT_PATH = path.join(os.homedir(), 'Documents', 'AnchorVault')
const CORE = (m) => require(path.join(__dirname, 'core', m))

const { configure } = CORE('llm')
configure(VAULT_PATH)

const { detectIntent }  = CORE('intent')
const { buildContext }  = CORE('context-builder')
const { matchSkill }    = CORE('skill-engine')
const { call: llmCall } = CORE('llm')

const QUICK = process.argv.includes('--quick')

// ── Test definitions ──────────────────────────────────────────────────────────

// Intent tests: message → expected intent name (or null = should NOT match)
const INTENT_TESTS = [
  // Should fire
  { msg: 'remind me to call John at 3pm',         expect: 'reminder_set' },
  { msg: 'remind me about the standup in 30 minutes', expect: 'reminder_set' },
  { msg: 'show my reminders',                     expect: 'reminder_list' },
  { msg: 'i need to send the proposal',           expect: 'todo_add' },
  { msg: 'add task: review the contract',         expect: 'todo_add' },
  { msg: 'i finished the client brief',           expect: 'todo_done' },
  { msg: 'what do i need to do',                  expect: 'todo_list' },
  { msg: 'when do i need to send an email',       expect: 'task_query' },
  { msg: 'remember that my password is 1234',     expect: 'remember' },
  { msg: 'recall our chat about the pitch deck',  expect: 'recall_topic' },
  { msg: 'what happened today',                   expect: 'calendar_lookup' },
  { msg: 'what happened yesterday',               expect: 'calendar_lookup' },
  // Should NOT fire (false positive regressions)
  { msg: 'when do i need to send an email to st pete?', expect: 'task_query' },   // was misfiring as todo_add
  { msg: 'what do you think i need to work on?',  expect: null },                 // "i need to" should NOT add task
  { msg: 'do i have any meetings today?',         expect: null },                 // shouldn't trigger todo
  { msg: 'can you help me think through what i should do?', expect: null },
]

// Context tests: message → keys that MUST appear in the system prompt
const CONTEXT_TESTS = [
  { msg: "what's my primary goal",    mustContain: ['Goals:', 'making money'] },
  { msg: "what's my name",            mustContain: ['Name: Davis'] },
  { msg: "what do i do for work",     mustContain: ['Role:'] },
]

// Response quality tests (model calls — skipped with --quick)
// Each test scores the model's response against keyword expectations
const RESPONSE_TESTS = [
  {
    msg: "what's my primary goal",
    mustInclude: ['money', 'business', 'success'],   // at least 1 of these
    mustNotInclude: ["don't have", "not in my vault", "test of my behavior"],
  },
  {
    msg: "what's my name",
    mustInclude: ['Davis'],
    mustNotInclude: ["don't know", "not sure"],
  },
  {
    msg: "remind me to test in 1 minute",
    mustInclude: ['reminder', 'set', '1 min'],
    mustNotInclude: [],
  },
  {
    msg: "what do i need to do",
    // Should return now.md content, not a generic answer
    mustInclude: ['- [ ]', '- [x]', 'This week', 'No tasks'],  // any of these
    mustNotInclude: ["don't have", "not sure"],
  },
  {
    msg: "how are you",
    mustInclude: ['vault', 'local', 'memory'],
    mustNotInclude: [],
  },
]

// ── Runner ────────────────────────────────────────────────────────────────────

const results = { pass: 0, fail: 0, tests: [] }

function record(name, passed, detail = '') {
  results.tests.push({ name, passed, detail })
  if (passed) results.pass++
  else results.fail++
  const icon = passed ? '✓' : '✗'
  const color = passed ? '\x1b[32m' : '\x1b[31m'
  console.log(`  ${color}${icon}\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
}

async function runIntentTests() {
  console.log('\n\x1b[1mIntent accuracy\x1b[0m')
  for (const t of INTENT_TESTS) {
    const result = await detectIntent(t.msg, VAULT_PATH)
    const fired  = result.matched ? result.intent : (result.sideEffect || null)

    if (t.expect === null) {
      // Should NOT match any intent
      record(
        `"${t.msg.slice(0, 50)}" → no intent`,
        !result.matched && !result.sideEffect,
        result.matched ? `fired ${result.intent} (false positive)` : ''
      )
    } else {
      record(
        `"${t.msg.slice(0, 50)}" → ${t.expect}`,
        fired === t.expect,
        fired !== t.expect ? `got "${fired}"` : ''
      )
    }
  }
}

async function runContextTests() {
  console.log('\n\x1b[1mContext quality\x1b[0m')
  for (const t of CONTEXT_TESTS) {
    const ctx = buildContext(t.msg, VAULT_PATH)
    const missing = t.mustContain.filter(k => !ctx.includes(k))
    record(
      `"${t.msg}" contains [${t.mustContain.join(', ')}]`,
      missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : ''
    )
  }
}

async function runResponseTests() {
  console.log('\n\x1b[1mResponse quality\x1b[0m')
  for (const t of RESPONSE_TESTS) {
    try {
      // Check intent first — if intent handles it, use that response
      const intent = await detectIntent(t.msg, VAULT_PATH)
      let response = ''
      if (intent.matched) {
        response = intent.response
      } else {
        const ctx = buildContext(t.msg, VAULT_PATH)
        response  = await llmCall([
          { role: 'system', content: ctx },
          { role: 'user',   content: t.msg },
        ], 200)
      }

      const lower       = response.toLowerCase()
      const missingGood = t.mustInclude.length > 0 && !t.mustInclude.some(k => lower.includes(k.toLowerCase()))
      const foundBad    = t.mustNotInclude.find(k => lower.includes(k.toLowerCase()))

      const passed = !missingGood && !foundBad
      let detail = ''
      if (missingGood) detail = `missing one of: [${t.mustInclude.join(', ')}]`
      if (foundBad)    detail = `contained forbidden: "${foundBad}"`

      record(`"${t.msg.slice(0, 45)}"`, passed, detail)
    } catch (e) {
      record(`"${t.msg.slice(0, 45)}"`, false, `error: ${e.message}`)
    }
  }
}

function writeReport() {
  const date      = new Date().toISOString()
  const total     = results.pass + results.fail
  const pct       = Math.round((results.pass / total) * 100)
  const failures  = results.tests.filter(t => !t.passed)

  const lines = [
    `# Anchor Eval Report`,
    `Date: ${date}`,
    `Score: ${results.pass}/${total} (${pct}%)`,
    '',
  ]

  if (failures.length === 0) {
    lines.push('All tests passed.')
  } else {
    lines.push(`## Failures (${failures.length})`)
    for (const f of failures) {
      lines.push(`- ${f.name}${f.detail ? ': ' + f.detail : ''}`)
    }
  }

  lines.push('')
  lines.push('## All results')
  for (const t of results.tests) {
    lines.push(`- ${t.passed ? '✓' : '✗'} ${t.name}${t.detail ? ' — ' + t.detail : ''}`)
  }

  const dir = path.join(VAULT_PATH, 'Eval')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'latest.md'), lines.join('\n'))

  // Keep a dated copy too
  const stamp = date.split('T')[0]
  fs.writeFileSync(path.join(dir, `${stamp}.md`), lines.join('\n'))

  return { total, pct, failures }
}

async function main() {
  console.log('\x1b[1mAnchor Eval\x1b[0m\x1b[2m — ' + (QUICK ? 'quick mode' : 'full') + '\x1b[0m')

  await runIntentTests()
  await runContextTests()
  if (!QUICK) await runResponseTests()

  const { total, pct, failures } = writeReport()

  console.log(`\n\x1b[1mResult: ${results.pass}/${total} (${pct}%)\x1b[0m`)
  if (failures.length) {
    console.log(`\x1b[31m${failures.length} failure(s) — see AnchorVault/Eval/latest.md\x1b[0m`)
    process.exit(1)
  } else {
    console.log('\x1b[32mAll tests passed\x1b[0m')
    process.exit(0)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
