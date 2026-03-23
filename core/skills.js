'use strict'

const fs   = require('fs')
const path = require('path')

function readSkillsRaw(vaultPath) {
  try {
    return fs.readFileSync(path.join(vaultPath, 'skills.md'), 'utf8')
  } catch { return '' }
}

// Parse skills.md into array of { name, triggers, instructions }
function parseSkills(vaultPath) {
  const raw    = readSkillsRaw(vaultPath)
  const skills = []
  const blocks = raw.split(/^## /m).slice(1)

  for (const block of blocks) {
    const lines    = block.trim().split('\n')
    const name     = lines[0].trim()
    const trigLine = lines.find(l => l.startsWith('Trigger:'))
    const triggers = trigLine
      ? trigLine.replace('Trigger:', '').split(',').map(t => t.trim().toLowerCase())
      : []
    const instrStart = lines.findIndex(l => l.startsWith('Instructions:'))
    const instructions = instrStart >= 0
      ? lines.slice(instrStart).join('\n')
      : lines.slice(1).join('\n')

    skills.push({ name, triggers, instructions })
  }
  return skills
}

// Find a skill matching the user's message
function findSkill(message, vaultPath) {
  const skills = parseSkills(vaultPath)
  const lower  = message.toLowerCase()
  return skills.find(s =>
    s.triggers.some(t => lower.includes(t))
  ) || null
}

// Run a skill by name — returns the AI response
async function runSkill(skillName, vaultPath) {
  const { askOllamaStructured } = require('./ollama')
  const { findRelevant }        = require('./search')

  const skill = parseSkills(vaultPath).find(
    s => s.name.toLowerCase().includes(skillName.toLowerCase())
  )
  if (!skill) return `Skill "${skillName}" not found. Type /skills to see available skills.`

  const context = findRelevant(skill.name + ' ' + skill.triggers.join(' '))
  return await askOllamaStructured(
    `Run this skill exactly as instructed:\n\n${skill.instructions}`,
    context,
    'Follow the skill instructions precisely. Use vault context provided.'
  )
}

// Teach a new skill — writes to skills.md
function teachSkill(name, instructions, vaultPath) {
  const trigger = name.toLowerCase()
  const entry   = `\n## ${name}\nTrigger: ${trigger}\nInstructions:\n${instructions}\n`
  fs.appendFileSync(path.join(vaultPath, 'skills.md'), entry, 'utf8')
  return `Skill "${name}" saved. I'll use it whenever you say "${trigger}".`
}

function listSkills(vaultPath) {
  const skills = parseSkills(vaultPath)
  if (!skills.length) return 'No skills yet. Teach me one with /learn [name]: [instructions]'
  return skills.map(s => `• ${s.name} — triggers: ${s.triggers.join(', ')}`).join('\n')
}

module.exports = { parseSkills, findSkill, runSkill, teachSkill, listSkills }
