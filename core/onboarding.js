'use strict'

const fs   = require('fs')
const path = require('path')

const ONBOARDING_SYSTEM = `You are Anchor, a private AI workspace assistant meeting the user for the very first time.

Your tone is warm, happy, and professional.
You are genuinely excited to work with this person.

Introduce yourself as:
"I am your private AI workspace. Everything I learn stays on your machine. I access your files, help you think, automate your work, and get smarter the longer we work together. Think of me as a colleague who never forgets and never shares your data."

Ask exactly one question at a time in this order:
1. Ask for their name
2. Ask what they want to call you (default: Anchor)
3. Ask about their role and industry
4. Ask about their biggest daily frustrations
5. Ask about their primary goals
6. Ask how they prefer you to communicate
7. Ask what their vault will mostly contain
8. Ask working hours for scheduling
9. Summarise everything back to them
10. Ask them to confirm
11. When confirmed end with exactly: "Your vault is ready. Let us get to work."

Rules:
- One question per message — never combine
- Warm, short, human messages
- Store every goal, person, project mentioned
- After confirmation write all system files`

const EXTRACT_PROMPT = (conv) => `Extract user data from this onboarding conversation and return ONLY valid JSON.

Conversation:
${conv}

Return exactly this JSON structure:
{
  "userName": "",
  "anchorName": "Anchor",
  "role": "",
  "industry": "",
  "goals": "",
  "commStyle": "",
  "vaultContents": "",
  "workingHours": "9am-6pm"
}`

function isOnboardingComplete(response) {
  return response.toLowerCase().includes("your vault is ready. let us get to work")
}

async function extractOnboardingData(history) {
  const { askOllamaRaw } = require('./ollama')
  const conv = history.map(m => `${m.role}: ${m.content}`).join('\n')
  try {
    const raw = await askOllamaRaw(EXTRACT_PROMPT(conv))
    const m   = raw.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
  } catch (e) {
    console.error('Onboarding extraction failed:', e.message)
  }
  return {}
}

async function writeOnboardingFiles(data, vaultPath) {
  const { TEMPLATES, DEFAULT_MEMORY, DEFAULT_SESSION } = require('./templates')
  const { writeNote } = require('./vault')

  const ud = {
    userName:      data.userName     || 'User',
    anchorName:    data.anchorName   || 'Anchor',
    role:          data.role         || '',
    industry:      data.industry     || '',
    goals:         data.goals        || '',
    commStyle:     data.commStyle    || 'conversational',
    vaultContents: data.vaultContents || '',
    workingHours:  data.workingHours  || '9am-6pm',
  }

  // Build ANCHOR.md from template with user data
  let anchorMd = TEMPLATES['ANCHOR.md']()
  anchorMd = anchorMd
    .replace(/\[USER_NAME\]/g,     ud.userName)
    .replace(/\[USER_ROLE\]/g,     ud.role)
    .replace(/\[USER_INDUSTRY\]/g, ud.industry)
    .replace(/\[USER_HOURS\]/g,    ud.workingHours)
    .replace(/\[USER_GOALS\]/g,    ud.goals)
    .replace(/\[USER_COMM_STYLE\]/g, ud.commStyle)
    .replace('false', 'true') // onboarding complete
  writeNote(vaultPath, 'ANCHOR.md', anchorMd)

  // Write memory
  const mem = { ...DEFAULT_MEMORY(), ...ud }
  fs.writeFileSync(
    path.join(vaultPath, 'anchor-memory.json'),
    JSON.stringify(mem, null, 2), 'utf8'
  )

  // Write session
  const ses = { ...DEFAULT_SESSION(), onboardingComplete: true, userName: ud.userName, anchorName: ud.anchorName }
  fs.writeFileSync(
    path.join(vaultPath, 'anchor-session.json'),
    JSON.stringify(ses, null, 2), 'utf8'
  )

  // Seed goals.md if goals provided
  if (ud.goals) {
    fs.appendFileSync(
      path.join(vaultPath, 'goals.md'),
      `\n- ${ud.goals}`
    )
  }
}

module.exports = {
  ONBOARDING_SYSTEM,
  isOnboardingComplete,
  extractOnboardingData,
  writeOnboardingFiles,
}
