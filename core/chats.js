'use strict'

const fs   = require('fs')
const path = require('path')

const chatsDir = (vaultPath) => path.join(vaultPath, 'Chats')

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
  return chat
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
  const p = chatPath(vaultPath, id)
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

function updateChatTitle(vaultPath, id, title) {
  const chat = loadChat(vaultPath, id)
  if (!chat) return
  chat.title = title
  saveChat(vaultPath, chat)
}

module.exports = { listChats, loadChat, saveChat, createChat, deleteChat, updateChatTitle }
