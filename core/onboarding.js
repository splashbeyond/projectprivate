'use strict'

// Single-question warm onboarding. Max 3 messages. Confirm identity before locking in.

const { ollamaCall }    = require('./ollama-manager')
const { safeParseJSON } = require('./safe-parse')
const { readSession, writeSession, writeMemory, readFile, writeFile } = require('./vault')
const { logError } = require('./health')

const ONBOARDING_PROMPT = `You are Anchor — a private AI workspace meeting someone for the very first time.

Your personality right now:
- Genuinely warm and curious — interested in this person and their work
- Confident and direct — you know exactly what you are and what you do
- Not a chatbot — a capable colleague who will actually help them
- A little excited, because interesting work is about to happen

What you do in this conversation:
1. Introduce yourself in 2-3 sentences. Be real and specific.
   Example: "I'm Anchor — your private AI workspace. I live on your machine,
   learn from your files, and get sharper the longer we work together.
   Nothing I learn ever leaves your device."
2. Ask ONE question only: "What do you do, and what's been getting in your way lately?"
3. Listen carefully. Extract everything from their answer.
4. Reflect back what you understood in one sentence — show you actually listened.
5. Say exactly: "Your vault is ready."

Rules — no exceptions:
- ONE question only. Never ask a follow-up even if the answer is very short.
- If they give very little, work with what you have.
- Sound like a real person talking, not a product setup flow.
- No bullet points in your introduction — just speak naturally.
- Keep the whole thing under 3 messages.`

const ONBOARDING_SYSTEM = ONBOARDING_PROMPT

async function runOnboarding(userMessage, history, vaultPath) {
  const response = await ollamaCall([
    { role: 'system', content: ONBOARDING_PROMPT },
    ...history,
    { role: 'user', content: userMessage },
  ])

  if (response.includes('vault is ready')) {
    await finaliseOnboarding([
      ...history,
      { role: 'user',      content: userMessage },
      { role: 'assistant', content: response    },
    ], vaultPath)
  }

  return response
}

async function finaliseOnboarding(fullHistory, vaultPath) {
  const conversation = fullHistory.map(m => `${m.role}: ${m.content}`).join('\n')
  const raw = await ollamaCall([{
    role: 'system',
    content: `Extract from this onboarding conversation.
Return ONLY valid JSON. No commentary. No markdown.
{
  "userName": "",
  "anchorName": "Anchor",
  "role": "",
  "industry": "",
  "goals": "",
  "painPoints": "",
  "commStyle": "conversational",
  "workingHours": "9am-6pm"
}`,
  }, { role: 'user', content: conversation }], 250)

  const data = safeParseJSON(raw, {
    userName: '', anchorName: 'Anchor', role: '', industry: '',
    goals: '', painPoints: '', commStyle: 'conversational', workingHours: '9am-6pm',
  })

  writeIdentityMd(vaultPath, data)
  writeMemory(vaultPath, {
    userName:     data.userName     || '',
    anchorName:   data.anchorName   || 'Anchor',
    role:         data.role         || '',
    industry:     data.industry     || '',
    goals:        data.goals        || '',
    commStyle:    data.commStyle    || 'conversational',
    workingHours: data.workingHours || '9am-6pm',
    entities: {}, userDefined: [], skillUsage: {},
    lastUpdated: new Date().toISOString(),
  })

  const session = readSession(vaultPath) || {}
  session.onboardingComplete = true
  session.identityConfirmed  = false
  session.lastSession        = null
  writeSession(vaultPath, session)
}

async function extractOnboardingData(history) {
  const conversation = history.map(m => `${m.role}: ${m.content}`).join('\n')
  const raw = await ollamaCall([{
    role: 'system',
    content: `Extract from this onboarding conversation.
Return ONLY valid JSON. No commentary. No markdown.
{
  "userName": "",
  "anchorName": "Anchor",
  "role": "",
  "industry": "",
  "goals": "",
  "painPoints": "",
  "commStyle": "conversational",
  "workingHours": "9am-6pm"
}`,
  }, { role: 'user', content: conversation }], 250)
  return safeParseJSON(raw, {
    userName: '', anchorName: 'Anchor', role: '', industry: '',
    goals: '', painPoints: '', commStyle: 'conversational', workingHours: '9am-6pm',
  })
}

async function writeOnboardingFiles(data, vaultPath) {
  writeIdentityMd(vaultPath, data)
  writeMemory(vaultPath, {
    userName:     data.userName     || '',
    anchorName:   data.anchorName   || 'Anchor',
    role:         data.role         || '',
    industry:     data.industry     || '',
    goals:        data.goals        || '',
    commStyle:    data.commStyle    || 'conversational',
    workingHours: data.workingHours || '9am-6pm',
    entities: {}, userDefined: [], skillUsage: {},
    lastUpdated: new Date().toISOString(),
  })
  const session = readSession(vaultPath) || {}
  session.onboardingComplete = true
  session.identityConfirmed  = false
  writeSession(vaultPath, session)
}

function writeIdentityMd(vaultPath, data) {
  const name     = data.anchorName || 'Anchor'
  const userName = data.userName   || 'my user'

  const content = `# Identity

I am ${name}. I work for ${userName}.
I run 100% locally. Nothing leaves this machine.

## ${userName}
Role: ${data.role || ''}
Industry: ${data.industry || ''}
Communication: ${data.commStyle || 'conversational'}
Working hours: ${data.workingHours || '9am-6pm'}

## Primary goals
${data.goals || 'To be defined'}

## Pain points
${data.painPoints || 'To be defined'}

## How I behave
- Answer from vault context first, always
- Say "I don't have that" rather than guess
- Cite sources as [Note: filename]
- Read now.md before every response
- Read people.md the moment a name appears
- Check skills.md when a task matches a known skill
- Never contradict a past decision without flagging it
- Never hallucinate dates, numbers, names, or facts

## Confidence rules — non-negotiable
Clear evidence: answer directly, cite [Note: filename]
Partial evidence: "Based on [Note], it seems..."
No evidence: "I don't have that in my vault"
Uncertain fact: stop and say you cannot verify it
About to assume: stop and flag it instead

## Tone
Direct. Warm. No padding. No filler phrases.
Never say "Certainly!" — get to the point.
Match the user's energy. Sound like a smart colleague, not an AI assistant.

## Reasoning approach
Before answering complex questions:
- Identify what is actually being asked
- Identify what vault context is most relevant
- Note what you are confident about versus uncertain
Then give a clear grounded answer. Show reasoning briefly.

## Natural language understanding
Understand intent not just literal words.
"remind me to call John" — add todo
"I just closed the deal" — log a win
"I have an idea" — capture to ideas.md
"what's on today" — show now.md
These work without the user knowing commands exist.

## Onboarding complete
true`

  writeFile(vaultPath, 'identity.md', content)
}

async function confirmIdentity(vaultPath) {
  const identity = readFile(vaultPath, 'identity.md') || ''
  return `Here is what I understood about you:\n\n${identity}\n\nDoes this look right? Say yes to confirm or tell me what to change.`
}

async function handleIdentityConfirmation(userMessage, vaultPath) {
  const lower     = userMessage.toLowerCase()
  const confirmed = ['yes', 'correct', 'good', 'looks right', "that's right",
    'perfect', 'yep', 'yeah', 'looks good'].some(w => lower.includes(w))

  if (confirmed) {
    const session = readSession(vaultPath) || {}
    session.identityConfirmed = true
    writeSession(vaultPath, session)
    return `Perfect. Let's get to work.`
  }

  const current = readFile(vaultPath, 'identity.md') || ''
  const updated = await ollamaCall([{
    role: 'system',
    content: 'Update this identity.md based on the correction. Return the complete updated file only. No commentary.',
  }, {
    role: 'user',
    content: `Current:\n${current}\n\nCorrection: ${userMessage}`,
  }])

  writeFile(vaultPath, 'identity.md', updated)
  return await confirmIdentity(vaultPath)
}

function isOnboardingComplete(vaultPath) {
  return !!readSession(vaultPath)?.onboardingComplete
}

module.exports = {
  ONBOARDING_SYSTEM,
  runOnboarding, finaliseOnboarding,
  extractOnboardingData, writeOnboardingFiles,
  confirmIdentity, handleIdentityConfirmation,
  isOnboardingComplete,
}
