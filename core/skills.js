'use strict'

// Thin shim — redirects to skill-engine.js.

const {
  parseSkillsFile, matchSkill, executeSkill, learnSkill,
} = require('./skill-engine')
const { buildContext } = require('./context-builder')

function parseSkills(vaultPath) { return parseSkillsFile(vaultPath) }
const findSkill = matchSkill

async function runSkill(message, vaultPath) {
  const match = matchSkill(message, vaultPath)
  if (!match) return null
  return executeSkill(match, vaultPath, buildContext)
}

async function teachSkill(vaultPath, name, triggers, instructions) {
  return learnSkill(vaultPath, name, triggers, instructions)
}

function listSkills(vaultPath) {
  return Object.values(parseSkillsFile(vaultPath)).map(s => ({
    name: s.name, triggers: s.triggers, usageCount: s.usageCount,
  }))
}

module.exports = { parseSkills, findSkill, runSkill, teachSkill, listSkills }
