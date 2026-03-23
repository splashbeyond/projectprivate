'use strict'

const today = () => new Date().toISOString().split('T')[0]

const TEMPLATES = {
  'ANCHOR.md': () => `# Anchor Command Center

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
User can change anytime with /tone [description].

## Core rules
- Never fabricate facts not in vault or web monitor context
- Always cite sources: [Vault: Note Name] or [Web: title]
- If unsure say so — never guess
- Never transmit vault content externally
- You run in a fully closed local system
- Check goals.md, todolist.md, projects.md on every query
- Check people.md when any person is mentioned
- Check skills.md when a task matches a known skill
- One question at a time — never overwhelm

## Reasoning rules
Think before answering complex questions.
Base all answers on vault context first.
If vault has clear evidence: answer directly — cite [Vault: Note Name]
If vault has partial evidence: say "Based on [Note Name], it seems..."
If vault has no evidence: say "I don't have that in my vault"
Never fill gaps with assumptions.
Uncertainty is always better than a confident wrong answer.

## Recall rules
You have a rich memory system. Use it.
Before every response check:
- anchor-memory.json for known entities and remembered facts
- anchor-session.json for what was discussed last session
- people.md when a name is mentioned
- goals.md when priorities or direction are discussed
- todolist.md when tasks or work is mentioned
- projects.md when projects are mentioned
Connect dots across notes — this is your most valuable skill.
If something was mentioned before, reference it.
Never act like you are meeting the user for the first time.

## Communication rules
Understand natural language — users never need to use commands.
If someone says "remind me to call John" treat it as /todo add.
If someone says "I just closed a deal" treat it as /win.
If someone says "I have an idea" treat it as /idea.
Match the user's energy and language.
Be conversational, warm, and direct.
Never make the user feel like they are using a command line.
Never say "Certainly!" or "Of course!" — get to the point.

## Response format
Simple questions: 1-3 sentences, direct.
Complex questions: clear paragraphs, cite sources.
Lists and extractions: structured bullet points.
Analysis: brief reasoning then conclusion.

## Privacy
Everything stays local. Always. No exceptions.

## Cron schedule
Daily digest: 11pm every night
Morning briefing: 7am every morning
Weekly review: Friday 5pm
Weekly priorities: Monday 7am
Memory consolidation: 11:30pm every night
Todo extraction: 11:15pm every night
Web monitor: 6am every morning

## Onboarding complete
false
`,

  'skills.md': () => `# Skills

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
6. Write professional tone, one page maximum

## Daily briefing
Trigger: morning briefing, daily briefing, catch me up
Instructions:
1. Check todolist.md for items due today
2. Summarise last 3 daily digests
3. Pull top priorities from weekly note
4. List any flagged urgent items
5. Write in bullet points, keep under one page

## Weekly review
Trigger: weekly review, end of week
Instructions:
1. Summarise all notes modified this week
2. Review goals.md — what progress was made
3. Check wins.md — what was completed
4. List what carried over to next week
5. Write honest reflection paragraph
6. Suggest top 3 priorities for next week

## Extract action items
Trigger: extract actions, find todos
Instructions:
1. Read all notes provided
2. Find every sentence implying a task or commitment
3. Format as: - [ ] [task] — [owner if mentioned] — [deadline if mentioned]
4. Add to today section of todolist.md
5. Do not duplicate existing items
`,

  'tasks.md': () => `# Tasks

## Scheduled
| Task | Schedule | Output |
|------|----------|--------|
| Daily digest | Every night 11pm | Daily Digests/[date].md |
| Extract action items | Every night 11:15pm | todolist.md |
| Memory consolidation | Every night 11:30pm | anchor-memory.json |
| Morning briefing | Every day 7am | Morning Briefings/[date].md |
| Web monitor | Every day 6am | Web Monitor/[date]/ |
| Weekly review | Friday 5pm | Weekly/[date]-review.md |
| Weekly priorities | Monday 7am | Weekly/[date]-priorities.md |

## Event triggered
| Trigger | Task |
|---------|------|
| New file in /Projects/ | Auto-tag + link to project note |
| New file anywhere | Extract action items if present |
| Monday morning | Pull top goals for the week |

## User defined
[Add custom tasks here or via /task add]
`,

  'goals.md': () => `# Goals

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
`,

  'projects.md': () => `# Projects

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
`,

  'todolist.md': () => `# To-do list

## Today
- [ ] [Tasks appear here — added manually or auto-extracted by Anchor]

## This week
- [ ] [Weekly tasks]

## Backlog
- [ ] [Backlog items]

## Waiting on
- [ ] [Items waiting for others]

## Done today

---
Auto-updated by Anchor nightly.
`,

  'people.md': () => `# People

## [FULL NAME]
Role: [TITLE] at [COMPANY]
Relationship: [CLIENT/COLLEAGUE/PARTNER/VENDOR]
Last contact: [DATE]
Key facts:
- [FACT]
Projects: [[Project Name]]
Notes: [ANYTHING IMPORTANT]

---
`,

  'decisions.md': () => `# Decisions

## [DECISION TITLE]
Date: [DATE]
Context: [WHY THIS DECISION WAS NEEDED]
Options considered:
- [OPTION A]
- [OPTION B]
Decision: [WHAT WAS DECIDED]
Reasoning: [WHY]
Outcome: [FILL IN LATER]

---
`,

  'ideas.md': () => `# Ideas

## [IDEA TITLE]
Date: [DATE]
Category: [PRODUCT/BUSINESS/PROCESS/PERSONAL]
Status: [RAW/DEVELOPING/READY TO ACT]
Linked to: [[Project]] or [[Goal]]

[FREE FORM IDEA TEXT]

---
`,

  'wins.md': () => `# Wins

## [WIN TITLE]
Date: [DATE]
Category: [PERSONAL/BUSINESS/PROJECT/RELATIONSHIP]
Impact: [WHY THIS MATTERED]
Linked to: [[Goal]] or [[Project]]

---
`,
}

const DEFAULT_MEMORY = () => ({
  entities:     {},
  preferences:  {},
  conversations: [],
  userDefined:  [],
  userName:     '',
  anchorName:   'Anchor',
  role:         '',
  industry:     '',
  goals:        '',
  workingHours: '9am-6pm',
  commStyle:    'conversational',
  model:        'llama3.2:3b',
})

const DEFAULT_SESSION = () => ({
  onboardingComplete: false,
  anchorName:         'Anchor',
  userName:           '',
  lastSession:        null,
})

module.exports = { TEMPLATES, DEFAULT_MEMORY, DEFAULT_SESSION }
