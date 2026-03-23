'use strict'

const fs   = require('fs')
const path = require('path')

const chatsDir   = (vaultPath) => path.join(vaultPath, 'Chats')
const safeName   = (title) => title.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 80)
const mdPath     = (vaultPath, title) => path.join(chatsDir(vaultPath), `${safeName(title)}.md`)

function ensureChatsDir(vaultPath) {
  fs.mkdirSync(chatsDir(vaultPath), { recursive: true })
}

function chatPath(vaultPath, id) {
  return path.join(chatsDir(vaultPath), `${id}.json`)
}

function listChats(vaultPath) {
  ensureChatsDir(vaultPath)
  const dir = chatsDir(vaultPath)
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
}

function loadChat(vaultPath, id) {
  try {
    return JSON.parse(fs.readFileSync(chatPath(vaultPath, id), 'utf8'))
  } catch { return null }
}

function saveChat(vaultPath, chat) {
  ensureChatsDir(vaultPath)
  chat.updatedAt = new Date().toISOString()
  fs.writeFileSync(chatPath(vaultPath, chat.id), JSON.stringify(chat, null, 2), 'utf8')
  // Also write Obsidian-style .md transcript (only once we have a real title)
  if (chat.title && chat.title !== 'New chat') {
    writeChatMd(vaultPath, chat)
  }
  return chat
}

function writeChatMd(vaultPath, chat) {
  const date     = (chat.createdAt || new Date().toISOString()).split('T')[0]
  const messages = (chat.messages || []).filter(m => m.role === 'user' || m.role === 'assistant')

  // Build tag list from title words (rough auto-tag)
  const tags = chat.title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .split(' ')
    .filter(w => w.length > 3)
    .slice(0, 6)
    .join(', ')

  const frontmatter = [
    '---',
    `title: "${chat.title}"`,
    `date: ${date}`,
    `tags: [${tags}]`,
    `type: chat`,
    `id: ${chat.id}`,
    '---',
  ].join('\n')

  const body = messages.map(m => {
    const speaker = m.role === 'user' ? '**You:**' : '**Anchor:**'
    return `${speaker} ${m.content}`
  }).join('\n\n')

  const content = `${frontmatter}\n\n# ${chat.title}\n\n**Date:** ${date}\n\n## Conversation\n\n${body}\n`

  try {
    fs.writeFileSync(mdPath(vaultPath, chat.title), content, 'utf8')
  } catch (e) {
    console.error('Chat .md write failed:', e.message)
  }
}

function createChat(vaultPath) {
  const id   = Date.now().toString()
  const chat = {
    id,
    title:     'New chat',
    messages:  [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  return saveChat(vaultPath, chat)
}

function deleteChat(vaultPath, id) {
  const chat = loadChat(vaultPath, id)
  const p = chatPath(vaultPath, id)
  if (fs.existsSync(p)) fs.unlinkSync(p)
  // Clean up .md if it exists
  if (chat?.title && chat.title !== 'New chat') {
    const md = mdPath(vaultPath, chat.title)
    if (fs.existsSync(md)) fs.unlinkSync(md)
  }
}

function updateChatTitle(vaultPath, id, title) {
  const chat = loadChat(vaultPath, id)
  if (!chat) return
  // Remove old .md if title is changing
  if (chat.title && chat.title !== 'New chat' && chat.title !== title) {
    const old = mdPath(vaultPath, chat.title)
    if (fs.existsSync(old)) fs.unlinkSync(old)
  }
  chat.title = title
  saveChat(vaultPath, chat)
}

module.exports = { listChats, loadChat, saveChat, createChat, deleteChat, updateChatTitle }
