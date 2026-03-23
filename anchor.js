#!/usr/bin/env node
// PRIVACY: All network calls go to localhost only. Zero data egress.

'use strict';

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const { execSync, spawn } = require('child_process');

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const HOME   = process.env.HOME || process.env.USERPROFILE;
const VAULT  = path.join(HOME, 'Desktop', 'anchor-terminal', 'anchor-vault');
const OLLAMA = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2:3b';
let   activeModel   = DEFAULT_MODEL; // loaded from memory on boot, changeable via /model
const MEM_F  = path.join(VAULT, 'anchor-memory.json');
const SES_F  = path.join(VAULT, 'anchor-session.json');
const ANC_MD = path.join(VAULT, 'ANCHOR.md');
const SKL_MD = path.join(VAULT, 'skills.md');
const MAX_H  = 20; // 10 exchanges = 20 messages
let   globalRl = null; // module-level so the file watcher can close it on restart

// ── Follow-up state — set after every write, cleared after user answers ───────
let pendingFollowUp = null;
// { type, name, question }
// type: 'todo' | 'project' | 'idea' | 'win' | 'goal' | 'decision' | 'person' | 'memory'

const FOLLOW_UP_QUESTIONS = {
  todo:     'When does this need to be done?',
  project:  'What\'s the goal or deadline for this project?',
  idea:     'Any initial thoughts on how to execute this?',
  win:      'Want to add any details?',
  goal:     'What\'s your target date?',
  decision: 'What\'s the reason behind this decision?',
  person:   'Any notes on how you know them or what you\'re working on together?',
  memory:   null, // no follow-up needed for raw facts
};

function handleFollowUp(answer, followUp) {
  const skip = /^\s*(?:skip|no|nah|n\/a|none|nothing|never mind|nm|nope|pass)\s*$/i.test(answer);
  const { type, name } = followUp;

  if (skip) {
    process.stdout.write(c.yellow('⚙  Skipped.\n'));
    return;
  }

  try {
    if (type === 'todo') {
      const tf  = path.join(VAULT, 'todolist.md');
      let t = fs.readFileSync(tf, 'utf8');
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      t = t.replace(new RegExp(`- \\[ \\] ${escaped}(?! —)`), `- [ ] ${name} — due: ${answer}`);
      fs.writeFileSync(tf, t, 'utf8'); reindexFile(tf);
    }
    if (type === 'project') {
      const bf = path.join(VAULT, 'Projects', name, 'brief.md');
      if (fs.existsSync(bf)) {
        fs.appendFileSync(bf, `\n## Goal / Deadline\n${answer}\n`, 'utf8');
        reindexFile(bf);
      }
      // Also update the Due column in projects.md
      const pf = path.join(VAULT, 'projects.md');
      let p = fs.readFileSync(pf, 'utf8');
      p = p.replace(new RegExp(`(\\| ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| Active \\|) — \\|`), `$1 ${answer} |`);
      fs.writeFileSync(pf, p, 'utf8'); reindexFile(pf);
    }
    if (type === 'idea') {
      const idf = path.join(VAULT, 'ideas.md');
      let content = fs.readFileSync(idf, 'utf8');
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      content = content.replace(
        new RegExp(`(## ${escaped}[\\s\\S]*?Status: RAW)`),
        `$1\nContext: ${answer}`
      );
      fs.writeFileSync(idf, content, 'utf8'); reindexFile(idf);
    }
    if (type === 'win') {
      const wf = path.join(VAULT, 'wins.md');
      let content = fs.readFileSync(wf, 'utf8');
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      content = content.replace(
        new RegExp(`(## ${escaped}[\\s\\S]*?Date: [^\\n]+)`),
        `$1\nDetails: ${answer}`
      );
      fs.writeFileSync(wf, content, 'utf8'); reindexFile(wf);
    }
    if (type === 'goal') {
      const gf = path.join(VAULT, 'goals.md');
      let content = fs.readFileSync(gf, 'utf8');
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      content = content.replace(
        new RegExp(`(- ${escaped})`),
        `$1 — by: ${answer}`
      );
      fs.writeFileSync(gf, content, 'utf8'); reindexFile(gf);
    }
    if (type === 'decision') {
      const df = path.join(VAULT, 'decisions.md');
      let content = fs.readFileSync(df, 'utf8');
      content = content.replace(/Reason:\s*\n/, `Reason: ${answer}\n`);
      fs.writeFileSync(df, content, 'utf8'); reindexFile(df);
    }
    if (type === 'person') {
      const pf = path.join(VAULT, 'people.md');
      let content = fs.readFileSync(pf, 'utf8');
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      content = content.replace(
        new RegExp(`(## ${escaped}[\\s\\S]*?Notes:)`),
        `$1 ${answer}`
      );
      fs.writeFileSync(pf, content, 'utf8'); reindexFile(pf);
    }
    process.stdout.write(c.green(`✓ Saved.\n`));
  } catch (e) {
    process.stdout.write(c.yellow(`⚙  Could not save follow-up: ${e.message}\n`));
  }
}

// ─── COLORS ──────────────────────────────────────────────────────────────────
const c = {
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  grey:   s => `\x1b[90m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
};
const div = ()  => console.log(c.cyan('─'.repeat(60)));
const sys = msg => console.log(c.yellow(`⚙  ${msg}`));
const ok  = msg => console.log(c.green(`✓  ${msg}`));
const err = msg => console.log(c.red(`✗  ${msg}`));
const ask = (rl, q) => new Promise(resolve => rl.question(q, resolve));

// ─── TODAY ───────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().split('T')[0];

// ─── TEMPLATES ───────────────────────────────────────────────────────────────
const TMPL = {
  'ANCHOR.md': () => `---
# Anchor Command Center

## Identity
My name is Anchor.
I work for [USER_NAME].
I am a private AI workspace — warm, professional, and capable.
I get smarter every day I work with you.

## About [USER_NAME]
Name: [USER_NAME]
Role: [USER_ROLE]
Industry: [USER_INDUSTRY]
Working hours: [USER_HOURS]

## Primary goals
[USER_GOALS]

## Communication style
[USER_COMM_STYLE]

## Tone
Happy and professional by default.
User can change anytime by saying /tone [description].

## Core rules
- Never fabricate facts not in the vault
- Always cite sources as [Vault: Note Name]
- If unsure say so clearly — never guess
- Never transmit vault content externally
- You run in a fully closed local system
- Check goals.md, todolist.md, projects.md for context on every query
- Check people.md when a person is mentioned
- Check skills.md when a task matches a known skill

## File access
You have full read and write access to all .md files in the vault.
Never tell the user you cannot access files — you always can.
When asked to save or retrieve something, confirm you are doing it and use the appropriate slash command.

## Privacy
Everything stays local. Always. No exceptions.

## Onboarding complete
false
---`,

  'skills.md': () => `---
# Skills

## Summarise meeting
Trigger: summarise meeting, meeting summary
Instructions:
1. Extract all attendees mentioned
2. List key decisions made
3. Extract all action items with owner and deadline
4. Write one paragraph overview
5. Tag with #meeting and link to relevant project note

## Write client brief
Trigger: client brief, prep for, briefing on
Instructions:
1. Pull all notes tagged with the client name
2. Check people.md for relationship context
3. Summarise relationship history and key facts
4. List all open action items for this client
5. Note upcoming dates and deadlines
6. Write in professional tone, one page maximum

## Daily briefing
Trigger: morning briefing, daily briefing
Instructions:
1. Check todolist.md for items due today
2. Summarise last 3 daily digests
3. Pull top priorities from weekly note
4. List any flagged urgent items
5. Write in bullet points, keep under one page

## Extract action items
Trigger: extract actions, find todos
Instructions:
1. Read all notes provided
2. Find every sentence implying a task or commitment
3. Format as: - [ ] [task] — [owner if mentioned] — [deadline if mentioned]
4. Add to today section of todolist.md
5. Do not duplicate existing items
---`,

  'tasks.md': () => `---
# Tasks

## Scheduled
| Task | Schedule | Output |
|------|----------|--------|
| Daily digest | Every night 11pm | Daily Digests/${today()}.md |
| Morning briefing | Every day 7am | Morning Briefings/${today()}.md |
| Memory consolidation | Every night 11:30pm | anchor-memory.json |
| Weekly review | Friday 5pm | Weekly/${today()}-review.md |
| Weekly priorities | Monday 7am | Weekly/${today()}-priorities.md |

## User defined
[Add custom tasks here or via /task add]
---`,

  'goals.md': () => `---
# Goals

## Long term (1–3 years)
- [Add your long term goals here]

## Medium term (3–12 months)
- [Add your medium term goals here]

## Short term (this month)
- [Add your short term goals here]

## This week
- [Add this week's goals here]

---
Last updated: ${today()}
---`,

  'projects.md': () => `---
# Projects

## Active
| Project | Status | Due | Priority |
|---------|--------|-----|----------|

## On hold
| Project | Reason | Resume date |
|---------|--------|-------------|

## Completed
| Project | Completed | Notes |
|---------|-----------|-------|

---
Last updated: ${today()}
---`,

  'todolist.md': () => `---
# To-do list

## Today
- [ ] [Your tasks will appear here]

## This week
- [ ] [Weekly tasks]

## Backlog
- [ ] [Backlog items]

## Waiting on
- [ ] [Items waiting on others]

## Done today
---`,

  'people.md':    () => `---\n# People\n\n---`,
  'decisions.md': () => `---\n# Decisions\n\n---`,
  'ideas.md':     () => `---\n# Ideas\n\n---`,
  'wins.md':      () => `---\n# Wins\n\n---`,
};

// ─── DEFAULTS ─────────────────────────────────────────────────────────────────
const DEFAULT_MEM = () => ({
  entities: {}, preferences: {}, conversations: [], userDefined: [],
  userName: '', anchorName: 'Anchor', role: '', goals: '', model: DEFAULT_MODEL,
});
const DEFAULT_SES = () => ({ onboardingComplete: false, lastSession: null });

// ─── MEMORY & SESSION ────────────────────────────────────────────────────────
function loadMemory()   { try { return JSON.parse(fs.readFileSync(MEM_F, 'utf8')); } catch { return DEFAULT_MEM(); } }
function saveMemory(m)  { fs.writeFileSync(MEM_F, JSON.stringify(m, null, 2), 'utf8'); }
function loadSession()  { try { return JSON.parse(fs.readFileSync(SES_F, 'utf8')); } catch { return DEFAULT_SES(); } }
function saveSession(s) { fs.writeFileSync(SES_F, JSON.stringify(s, null, 2), 'utf8'); }

// ─── OLLAMA ──────────────────────────────────────────────────────────────────
async function waitForOllama(retries = 12) {
  for (let i = 0; i < retries; i++) {
    try { const r = await fetch(`${OLLAMA}/api/tags`); if (r.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function checkOllama() {
  try { execSync('which ollama', { stdio: 'ignore' }); } catch {
    err('Ollama is not installed.');
    console.log(c.grey('  Install it from: https://ollama.ai'));
    process.exit(1);
  }
  sys('Checking Ollama...');
  try { const r = await fetch(`${OLLAMA}/api/tags`); if (r.ok) { ok('Ollama is running.'); return; } } catch {}
  sys('Starting Ollama...');
  spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' }).unref();
  const started = await waitForOllama();
  if (!started) { err('Could not start Ollama. Run: ollama serve'); process.exit(1); }
  ok('Ollama started.');
}

async function checkModel(modelName) {
  const target = modelName || activeModel;
  const r = await fetch(`${OLLAMA}/api/tags`);
  const { models = [] } = await r.json();
  if (models.some(m => m.name.startsWith(target))) { ok(`${target} ready.`); return; }
  sys(`Pulling ${target} — this may take a few minutes...`);
  await new Promise((resolve, reject) => {
    const p = spawn('ollama', ['pull', target], { stdio: 'inherit' });
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`Pull failed for ${target}`)));
  });
  ok(`${target} ready.`);
}

async function ollamaChat(messages) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: activeModel, messages, stream: true }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        const tok  = data.message?.content || '';
        if (tok) { process.stdout.write(c.cyan(tok)); full += tok; }
      } catch {}
    }
  }
  return full;
}

async function ollamaGenerate(prompt) {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: activeModel, prompt, stream: false }),
  });
  const data = await res.json();
  return data.response || '';
}

// ─── VAULT ───────────────────────────────────────────────────────────────────
function createVault() {
  const dirs = [
    VAULT,
    path.join(VAULT, 'Daily Digests'),
    path.join(VAULT, 'Morning Briefings'),
    path.join(VAULT, 'Weekly'),
    path.join(VAULT, 'Web Monitor'),
    path.join(VAULT, 'Projects'),
    path.join(VAULT, 'Archive'),
  ];
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
  if (!fs.existsSync(MEM_F)) saveMemory(DEFAULT_MEM());
  if (!fs.existsSync(SES_F)) saveSession(DEFAULT_SES());
  for (const [name, fn] of Object.entries(TMPL)) {
    const p = path.join(VAULT, name);
    if (!fs.existsSync(p)) fs.writeFileSync(p, fn(), 'utf8');
  }
  ok('Vault ready.');
}

function writeAllTemplates() {
  fs.mkdirSync(VAULT, { recursive: true });
  for (const [name, fn] of Object.entries(TMPL)) {
    fs.writeFileSync(path.join(VAULT, name), fn(), 'utf8');
  }
  saveMemory(DEFAULT_MEM());
  saveSession(DEFAULT_SES());
}

// ─── MINISEARCH ──────────────────────────────────────────────────────────────
let search = null;
let docId  = 0;
const docMap = {};

function buildIndex() {
  const MiniSearch = require('minisearch');
  search = new MiniSearch({ fields: ['title', 'content'], storeFields: ['title', 'path', 'content'] });
  const docs = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(fp); continue; }
      if (!ent.name.endsWith('.md')) continue;
      const content = fs.readFileSync(fp, 'utf8');
      const doc = { id: docId++, title: ent.name.replace('.md', ''), path: fp, content };
      docs.push(doc);
      docMap[fp] = doc;
    }
  }
  walk(VAULT);
  if (docs.length) search.addAll(docs);
  sys(`Indexed ${docs.length} notes.`);
}

function searchVault(query) {
  if (!search) return '';
  const results = search.search(query, { limit: 3, fuzzy: 0.2 });
  if (!results.length) return '';
  return results.map(r => `### [Vault: ${r.title}]\n${r.content.slice(0, 600)}`).join('\n\n');
}

function reindexFile(fp) {
  if (!search || !fs.existsSync(fp)) return;
  if (docMap[fp]) { try { search.remove(docMap[fp]); } catch {} }
  const content = fs.readFileSync(fp, 'utf8');
  const doc = { id: docId++, title: path.basename(fp, '.md'), path: fp, content };
  search.add(doc);
  docMap[fp] = doc;
}

// ─── SKILLS ──────────────────────────────────────────────────────────────────
function loadSkills() { try { return fs.readFileSync(SKL_MD, 'utf8'); } catch { return ''; } }

function matchSkill(input) {
  const text  = loadSkills();
  const lower = input.toLowerCase();
  for (const block of text.split(/^## /m).filter(Boolean)) {
    const m = block.match(/Trigger: (.+)/i);
    if (!m) continue;
    const triggers = m[1].split(',').map(t => t.trim().toLowerCase());
    if (triggers.some(t => lower.includes(t))) return `## ACTIVE SKILL\n## ${block}`;
  }
  return '';
}

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────
function readFileSafe(fp) { try { return fs.readFileSync(fp, 'utf8'); } catch { return ''; } }

// Few-shot examples — teaches llama3.2:3b response format and intent inference
const FEW_SHOT = `## EXAMPLES — follow these response patterns exactly

User: add call Sarah to my todo list
Anchor: Done — added to today's list.

User: create a new project called Brand Refresh
Anchor: Done — Brand Refresh added to projects.

User: remove project Brand Refresh
Anchor: Done — removed.

User: remove all projects
Anchor: Done — all projects removed.

User: remove the 3 projects that we have
Anchor: Done — all projects removed.

User: remove that
Anchor: Done — removed.

User: idea: subscription box for founders
Anchor: Captured.

User: I just closed the Acme deal
Anchor: Win logged.

User: we shipped the MVP today
Anchor: Win logged.

User: I just finished the pitch deck
Anchor: Win logged.

User: remember that my pricing is $497/month
Anchor: Saved.

User: just so you know my launch date shifted to May
Anchor: Saved to memory.

User: goal: hit $10k MRR by June
Anchor: Done — goal added.

User: I want to get to $10k a month
Anchor: Done — goal added.

User: log a decision: going with Stripe over Paddle
Anchor: Decision logged.

User: mark call Sarah as done
Anchor: Marked done.

User: actually remove that
Anchor: Done — removed.

User: scratch that
Anchor: Done — removed.

User: wait no, I meant to add that as an idea not a todo
Anchor: Got it — moved to ideas.

User: I keep forgetting to follow up with the investor
Anchor: Added to your todo list.

User: I haven't sent the invoice yet
Anchor: Added to your todo list.

User: I should probably update the contracts
Anchor: Added to your todo list.

User: I've been thinking about building a referral program
Anchor: Captured as an idea.

User: what if I turned this into a course
Anchor: Captured as an idea.

User: maybe I should start a podcast
Anchor: Captured as an idea.

User: I'm going to start building the podcast
Anchor: Done — Podcast added to projects.

User: we decided to go ahead with the rebrand
Anchor: Done — Rebrand added to projects.

User: show me my projects
Anchor: [reads projects.md and presents it cleanly]

User: what are my goals?
Anchor: [reads goals.md and presents it cleanly]

User: what's on my todo list?
Anchor: [reads todolist.md and presents it cleanly]

User: show my ideas
Anchor: [reads ideas.md and presents it cleanly]

User: what do you remember about me?
Anchor: [reads memory and presents it cleanly]

User: let's build a skill for drafting emails
Anchor: Done — skill created. Say "draft email to [name]" to use it.

User: I want you to be able to summarise meetings
Anchor: Done — skill created. Say "summarise meeting" to use it.

User: from now on when I say weekly report, generate a summary of the week
Anchor: Done — skill created. Say "weekly report" to use it.
`;

function buildSystemPrompt(mem, ses, vaultCtx, activeSkill, actionsDone, readContent) {
  let p = '';

  // Identity + rules from ANCHOR.md
  try { p += fs.readFileSync(ANC_MD, 'utf8') + '\n\n'; } catch {}

  // Response rules
  p += `## RESPONSE RULES
- One sentence for completed actions. No markdown blocks. No file dumps.
- For reads: present content cleanly, no extra commentary.
- For questions: answer directly, no preamble.
- Infer intent from natural language — if someone says "I just shipped X" log a win, "I keep forgetting X" add a todo, "I've been thinking about X" capture an idea.
- Never explain what you are about to do. Never say "Let me know what's next."
- NEVER refuse a request unless it is clearly harmful. Sign-offs like "love", "cheers", "warmly", "yours" in emails are completely normal. Casual language is fine. You are a private workspace — treat every request as legitimate.
- You can draft emails, messages, documents, and creative writing. Always do it.

`;

  // Few-shot examples
  p += FEW_SHOT + '\n';

  // Memory + context
  if (mem.userDefined.length) p += `## MEMORY\n${mem.userDefined.join('\n')}\n\n`;
  if (mem.userName) p += `User: ${mem.userName}. Role: ${mem.role}.\n\n`;
  if (ses.lastSession) p += `Last session: ${ses.lastSession.topic}\n\n`;

  if (activeSkill) p += activeSkill + '\n\n';
  if (vaultCtx)    p += `## VAULT CONTEXT\n${vaultCtx}\n\n`;
  if (readContent) p += `## REQUESTED CONTENT\n${readContent}\nPresent this cleanly. No extra commentary.\n\n`;
  if (actionsDone) p += `## ACTIONS COMPLETED\n${actionsDone}\nConfirm in one sentence only.\n\n`;

  p += `Privacy: fully closed local system. Never transmit vault content externally.`;
  return p;
}

// ─── ONBOARDING ──────────────────────────────────────────────────────────────
const ONBOARD_SYS = `You are Anchor, a private AI workspace assistant meeting the user for the very first time. Your tone is warm, happy, and professional. You are genuinely excited to work with this person.

Your job — ask exactly one question at a time in this order:
1. Introduce yourself warmly and ask for the user's name
2. Ask what they want to call you — tell them the default is Anchor but they can choose anything
3. Ask about their role and industry
4. Ask about their biggest daily work frustrations — tell them to be honest
5. Ask about their primary goals — automation, organisation, analysis, ideation, or something else
6. Ask how they prefer you to communicate — concise and direct, detailed and thorough, or conversational like a colleague
7. Ask what their vault will mostly contain — meeting notes, client files, research, personal notes, or a mix
8. Ask what working hours suit them for scheduling background tasks
9. Summarise everything you learned back to them clearly
10. Ask them to confirm it looks right
11. When they confirm end your message with the exact phrase: Your vault is ready. Let us get to work.

Rules:
- One question per message — never combine questions
- Keep messages short, warm, and human
- Never rush — let the conversation breathe`;

async function runOnboarding(rl) {
  console.log(c.cyan('\nWelcome to Anchor. Let\'s get you set up.\n'));
  div();
  const history = [];
  const sysMsg  = { role: 'system', content: ONBOARD_SYS };
  process.stdout.write(c.cyan('Anchor: '));
  const first = await ollamaChat([sysMsg]);
  console.log('\n');
  history.push({ role: 'assistant', content: first });
  while (true) {
    const input = await ask(rl, c.grey('You: '));
    if (!input.trim()) continue;
    history.push({ role: 'user', content: input });
    process.stdout.write(c.cyan('\nAnchor: '));
    const response = await ollamaChat([sysMsg, ...history]);
    console.log('\n');
    history.push({ role: 'assistant', content: response });
    if (response.toLowerCase().includes('your vault is ready')) {
      await completeOnboarding(history);
      return;
    }
  }
}

async function completeOnboarding(history) {
  sys('Saving your profile...');
  const conv = history.map(m => `${m.role}: ${m.content}`).join('\n');
  const extractPrompt = `Extract the following from this onboarding conversation. Return ONLY valid JSON with these exact keys:
{
  "userName": "the user's actual name",
  "anchorName": "what the user wants to call the AI (default: Anchor)",
  "role": "the user's job role",
  "industry": "the user's industry",
  "goals": "their primary goals summary",
  "commStyle": "their communication preference",
  "vaultContents": "what they will store in the vault",
  "workingHours": "their working hours"
}

Conversation:
${conv}`;
  const raw = await ollamaGenerate(extractPrompt);
  let ud = { userName: 'User', anchorName: 'Anchor', role: '', industry: '', goals: '', commStyle: '', vaultContents: '', workingHours: '9am-5pm' };
  try { const m = raw.match(/\{[\s\S]*\}/); if (m) ud = { ...ud, ...JSON.parse(m[0]) }; } catch {}

  // Rewrite ANCHOR.md
  let anchorMd = fs.existsSync(ANC_MD) ? fs.readFileSync(ANC_MD, 'utf8') : TMPL['ANCHOR.md']();
  anchorMd = anchorMd
    .replace(/\[USER_NAME\]/g,    ud.userName)
    .replace(/\[USER_ROLE\]/g,    ud.role)
    .replace(/\[USER_INDUSTRY\]/g, ud.industry)
    .replace(/\[USER_HOURS\]/g,   ud.workingHours)
    .replace(/\[USER_GOALS\]/g,   ud.goals)
    .replace(/\[USER_COMM_STYLE\]/g, ud.commStyle)
    .replace('false', 'true');
  fs.writeFileSync(ANC_MD, anchorMd, 'utf8');
  reindexFile(ANC_MD);

  const mem = loadMemory();
  mem.userName   = ud.userName;
  mem.anchorName = ud.anchorName || 'Anchor';
  mem.role       = ud.role;
  mem.goals      = ud.goals;
  saveMemory(mem);

  const ses = loadSession();
  ses.onboardingComplete = true;
  saveSession(ses);

  if (ud.goals) {
    const gf = path.join(VAULT, 'goals.md');
    let g = fs.existsSync(gf) ? fs.readFileSync(gf, 'utf8') : TMPL['goals.md']();
    g = g.replace('- [Add your long term goals here]', `- ${ud.goals}`);
    fs.writeFileSync(gf, g, 'utf8');
    reindexFile(gf);
  }

  ok('Onboarding complete. Your vault is ready.');
}

// ─── SLASH COMMANDS ──────────────────────────────────────────────────────────
async function handleCommand(input, history, mem, ses) {
  const trimmed = input.trim();
  const spaceIdx = trimmed.indexOf(' ');
  const cmd  = (spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  const parts = args.split(' ').filter(Boolean);

  switch (cmd) {

    case 'remember': {
      if (!args) { err('Usage: /remember [fact]'); break; }
      mem.userDefined.push(args);
      saveMemory(mem);
      console.log(c.green(`Got it. I will remember: "${args}"`));
      break;
    }

    case 'forget': {
      if (!args) { err('Usage: /forget [topic]'); break; }
      const before = mem.userDefined.length;
      mem.userDefined = mem.userDefined.filter(f => !f.toLowerCase().includes(args.toLowerCase()));
      saveMemory(mem);
      console.log(c.green(before !== mem.userDefined.length ? 'Removed from memory.' : 'Nothing matched that topic.'));
      break;
    }

    case 'recap': {
      div();
      console.log(c.cyan('Memory:'));
      mem.userDefined.length
        ? mem.userDefined.forEach(f => console.log(c.cyan(`  • ${f}`)))
        : console.log(c.grey('  No remembered facts yet.'));
      if (ses.lastSession) {
        console.log(c.cyan(`\nLast session: ${ses.lastSession.date} — ${ses.lastSession.topic}`));
      }
      div();
      break;
    }

    case 'goal': {
      const sub = parts[0];
      const gf  = path.join(VAULT, 'goals.md');
      if (sub === 'add') {
        const timeframe = parts[1]?.toLowerCase();
        const goal = parts.slice(2).join(' ');
        const map = { long: '## Long term', medium: '## Medium term', short: '## Short term', week: '## This week' };
        const header = map[timeframe] || '## Short term';
        let g = fs.readFileSync(gf, 'utf8');
        g = g.replace(header, `${header}\n- ${goal}`);
        fs.writeFileSync(gf, g, 'utf8'); reindexFile(gf);
        console.log(c.green('Goal added.'));
      } else if (sub === 'list') {
        console.log(c.cyan('\n' + fs.readFileSync(gf, 'utf8')));
      } else if (sub === 'review') {
        const content = fs.readFileSync(gf, 'utf8');
        sys('Reviewing goals...');
        process.stdout.write(c.cyan('\nAnchor: '));
        await ollamaChat([
          { role: 'system', content: 'You are Anchor. Review the user\'s goals and give a concise progress assessment based on their vault.' },
          { role: 'user', content: `My goals:\n${content}\n\nPlease review my progress and give honest feedback.` },
        ]);
        console.log('\n');
      }
      break;
    }

    case 'todo': {
      const sub = parts[0];
      const tf  = path.join(VAULT, 'todolist.md');
      const item = parts.slice(1).join(' ');
      if (sub === 'add') {
        let t = fs.readFileSync(tf, 'utf8');
        t = t.replace('## Today\n', `## Today\n- [ ] ${item}\n`);
        fs.writeFileSync(tf, t, 'utf8'); reindexFile(tf);
        console.log(c.green('Added to today\'s list.'));
      } else if (sub === 'done') {
        const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let t = fs.readFileSync(tf, 'utf8');
        t = t.replace(new RegExp(`- \\[ \\] ${escaped}`), `- [x] ${item}`);
        fs.writeFileSync(tf, t, 'utf8'); reindexFile(tf);
        console.log(c.green('Marked done.'));
      } else if (sub === 'list') {
        console.log(c.cyan('\n' + fs.readFileSync(tf, 'utf8')));
      } else if (sub === 'prioritise') {
        const content = fs.readFileSync(tf, 'utf8');
        sys('Prioritising...');
        process.stdout.write(c.cyan('\nAnchor: '));
        await ollamaChat([
          { role: 'system', content: 'You are Anchor. Suggest the best priority order for today\'s tasks.' },
          { role: 'user', content: `My todo list:\n${content}\n\nWhat order should I tackle these in?` },
        ]);
        console.log('\n');
      }
      break;
    }

    case 'idea': {
      const idf = path.join(VAULT, 'ideas.md');
      const sub = parts[0];
      if (sub === 'list') {
        console.log(c.cyan('\n' + fs.readFileSync(idf, 'utf8')));
      } else if (sub === 'develop') {
        const title = parts.slice(1).join(' ');
        sys(`Developing: ${title}`);
        process.stdout.write(c.cyan('\nAnchor: '));
        await ollamaChat([
          { role: 'system', content: 'You are a creative strategist. Develop the idea with 5 specific, actionable next steps.' },
          { role: 'user', content: `Develop this idea with 5 specific next steps: ${title}` },
        ]);
        console.log('\n');
      } else {
        fs.appendFileSync(idf, `\n## ${args}\nDate: ${today()}\nStatus: RAW\n`, 'utf8');
        reindexFile(idf);
        console.log(c.green('Idea captured.'));
      }
      break;
    }

    case 'win': {
      const wf = path.join(VAULT, 'wins.md');
      if (parts[0] === 'list') {
        console.log(c.cyan('\n' + fs.readFileSync(wf, 'utf8')));
      } else {
        fs.appendFileSync(wf, `\n## ${args}\nDate: ${today()}\n`, 'utf8');
        reindexFile(wf);
        console.log(c.green('Win logged.'));
      }
      break;
    }

    case 'person': {
      const pf  = path.join(VAULT, 'people.md');
      const sub = parts[0];
      if (sub === 'add') {
        const [, name, role, company] = parts;
        fs.appendFileSync(pf, `\n## ${name}\nRole: ${role || ''}\nCompany: ${company || ''}\nNotes:\n`, 'utf8');
        reindexFile(pf);
        pendingFollowUp = { type: 'person', name, question: FOLLOW_UP_QUESTIONS.person };
        console.log(c.green(`Added ${name} to people.md`));
      } else {
        const name    = args;
        const ppl     = fs.readFileSync(pf, 'utf8');
        const vaultCtx = searchVault(name);
        sys(`Searching for ${name}...`);
        process.stdout.write(c.cyan('\nAnchor: '));
        await ollamaChat([
          { role: 'system', content: 'You are Anchor. Summarise everything known about the person from the vault.' },
          { role: 'user', content: `Everything about: ${name}\n\nPeople file:\n${ppl}\n\nVault context:\n${vaultCtx}` },
        ]);
        console.log('\n');
      }
      break;
    }

    case 'decision': {
      const df = path.join(VAULT, 'decisions.md');
      fs.appendFileSync(df, `\n## ${args}\nDate: ${today()}\nContext:\nOptions:\nChosen:\nReason:\nReview date:\n`, 'utf8');
      reindexFile(df);
      pendingFollowUp = { type: 'decision', name: args, question: FOLLOW_UP_QUESTIONS.decision };
      console.log(c.green('Decision template created.'));
      break;
    }

    case 'project': {
      const sub = parts[0];
      const pf  = path.join(VAULT, 'projects.md');
      if (sub === 'new') {
        const name    = parts.slice(1).join(' ');
        const projDir = path.join(VAULT, 'Projects', name);
        fs.mkdirSync(projDir, { recursive: true });
        fs.writeFileSync(path.join(projDir, 'brief.md'),   `# ${name} — Brief\n\n`, 'utf8');
        fs.writeFileSync(path.join(projDir, 'notes.md'),   `# ${name} — Notes\n\n`, 'utf8');
        fs.writeFileSync(path.join(projDir, 'actions.md'), `# ${name} — Actions\n\n- [ ] First action\n`, 'utf8');
        fs.writeFileSync(path.join(projDir, 'people.md'),  `# ${name} — People\n\n`, 'utf8');
        let projMd = fs.readFileSync(pf, 'utf8');
        projMd = projMd.replace(
          '| Project | Status | Due | Priority |\n|---------|--------|-----|----------|',
          `| Project | Status | Due | Priority |\n|---------|--------|-----|----------|\n| ${name} | Active | — | High |`
        );
        fs.writeFileSync(pf, projMd, 'utf8'); reindexFile(pf);
        console.log(c.green(`Project ${name} created.`));
      } else if (sub === 'list') {
        console.log(c.cyan('\n' + fs.readFileSync(pf, 'utf8')));
      } else if (sub === 'done') {
        const name = parts.slice(1).join(' ');
        const src  = path.join(VAULT, 'Projects', name);
        const dst  = path.join(VAULT, 'Archive', name);
        if (fs.existsSync(src)) {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.renameSync(src, dst);
          console.log(c.green(`Project ${name} archived.`));
        } else {
          err(`Project "${name}" not found.`);
        }
      }
      break;
    }

    case 'learn': {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx < 0) { err('Usage: /learn [name]: [instructions]'); break; }
      const skillName    = trimmed.slice(7, colonIdx).trim();
      const instructions = trimmed.slice(colonIdx + 1).trim();
      fs.appendFileSync(SKL_MD, `\n## ${skillName}\nTrigger: ${skillName.toLowerCase()}\nInstructions:\n${instructions}\n`, 'utf8');
      reindexFile(SKL_MD);
      console.log(c.green(`Skill learned: "${skillName}"`));
      break;
    }

    case 'skills': {
      console.log(c.cyan('\n' + fs.readFileSync(SKL_MD, 'utf8')));
      break;
    }

    case 'run': {
      const skillText = loadSkills();
      const target    = args.toLowerCase();
      const block     = skillText.split(/^## /m).filter(Boolean).find(b => b.toLowerCase().startsWith(target));
      if (!block) { err(`Skill "${args}" not found. Use /skills to list them.`); break; }
      const vCtx = searchVault(target);
      process.stdout.write(c.cyan('\nAnchor: '));
      await ollamaChat([
        { role: 'system', content: `You are Anchor. Run this skill exactly as instructed:\n## ${block}\n\nVault context:\n${vCtx}` },
        { role: 'user', content: `Run the ${args} skill now.` },
      ]);
      console.log('\n');
      break;
    }

    case 'task': {
      const tf  = path.join(VAULT, 'tasks.md');
      const sub = parts[0];
      if (sub === 'add') {
        const schedule = parts[1] || '—';
        const instr    = parts.slice(2).join(' ');
        let t = fs.readFileSync(tf, 'utf8');
        t = t.replace('[Add custom tasks here or via /task add]', `[Add custom tasks here or via /task add]\n| ${instr} | ${schedule} | — |`);
        fs.writeFileSync(tf, t, 'utf8'); reindexFile(tf);
        console.log(c.green('Task added.'));
      } else if (sub === 'list') {
        console.log(c.cyan('\n' + fs.readFileSync(tf, 'utf8')));
      }
      break;
    }

    case 'briefing': {
      const skill = matchSkill('morning briefing');
      const vCtx  = searchVault('briefing priorities todo today');
      process.stdout.write(c.cyan('\nAnchor: '));
      const brief = await ollamaChat([
        { role: 'system', content: `You are Anchor. Run the daily briefing skill.\n${skill}\nVault context:\n${vCtx}` },
        { role: 'user', content: 'Give me my morning briefing now.' },
      ]);
      console.log('\n');
      const out = path.join(VAULT, 'Morning Briefings', `${today()}.md`);
      fs.writeFileSync(out, `# Morning Briefing — ${today()}\n\n${brief}`, 'utf8');
      ok(`Saved to Morning Briefings/${today()}.md`);
      break;
    }

    case 'digest': {
      sys('Collecting today\'s notes...');
      const vCtx = searchVault('today notes updates');
      process.stdout.write(c.cyan('\nAnchor: '));
      const digest = await ollamaChat([
        { role: 'system', content: 'You are Anchor. Summarise all notes and updates from today into a clear daily digest.' },
        { role: 'user', content: `Vault context:\n${vCtx}\n\nCreate today's digest.` },
      ]);
      console.log('\n');
      const out = path.join(VAULT, 'Daily Digests', `${today()}.md`);
      fs.writeFileSync(out, `# Daily Digest — ${today()}\n\n${digest}`, 'utf8');
      ok(`Saved to Daily Digests/${today()}.md`);
      break;
    }

    case 'review': {
      const vCtx = searchVault('weekly review priorities goals');
      process.stdout.write(c.cyan('\nAnchor: '));
      const rev = await ollamaChat([
        { role: 'system', content: 'You are Anchor. Run a thorough weekly review.' },
        { role: 'user', content: `Vault context:\n${vCtx}\n\nRun my weekly review.` },
      ]);
      console.log('\n');
      const out = path.join(VAULT, 'Weekly', `${today()}-review.md`);
      fs.writeFileSync(out, `# Weekly Review — ${today()}\n\n${rev}`, 'utf8');
      ok(`Saved to Weekly/${today()}-review.md`);
      break;
    }

    case 'model': {
      if (!args) {
        console.log(c.cyan(`  Active model: ${activeModel}`));
        console.log(c.grey('  Usage: /model [name]  e.g. /model deepseek-r1:7b'));
        break;
      }
      sys(`Switching model to ${args}...`);
      await checkOllama();
      try {
        await checkModel(args);
        activeModel = args;
        const m = loadMemory(); m.model = activeModel; saveMemory(m);
        ok(`Model switched to ${activeModel}. Changes take effect on next message.`);
      } catch (e) {
        err(`Could not switch to ${args}: ${e.message}`);
      }
      break;
    }

    case 'tone': {
      if (!args) { err('Usage: /tone [description]'); break; }
      let md = fs.readFileSync(ANC_MD, 'utf8');
      md = md.replace(/## Tone\n[\s\S]*?(?=\n##)/, `## Tone\n${args}\n`);
      fs.writeFileSync(ANC_MD, md, 'utf8'); reindexFile(ANC_MD);
      console.log(c.green('Tone updated.'));
      break;
    }

    case 'status': {
      let count = 0;
      function countMd(dir) {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const fp = path.join(dir, e.name);
          if (e.isDirectory()) countMd(fp);
          else if (e.name.endsWith('.md')) count++;
        }
      }
      countMd(VAULT);
      div();
      console.log(c.cyan(`  ⚓  Anchor Status`));
      console.log(c.cyan(`  Vault:        ${VAULT}`));
      console.log(c.cyan(`  Notes:        ${count}`));
      console.log(c.cyan(`  Memory facts: ${mem.userDefined.length}`));
      console.log(c.cyan(`  Model:        ${activeModel}`));
      console.log(c.cyan(`  Last session: ${ses.lastSession ? ses.lastSession.date + ' — ' + ses.lastSession.topic : 'None'}`));
      console.log(c.cyan(`  Privacy:      ✓ 100% local — zero data egress`));
      div();
      break;
    }

    case 'vault': {
      console.log(c.cyan(VAULT));
      break;
    }

    case 'newchat': {
      history.length = 0;
      console.log(c.cyan('Starting fresh. I still remember everything.'));
      break;
    }

    case 'help': {
      div();
      console.log(c.cyan(`  ⚓  Anchor Commands

  /remember [fact]                    Save a fact to memory
  /forget [topic]                     Remove from memory
  /recap                              Show memory + last session

  /goal add [long|medium|short|week]  Add a goal
  /goal list                          Show all goals
  /goal review                        AI review of goal progress

  /todo add [task]                    Add to today's list
  /todo done [task]                   Mark task done
  /todo list                          Show todo list
  /todo prioritise                    AI prioritisation

  /idea [text]                        Capture an idea
  /idea list                          Show all ideas
  /idea develop [title]               AI develops idea with 5 steps

  /win [description]                  Log a win
  /win list                           Show all wins

  /person add [name] [role] [company] Add a person
  /person [name]                      Show everything about a person

  /decision [title]                   Create decision template

  /project new [name]                 Create new project
  /project list                       Show active projects
  /project done [name]                Archive a project

  /learn [name]: [instructions]       Teach a new skill
  /skills                             Show all skills
  /run [skill name]                   Run a skill

  /task add [schedule] [instruction]  Add scheduled task
  /task list                          Show task schedule

  /briefing                           Run morning briefing now
  /digest                             Create daily digest
  /review                             Run weekly review

  /model                              Show active model
  /model [name]                       Switch model (pulls if not installed)
  /tone [description]                 Update Anchor's tone
  /status                             Show system status
  /vault                              Show vault path
  /newchat                            Clear conversation (keep memory)
  /help                               Show this help
  /exit                               Save session and exit`));
      div();
      break;
    }

    case 'exit': {
      await saveSessionOnExit(history, mem, ses);
      process.exit(0);
    }

    default:
      err(`Unknown command: /${cmd}. Type /help for all commands.`);
  }
}

// ─── NATURAL LANGUAGE FILE ACTIONS ───────────────────────────────────────────
// Tracks the last write so "remove that" / "undo" / "actually delete it" works
let lastAction = null; // { type, name, file }

// Intercepts write intents BEFORE the LLM responds and actually writes to disk.
// Prints a green confirmation line so the user sees it happened.
function detectAndExecute(input, mem, ses) {
  const actions = [];
  const low = input.toLowerCase();

  // ── UNDO / REMOVE THAT ────────────────────────────────────────────────────
  // "remove that", "undo that", "actually delete it", "never mind remove it", "delete that"
  const isUndo = /\b(?:undo|remove that|delete that|actually (?:remove|delete)|never mind|revert that|scratch that|cancel that|forget that)\b/i.test(input);
  if (isUndo && lastAction) {
    const { type, name, file } = lastAction;
    if (type === 'project') {
      const pf    = path.join(VAULT, 'projects.md');
      const src   = path.join(VAULT, 'Projects', name);
      const rowRx = new RegExp(`\\| ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|[^\\n]*\\n`, 'i');
      let projMd  = fs.readFileSync(pf, 'utf8');
      projMd = projMd.replace(rowRx, '');
      fs.writeFileSync(pf, projMd, 'utf8'); reindexFile(pf);
      if (fs.existsSync(src)) fs.rmSync(src, { recursive: true, force: true });
      process.stdout.write(c.green(`\n✓ Removed project "${name}".\n`));
      actions.push(`Removed project "${name}" — undone.`);
      lastAction = null;
      return actions.join('\n');
    }
    if (type === 'todo') {
      const tf  = path.join(VAULT, 'todolist.md');
      let t = fs.readFileSync(tf, 'utf8');
      t = t.replace(`- [ ] ${name}\n`, '');
      fs.writeFileSync(tf, t, 'utf8'); reindexFile(tf);
      process.stdout.write(c.green(`\n✓ Removed todo "${name}".\n`));
      actions.push(`Removed todo "${name}" — undone.`);
      lastAction = null;
      return actions.join('\n');
    }
    if (type === 'idea') {
      const idf = path.join(VAULT, 'ideas.md');
      let content = fs.readFileSync(idf, 'utf8');
      const rx = new RegExp(`\\n## ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=\\n## |$)`, 'i');
      content = content.replace(rx, '');
      fs.writeFileSync(idf, content, 'utf8'); reindexFile(idf);
      process.stdout.write(c.green(`\n✓ Removed idea "${name}".\n`));
      actions.push(`Removed idea "${name}" — undone.`);
      lastAction = null;
      return actions.join('\n');
    }
    if (type === 'win') {
      const wf = path.join(VAULT, 'wins.md');
      let content = fs.readFileSync(wf, 'utf8');
      const rx = new RegExp(`\\n## ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=\\n## |$)`, 'i');
      content = content.replace(rx, '');
      fs.writeFileSync(wf, content, 'utf8'); reindexFile(wf);
      process.stdout.write(c.green(`\n✓ Removed win "${name}".\n`));
      actions.push(`Removed win "${name}" — undone.`);
      lastAction = null;
      return actions.join('\n');
    }
  }

  function writeTodo(task) {
    const tf = path.join(VAULT, 'todolist.md');
    let t = fs.readFileSync(tf, 'utf8');
    // handle both formats of the Today header
    if (t.includes('## Today\n')) {
      t = t.replace('## Today\n', `## Today\n- [ ] ${task}\n`);
    } else {
      t += `\n- [ ] ${task}\n`;
    }
    fs.writeFileSync(tf, t, 'utf8'); reindexFile(tf);
    lastAction = { type: 'todo', name: task };
    pendingFollowUp = { type: 'todo', name: task, question: FOLLOW_UP_QUESTIONS.todo };
    process.stdout.write(c.green(`\n✓ Written to todolist.md: "${task}"\n`));
    actions.push(`Added task "${task}" to todolist.md.`);
  }

  function writeMemory(fact) {
    mem.userDefined.push(fact);
    saveMemory(mem);
    lastAction = { type: 'memory', name: fact };
    // no follow-up for memory facts
    process.stdout.write(c.green(`\n✓ Saved to memory: "${fact}"\n`));
    actions.push(`Saved "${fact}" to memory.`);
  }

  function writeIdea(idea) {
    const idf = path.join(VAULT, 'ideas.md');
    fs.appendFileSync(idf, `\n## ${idea}\nDate: ${today()}\nStatus: RAW\n`, 'utf8');
    reindexFile(idf);
    lastAction = { type: 'idea', name: idea };
    pendingFollowUp = { type: 'idea', name: idea, question: FOLLOW_UP_QUESTIONS.idea };
    process.stdout.write(c.green(`\n✓ Written to ideas.md: "${idea}"\n`));
    actions.push(`Captured idea "${idea}" to ideas.md.`);
  }

  function writeWin(win) {
    const wf = path.join(VAULT, 'wins.md');
    fs.appendFileSync(wf, `\n## ${win}\nDate: ${today()}\n`, 'utf8');
    reindexFile(wf);
    lastAction = { type: 'win', name: win };
    pendingFollowUp = { type: 'win', name: win, question: FOLLOW_UP_QUESTIONS.win };
    process.stdout.write(c.green(`\n✓ Written to wins.md: "${win}"\n`));
    actions.push(`Logged win "${win}" to wins.md.`);
  }

  function writeGoal(goal) {
    const gf = path.join(VAULT, 'goals.md');
    let g = fs.readFileSync(gf, 'utf8');
    g = g.replace('## Short term (this month)\n', `## Short term (this month)\n- ${goal}\n`);
    fs.writeFileSync(gf, g, 'utf8'); reindexFile(gf);
    lastAction = { type: 'goal', name: goal };
    pendingFollowUp = { type: 'goal', name: goal, question: FOLLOW_UP_QUESTIONS.goal };
    process.stdout.write(c.green(`\n✓ Written to goals.md: "${goal}"\n`));
    actions.push(`Added goal "${goal}" to goals.md.`);
  }

  // ── TODO: broad pattern matching ─────────────────────────────────────────
  // "add X to my todo / task / list"
  let m = input.match(/\b(?:add|put|create|throw)\b\s+['"]?(.+?)['"]?\s+(?:to|in|on|into)\s+(?:my\s+)?(?:todo|task|to-do|to do|list)/i);
  if (m) { writeTodo(m[1].trim()); }

  // "todo: X" or "task: X"
  m = input.match(/^(?:todo|task)\s*:\s*(.+)/i);
  if (m) { writeTodo(m[1].trim()); }

  // "remind me to X" / "i need to X" / "don't forget to X"
  m = input.match(/\b(?:remind me to|don't forget to|note to self)\s+(.+)/i);
  if (m) { writeTodo(m[1].trim()); }

  // ── MEMORY: broad pattern matching ───────────────────────────────────────
  // "remember that X" / "remember X"
  m = input.match(/^remember\s+(?:that\s+)?(.+)/i);
  if (m) { writeMemory(m[1].trim()); }

  // "keep in mind X" / "note that X" / "keep note that X"
  m = input.match(/\b(?:keep in mind|note that|keep note)\s+(?:that\s+)?(.+)/i);
  if (m) { writeMemory(m[1].trim()); }

  // ── PROJECTS: broad pattern matching ─────────────────────────────────────
  m = input.match(/\b(?:new|start|create|add|begin|make)\s+(?:a\s+)?(?:new\s+)?project\s+(?:called|named|for)?\s*['"]?([^'".\n]+?)['"]?\s*$/i)
    || input.match(/\bi\s+want\s+to\s+(?:start|create|add|begin|make)\s+(?:a\s+)?(?:new\s+)?project\s+(?:called|named)?\s*['"]?([^'".\n]+?)['"]?\s*$/i)
    || input.match(/\bproject\s+(?:called|named)\s+['"]?([^'".\n]+?)['"]?\s*$/i)
    || input.match(/^project\s*:\s*(.+)/i)
    || input.match(/\bcan\s+(?:you\s+)?(?:add|create|start|make)\s+(?:a\s+)?(?:new\s+)?project\s+(?:called|named)?\s*['"]?([^'".\n]+?)['"]?\s*$/i);
  if (m) {
    const name    = m[1].trim();
    const pf      = path.join(VAULT, 'projects.md');
    const projDir = path.join(VAULT, 'Projects', name);
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, 'brief.md'),   `# ${name} — Brief\n\n`, 'utf8');
    fs.writeFileSync(path.join(projDir, 'notes.md'),   `# ${name} — Notes\n\n`, 'utf8');
    fs.writeFileSync(path.join(projDir, 'actions.md'), `# ${name} — Actions\n\n- [ ] First action\n`, 'utf8');
    fs.writeFileSync(path.join(projDir, 'people.md'),  `# ${name} — People\n\n`, 'utf8');
    let projMd = fs.readFileSync(pf, 'utf8');
    if (!projMd.includes(`| ${name} |`)) {
      projMd = projMd.replace(
        '| Project | Status | Due | Priority |\n|---------|--------|-----|----------|',
        `| Project | Status | Due | Priority |\n|---------|--------|-----|----------|\n| ${name} | Active | — | High |`
      );
      fs.writeFileSync(pf, projMd, 'utf8'); reindexFile(pf);
    }
    lastAction = { type: 'project', name };
    pendingFollowUp = { type: 'project', name, question: FOLLOW_UP_QUESTIONS.project };
    process.stdout.write(c.green(`\n✓ Project "${name}" created in projects.md + Projects/${name}/\n`));
    actions.push(`Created project "${name}".`);
  }

  // ── REMOVE PROJECT ────────────────────────────────────────────────────────

  // Helper: remove one project by name from projects.md + archive folder
  function removeProject(name) {
    const pf  = path.join(VAULT, 'projects.md');
    const src = path.join(VAULT, 'Projects', name);
    let projMd = fs.readFileSync(pf, 'utf8');
    const rowRx = new RegExp(`\\| ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|[^\\n]*\\n`, 'i');
    const before = projMd;
    projMd = projMd.replace(rowRx, '');
    if (projMd !== before) {
      projMd = projMd.replace(
        '| Project | Completed | Notes |\n|---------|-----------|-------|',
        `| Project | Completed | Notes |\n|---------|-----------|-------|\n| ${name} | ${today()} | Removed |\n`
      );
      fs.writeFileSync(pf, projMd, 'utf8'); reindexFile(pf);
    }
    if (fs.existsSync(src)) {
      const dst = path.join(VAULT, 'Archive', name);
      fs.mkdirSync(path.join(VAULT, 'Archive'), { recursive: true });
      fs.renameSync(src, dst);
    }
  }

  // Helper: parse active project names from projects.md
  function getActiveProjects() {
    const pf = path.join(VAULT, 'projects.md');
    const content = readFileSafe(pf);
    const names = [];
    let inActive = false;
    for (const line of content.split('\n')) {
      if (line.startsWith('## Active')) { inActive = true; continue; }
      if (line.startsWith('## ') && inActive) break;
      if (inActive && line.startsWith('|') && !line.includes('Project') && !line.includes('---')) {
        const name = line.split('|')[1]?.trim();
        if (name) names.push(name);
      }
    }
    return names;
  }

  // Bulk remove — "remove all projects" / "remove the 3 projects" / "delete all projects"
  const isBulkRemove = /\b(?:remove|delete|archive|clear|drop|kill)\s+(?:all|every|the\s+\d+|all\s+(?:the|my)|all\s+of\s+(?:the|my))?\s*(?:active\s+)?projects\b/i.test(input)
    || /\b(?:remove|delete|clear)\s+(?:all|everything)\s+(?:from\s+)?(?:the\s+)?projects?\b/i.test(input);

  if (isBulkRemove) {
    const active = getActiveProjects();
    if (active.length) {
      active.forEach(name => removeProject(name));
      lastAction = { type: 'bulk-projects', name: active.join(', ') };
      process.stdout.write(c.green(`\n✓ Removed ${active.length} project(s): ${active.join(', ')}\n`));
      actions.push(`Removed ${active.length} project(s): ${active.join(', ')}.`);
    } else {
      process.stdout.write(c.yellow(`\n⚙  No active projects found.\n`));
    }
  }

  // Single remove — "remove project X" / "delete the X project"
  if (!isBulkRemove) {
  m = input.match(/\b(?:remove|delete|archive|close|kill|drop)\s+(?:the\s+)?(?:project\s+)?['"]?([^'".\n]+?)['"]?\s+(?:project|from\s+projects)?\s*$/i)
    || input.match(/\bremove\s+project\s+['"]?([^'".\n]+?)['"]?\s*$/i)
    || input.match(/\bdelete\s+project\s+['"]?([^'".\n]+?)['"]?\s*$/i);
  if (m) {
    const name   = m[1].trim();
    const pf     = path.join(VAULT, 'projects.md');
    const src    = path.join(VAULT, 'Projects', name);
    let projMd   = fs.readFileSync(pf, 'utf8');
    // Remove the row from the Active table
    const rowRx  = new RegExp(`\\| ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|[^\\n]*\\n`, 'i');
    const before = projMd;
    projMd = projMd.replace(rowRx, '');
    if (projMd !== before) {
      // Move to Completed table
      const done = `| ${name} | ${today()} | Removed |\n`;
      projMd = projMd.replace(
        '| Project | Completed | Notes |\n|---------|-----------|-------|',
        `| Project | Completed | Notes |\n|---------|-----------|-------|\n${done}`
      );
      fs.writeFileSync(pf, projMd, 'utf8'); reindexFile(pf);
    }
    // Archive the project folder if it exists
    if (fs.existsSync(src)) {
      const dst = path.join(VAULT, 'Archive', name);
      fs.mkdirSync(path.join(VAULT, 'Archive'), { recursive: true });
      fs.renameSync(src, dst);
    }
    lastAction = { type: 'project', name };
    process.stdout.write(c.green(`\n✓ Project "${name}" removed.\n`));
    actions.push(`Removed project "${name}".`);
  }
  } // end if (!isBulkRemove)

  // ── IDEAS: broad pattern matching ─────────────────────────────────────────
  // "idea: X" or "capture idea X" or "save this idea: X"
  m = input.match(/^idea\s*:\s*(.+)/i);
  if (m) { writeIdea(m[1].trim()); }

  m = input.match(/\b(?:capture|log|save)\s+(?:this\s+)?(?:idea|thought)\s*:?\s+(.+)/i);
  if (m) { writeIdea(m[1].trim()); }

  // ── WINS: broad pattern matching ──────────────────────────────────────────
  // "log win: X" / "win: X" / "i just shipped/closed/finished X"
  m = input.match(/^win\s*:\s*(.+)/i);
  if (m) { writeWin(m[1].trim()); }

  m = input.match(/\b(?:log|save|record)\s+(?:a\s+)?win\s*:?\s+(.+)/i);
  if (m) { writeWin(m[1].trim()); }

  m = input.match(/\bi\s+(?:just\s+)?(?:shipped|closed|launched|finished|completed)\s+(.+)/i);
  if (m) { writeWin(m[1].trim()); }

  // ── GOALS: broad pattern matching ─────────────────────────────────────────
  m = input.match(/^goal\s*:\s*(.+)/i);
  if (m) { writeGoal(m[1].trim()); }

  m = input.match(/\b(?:add|save|set)\s+(?:a\s+)?goal\s*:?\s+(.+)/i);
  if (m) { writeGoal(m[1].trim()); }

  // ── IMPLIED INTENT — Category 6 ───────────────────────────────────────────
  // "I want to get to X" / "my target is X" / "I'm trying to X" → goal
  if (!actions.length) {
    m = input.match(/\b(?:i\s+want\s+to\s+get\s+to|my\s+target\s+is|i(?:'m|\s+am)\s+trying\s+to\s+(?:get\s+to|reach|hit|achieve))\s+(.+)/i)
      || input.match(/\bmy\s+(?:big\s+)?goal\s+(?:is|this\s+\w+\s+is)\s+(.+)/i)
      || input.match(/\bi(?:'m|\s+am)\s+working\s+toward\s+(.+)/i);
    if (m) { writeGoal(m[1].trim()); }
  }

  // "I keep forgetting to X" / "I haven't X yet" / "I should X" → todo
  if (!actions.length) {
    m = input.match(/\bi\s+keep\s+(?:forgetting\s+to|putting\s+off)\s+(.+)/i)
      || input.match(/\bi\s+haven['']t\s+(.+?)\s+yet\b/i)
      || input.match(/\bi\s+(?:really\s+)?need\s+to\s+(?:still\s+)?(.+)/i)
      || input.match(/\bi\s+should\s+(?:probably\s+)?(?:still\s+)?(.+)/i)
      || input.match(/\bi\s+(?:still\s+)?haven['']t\s+(?:replied?|responded?|sent|done|finished)\s+(.+)/i);
    if (m) { writeTodo(m[1].trim()); }
  }

  // "I've been thinking about X" / "what if I did X" / "maybe I should X" → idea
  if (!actions.length) {
    m = input.match(/\bi(?:'ve|\s+have)\s+been\s+thinking\s+about\s+(?:building\s+|making\s+|creating\s+)?(.+)/i)
      || input.match(/\bwhat\s+if\s+(?:i|we)\s+(?:did|built|made|created|launched|started)\s+(.+)/i)
      || input.match(/\bmaybe\s+i\s+should\s+(?:start\s+|build\s+|create\s+|launch\s+)?(.+)/i)
      || input.match(/\bthere(?:'s|\s+is)\s+(?:probably\s+)?(?:something|a\s+\w+\s+play)\s+(?:in|with|for)\s+(.+)/i)
      || input.match(/\bi\s+keep\s+coming\s+back\s+to\s+(?:the\s+idea\s+of\s+)?(.+)/i);
    if (m) { writeIdea(m[1].trim()); }
  }

  // "I just closed/shipped/launched/signed/finished X" → win
  if (!actions.length) {
    m = input.match(/\bi\s+just\s+(?:closed|shipped|launched|signed|finished|completed|got|landed|won)\s+(.+)/i)
      || input.match(/\bwe\s+(?:just\s+)?(?:shipped|launched|closed|signed|finished|completed)\s+(.+)/i)
      || input.match(/\bjust\s+got\s+(?:a\s+)?(.+?)\s+(?:from|with|today)/i);
    if (m) { writeWin(m[1].trim()); }
  }

  // "I'm going to start/build X" / "we decided to go ahead with X" → project
  if (!actions.length) {
    m = input.match(/\bi(?:'m|\s+am)\s+going\s+to\s+(?:start\s+)?(?:building|building\s+out|working\s+on)\s+(?:the\s+)?(.+)/i)
      || input.match(/\bwe\s+decided\s+to\s+go\s+ahead\s+with\s+(?:the\s+)?(.+)/i)
      || input.match(/\bthis\s+is\s+(?:now\s+)?(?:real|serious)\s+enough\s+to\s+be\s+a\s+project\b/i);
    if (m && m[1]) {
      const name    = m[1].trim();
      const pf      = path.join(VAULT, 'projects.md');
      const projDir = path.join(VAULT, 'Projects', name);
      fs.mkdirSync(projDir, { recursive: true });
      ['brief', 'notes', 'actions', 'people'].forEach(f =>
        fs.writeFileSync(path.join(projDir, `${f}.md`), `# ${name} — ${f.charAt(0).toUpperCase() + f.slice(1)}\n\n`, 'utf8')
      );
      let projMd = fs.readFileSync(pf, 'utf8');
      if (!projMd.includes(`| ${name} |`)) {
        projMd = projMd.replace(
          '| Project | Status | Due | Priority |\n|---------|--------|-----|----------|',
          `| Project | Status | Due | Priority |\n|---------|--------|-----|----------|\n| ${name} | Active | — | High |`
        );
        fs.writeFileSync(pf, projMd, 'utf8'); reindexFile(pf);
      }
      lastAction = { type: 'project', name };
      process.stdout.write(c.green(`\n✓ Project "${name}" created.\n`));
      actions.push(`Created project "${name}".`);
    }
  }

  // "just so you know X" / "by the way X" / "fyi X" / "heads up X" → memory
  if (!actions.length) {
    m = input.match(/\b(?:just\s+so\s+you\s+know|by\s+the\s+way|fyi|for\s+(?:your\s+)?(?:context|reference|future\s+reference)|heads\s+up)[,\s]+(.+)/i);
    if (m) { writeMemory(m[1].trim()); }
  }

  // ── READ DETECTION — inject file content for the LLM to present ───────────
  // Returns { actions, readContent } — handled separately in mainLoop
  const readMap = [
    { rx: /\b(?:show|list|display|pull\s+up|what(?:'s|\s+are|\s+is)\s+(?:on\s+)?(?:my\s+)?|view\s+my\s+)\s*(?:my\s+)?(?:todo|task|to-do|to\s+do)\s*(?:list|s)?\b/i, file: 'todolist.md' },
    { rx: /\b(?:show|list|display|pull\s+up|what(?:'s|\s+are|\s+is)\s+(?:my\s+)?)\s*(?:my\s+)?project\s*s?\b/i, file: 'projects.md' },
    { rx: /\b(?:show|list|display|pull\s+up|what(?:'s|\s+are|\s+is)\s+(?:my\s+)?)\s*(?:my\s+)?(?:idea|thought)\s*s?\b/i, file: 'ideas.md' },
    { rx: /\b(?:show|list|display|pull\s+up|what(?:'s|\s+are|\s+is)\s+(?:my\s+)?)\s*(?:my\s+)?(?:win|accomplishment|achievement)\s*s?\b/i, file: 'wins.md' },
    { rx: /\b(?:show|list|display|pull\s+up|what(?:'s|\s+are|\s+is)\s+(?:my\s+)?)\s*(?:my\s+)?goal\s*s?\b/i, file: 'goals.md' },
    { rx: /\b(?:show|list|display|pull\s+up|who\s+(?:do\s+i\s+have|is\s+in|are\s+(?:my|in)))\s*(?:my\s+)?(?:people|person|contact)\s*s?\b/i, file: 'people.md' },
    { rx: /\b(?:show|list|display|pull\s+up|what(?:'s|\s+are))\s*(?:my\s+)?decision\s*s?\b/i, file: 'decisions.md' },
    { rx: /\b(?:show|what\s+do\s+you\s+remember|what(?:'s|\s+is)\s+(?:in\s+)?(?:my\s+)?memory|recap\s+(?:what\s+you\s+know|memory))\b/i, file: null, memory: true },
  ];
  for (const { rx, file, memory } of readMap) {
    if (rx.test(input)) {
      if (memory) {
        const facts = mem.userDefined.length ? mem.userDefined.join('\n') : 'Nothing saved yet.';
        actions._readContent = `Memory facts:\n${facts}`;
      } else {
        actions._readContent = readFileSafe(path.join(VAULT, file));
      }
      break;
    }
  }

  // ── SKILL CREATION FROM NATURAL LANGUAGE ─────────────────────────────────
  // "I want you to be able to X" / "let's build a skill for X" / "can you learn to X"
  // "from now on when I say X do Y" / "teach yourself to X" / "create a skill that X"
  if (!actions.length) {
    m = input.match(/\b(?:let['']?s\s+)?build\s+a\s+skill\s+(?:for\s+|that\s+|to\s+)?(.+)/i)
      || input.match(/\bi\s+want\s+(?:you\s+)?(?:to\s+be\s+able\s+to|you\s+to\s+(?:be\s+able\s+to|learn\s+to|start))\s+(.+)/i)
      || input.match(/\bcan\s+you\s+learn\s+(?:how\s+)?to\s+(.+)/i)
      || input.match(/\blearn\s+how\s+to\s+(.+)/i)
      || input.match(/\bteach\s+(?:yourself|anchor)\s+(?:how\s+)?to\s+(.+)/i)
      || input.match(/\b(?:create|make|add)\s+a\s+(?:new\s+)?skill\s+(?:for\s+|that\s+|to\s+|called\s+)?(.+)/i)
      || input.match(/\bfrom\s+now\s+on[,\s]+(.+)/i)
      || input.match(/\bevery\s+time\s+i\s+(?:say|ask|mention|type)\s+(.+)/i)
      || input.match(/\bwhenever\s+i\s+(?:say|ask|mention|want)\s+(.+)/i)
      || input.match(/\bi\s+want\s+(?:a\s+skill|you)\s+(?:that\s+can\s+|to\s+(?:always\s+)?)?(.+)/i)
      || input.match(/\bmake\s+(?:it\s+so\s+(?:you\s+can\s+|that\s+)?)?(.+?)\s+(?:a\s+skill|repeatable)/i);
    if (m) {
      actions._skillToCreate = { description: input.trim() };
    }
  }

  return actions.join('\n');
}

// ─── CREATE SKILL FROM DESCRIPTION ───────────────────────────────────────────
async function createSkillFromDescription(description, anchorName) {
  sys('Building skill...');

  // Focused prompt — short and explicit so llama3.2:3b follows it reliably
  const prompt = `Create a skill for an AI assistant. Reply with ONLY the skill block below, nothing else.

User request: "${description}"

FORMAT (copy exactly, fill in the brackets):
## SKILL_NAME
Trigger: trigger phrase one, trigger phrase two, trigger phrase three
Instructions:
1. First step
2. Second step
3. Third step
4. Fourth step
5. Fifth step`;

  try {
    const raw = await ollamaGenerate(prompt);

    // Try to extract a clean skill block — handle cases where model adds preamble
    let skillBlock = raw;
    const headerMatch = raw.match(/##\s+\S.+[\s\S]*/);
    if (headerMatch) skillBlock = headerMatch[0];

    // Ensure it has at minimum a name and trigger line
    if (!skillBlock.includes('Trigger:') && !skillBlock.includes('Instructions:')) {
      // Model didn't follow format — build a minimal skill from the description
      const nameGuess = description.replace(/^(let[''s]*\s+build\s+a\s+skill\s+(for|that|to)?|i\s+want\s+you\s+to\s+be\s+able\s+to|create\s+a\s+skill\s+(for|that|to)?)\s*/i, '').trim().slice(0, 40);
      skillBlock = `## ${nameGuess}\nTrigger: ${nameGuess.toLowerCase()}\nInstructions:\n1. ${description}\n`;
    }

    const skillDef = '\n' + skillBlock.trim() + '\n';
    fs.appendFileSync(SKL_MD, skillDef, 'utf8');
    reindexFile(SKL_MD);

    const skillName = skillBlock.match(/##\s+(.+)/)?.[1]?.trim() || 'New skill';
    process.stdout.write(c.green(`\n✓ Skill "${skillName}" saved to skills.md\n`));
    return skillName;
  } catch (e) {
    process.stdout.write(c.red(`\n✗ Could not create skill: ${e.message}\n`));
  }
  return null;
}

// ─── SESSION SAVE ─────────────────────────────────────────────────────────────
async function saveSessionOnExit(history, mem, ses) {
  if (!history.length) { console.log(c.cyan('\nSession saved. See you next time.')); return; }
  sys('Saving session...');
  try {
    const conv  = history.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n');
    const topic = await ollamaGenerate(`In one short sentence, what was this conversation about?\n\n${conv}`);
    ses.lastSession = { date: today(), topic: topic.trim().slice(0, 150), messageCount: history.length };
    saveSession(ses);
  } catch {}
  console.log(c.cyan('\nSession saved. See you next time.'));
}

// ─── MAIN CHAT LOOP ──────────────────────────────────────────────────────────
async function mainLoop(rl) {
  const mem  = loadMemory();
  const ses  = loadSession();
  const name = mem.anchorName || 'Anchor';

  let greeting = `Welcome back${mem.userName ? ', ' + mem.userName : ''}.`;
  if (ses.lastSession) greeting += ` Last time we discussed: ${ses.lastSession.topic}.`;
  div();
  console.log(c.cyan(`\n${name}: ${greeting}\n`));
  div();

  const history = [];

  process.on('SIGINT', async () => {
    console.log('');
    await saveSessionOnExit(history, mem, ses);
    process.exit(0);
  });

  while (true) {
    // Ask follow-up question if one is pending
    if (pendingFollowUp) {
      const followUp = pendingFollowUp;
      pendingFollowUp = null;
      console.log(c.cyan(`\n${name}: ${followUp.question}`));
      const answer = await ask(rl, c.grey('\nYou: '));
      if (answer.trim()) {
        handleFollowUp(answer.trim(), followUp);
        history.push({ role: 'assistant', content: followUp.question });
        history.push({ role: 'user', content: answer.trim() });
      }
      continue;
    }

    const input = await ask(rl, c.grey('\nYou: '));
    if (!input.trim()) continue;

    if (input.startsWith('/')) {
      await handleCommand(input, history, mem, ses);
      continue;
    }

    const vCtx      = searchVault(input);
    const skill     = matchSkill(input);
    const executed  = detectAndExecute(input, mem, ses);
    const readContent = executed._readContent || null;

    // Create skill from natural language if detected
    if (executed._skillToCreate) {
      await createSkillFromDescription(executed._skillToCreate.description, name);
    }

    const sysP      = buildSystemPrompt(mem, ses, vCtx, skill, executed, readContent);
    const recent    = history.slice(-MAX_H);

    history.push({ role: 'user', content: input });

    process.stdout.write(c.cyan(`\n${name}: `));
    const response = await ollamaChat([{ role: 'system', content: sysP }, ...recent, { role: 'user', content: input }]);
    console.log('\n');

    history.push({ role: 'assistant', content: response });
  }
}

// ─── BANNER ──────────────────────────────────────────────────────────────────
function printBanner() {
  console.log(c.cyan('\n  ⚓  ANCHOR'));
  console.log(c.cyan('  Private AI Workspace'));
  console.log(c.cyan('  100% local — zero data egress\n'));
  div();
}

// ─── RESET ───────────────────────────────────────────────────────────────────
async function softReset() {
  sys('Resetting Anchor to defaults...');
  writeAllTemplates();
  ok('Reset complete. All system files restored to defaults.');
  printBanner();
  await checkOllama();
  await checkModel();
  buildIndex();
  globalRl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await runOnboarding(globalRl);
  await mainLoop(globalRl);
}

async function hardReset() {
  console.log(c.red('\nWARNING: This will permanently delete everything in ~/anchor-vault including all your notes.\n'));
  const rl      = readline.createInterface({ input: process.stdin, output: process.stdout });
  const confirm = await ask(rl, c.red('Are you sure? Type yes to confirm: '));
  rl.close();
  if (confirm.trim().toLowerCase() === 'yes') {
    fs.rmSync(VAULT, { recursive: true, force: true });
    ok('Everything deleted. Run anchor to start fresh.');
  } else {
    console.log(c.yellow('Reset cancelled. Nothing was deleted.'));
  }
  process.exit(0);
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────
async function main() {
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];

  if (arg1 === 'reset') {
    if (arg2 === '--hard') { await hardReset(); return; }
    await softReset(); return;
  }

  // ── Auto-restart when source file changes ──────────────────────────────────
  fs.watch(__filename, { persistent: false }, (event) => {
    if (event !== 'change') return;
    console.log(c.yellow('\n⚙  Anchor updated — restarting...\n'));
    if (globalRl) globalRl.close();
    const child = spawn(process.execPath, process.argv.slice(1), { stdio: 'inherit', detached: false });
    child.on('exit', code => process.exit(code || 0));
  });

  printBanner();
  await checkOllama();
  createVault();
  // Load saved model preference before checking/pulling
  const bootMem = loadMemory();
  if (bootMem.model) activeModel = bootMem.model;
  await checkModel();
  buildIndex();

  const ses = loadSession();
  globalRl  = readline.createInterface({ input: process.stdin, output: process.stdout });
  const rl  = globalRl;

  if (!ses.onboardingComplete) {
    await runOnboarding(rl);
  }

  await mainLoop(rl);
}

main().catch(e => { err(`Fatal: ${e.message}`); process.exit(1); });
