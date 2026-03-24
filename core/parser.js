'use strict'

// PDF (.pdf), Word (.docx), and plain text (.txt) parsing.
// Large files chunked at 600 words. Output saved as .md next to source.

const fs   = require('fs')
const path = require('path')
const { logError } = require('./health')

async function parseFile(filePath, vaultPath) {
  const ext = path.extname(filePath).toLowerCase()
  if (!['.pdf', '.docx', '.txt'].includes(ext)) return null

  let text = ''
  try {
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse')
      text = (await pdfParse(fs.readFileSync(filePath))).text
    } else if (ext === '.docx') {
      const mammoth = require('mammoth')
      text = (await mammoth.extractRawText({ path: filePath })).value
    } else {
      text = fs.readFileSync(filePath, 'utf8')
    }

    if (!text.trim()) return null

    const name   = path.basename(filePath, ext)
    const today  = new Date().toISOString().split('T')[0]
    const words  = text.split(/\s+/).length

    const markdown = words > 800
      ? chunkDocument(text, name, today)
      : `# ${name}\n\n> Imported: ${today}\n\n---\n\n${cleanText(text)}`

    const outputPath = filePath.replace(ext, '.md')
    fs.writeFileSync(outputPath, markdown)
    return outputPath

  } catch (e) {
    logError('parseFile', e)
    return null
  }
}

function cleanText(text) {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*\d+\s*$/gm, '')
    .split('\n').map(l => l.trim()).join('\n')
    .trim()
}

function chunkDocument(text, name, today) {
  const paragraphs = cleanText(text).split('\n\n').filter(p => p.trim())
  const chunks     = []
  let current = [], count = 0

  for (const para of paragraphs) {
    const words = para.split(/\s+/).length
    if (count + words > 600 && current.length > 0) {
      chunks.push(current.join('\n\n'))
      current = [para]
      count   = words
    } else {
      current.push(para)
      count += words
    }
  }
  if (current.length) chunks.push(current.join('\n\n'))

  return `# ${name}\n\n> Imported: ${today} — ${chunks.length} sections\n\n---\n\n` +
    chunks.map((c, i) => `## Section ${i + 1}\n\n${c}`).join('\n\n---\n\n')
}

module.exports = { parseFile }
