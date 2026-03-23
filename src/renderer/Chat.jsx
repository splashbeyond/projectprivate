import React, { useState, useEffect, useRef } from 'react'
import { marked } from 'marked'

marked.setOptions({ breaks: true, gfm: true })

export default function Chat({ anchorName, greeting, onOpenNote, vaultNotes, activeChat, onChatUpdated }) {
  const [history,   setHistory]   = useState([])
  const [input,     setInput]     = useState('')
  const [thinking,  setThinking]  = useState(false)
  const [streaming, setStreaming] = useState('')
  const bottomRef     = useRef(null)
  const inputRef      = useRef(null)
  const historyRef    = useRef(history)
  const streamRef     = useRef(streaming)
  const activeChatRef = useRef(activeChat)

  useEffect(() => { historyRef.current    = history    }, [history])
  useEffect(() => { streamRef.current     = streaming  }, [streaming])
  useEffect(() => { activeChatRef.current = activeChat }, [activeChat])

  // Load messages when active chat changes
  useEffect(() => {
    if (!activeChat) return
    const msgs = activeChat.messages?.length
      ? activeChat.messages
      : (greeting ? [{ role: 'assistant', content: greeting }] : [])
    setHistory(msgs)
    historyRef.current = msgs
    setStreaming('')
    setInput('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [activeChat?.id])

  // Streaming listeners — set up once
  useEffect(() => {
    window.anchor.onToken((tok) => setStreaming(prev => prev + tok))

    window.anchor.onTokenEnd(async () => {
      const response = streamRef.current
      setStreaming('')
      setThinking(false)
      if (!response) return

      const updated = [...historyRef.current, { role: 'assistant', content: response }]
      setHistory(updated)
      historyRef.current = updated

      const chat = activeChatRef.current
      if (!chat) return

      const saved = await window.anchor.chatSave({ ...chat, messages: updated })

      // Auto-title after first exchange, only once
      if (chat.title === 'New chat' && updated.length >= 2) {
        const title = await window.anchor.chatTitle(chat.id, updated)
        onChatUpdated({ ...saved, title: title || saved.title })
      } else {
        onChatUpdated(saved)
      }
    })

    window.anchor.onTokenErr((msg) => {
      setStreaming('')
      setThinking(false)
      const updated = [...historyRef.current, { role: 'assistant', content: `Error: ${msg}`, error: true }]
      setHistory(updated)
    })

    inputRef.current?.focus()
    return () => window.anchor.offStreaming()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, streaming])

  async function send() {
    const msg = input.trim()
    if (!msg || thinking || !activeChat) return
    setInput('')
    const updated = [...historyRef.current, { role: 'user', content: msg }]
    setHistory(updated)
    historyRef.current = updated
    setThinking(true)
    window.anchor.chat(msg, updated.slice(-10))
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  function renderContent(content) {
    const withLinks = content.replace(/\[\[([^\]]+)\]\]/g, (_, name) =>
      `<span class="wikilink" data-note="${name}">${name}</span>`
    )
    return { __html: marked(withLinks) }
  }

  function handleContentClick(e) {
    const el = e.target.closest('.wikilink')
    if (!el) return
    const found = vaultNotes.find(n => n.name.toLowerCase() === el.dataset.note.toLowerCase())
    if (found) onOpenNote(found)
  }

  const displayHistory = streaming
    ? [...history, { role: 'assistant', content: streaming, streaming: true }]
    : history

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {displayHistory.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-40 select-none">
            <span className="text-3xl">⚓</span>
            <p className="text-sm text-anchor-body">Start a conversation</p>
          </div>
        )}

        {displayHistory.map((msg, i) => (
          <Message
            key={i}
            msg={msg}
            anchorName={anchorName}
            renderContent={renderContent}
            onContentClick={handleContentClick}
          />
        ))}

        {thinking && !streaming && (
          <div className="flex items-start gap-3">
            <Avatar name={anchorName} />
            <div className="bg-anchor-aibg rounded-2xl rounded-tl-sm px-4 py-3">
              <ThinkingDots />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-6 pb-5">
        <div className="flex items-end gap-2 bg-anchor-sidebar border border-anchor-border rounded-2xl px-4 py-3 focus-within:border-anchor-brand transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Message ${anchorName}...`}
            rows={1}
            className="flex-1 bg-transparent text-anchor-heading placeholder-anchor-body text-sm resize-none outline-none selectable leading-relaxed"
            style={{ maxHeight: '160px' }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || thinking || !activeChat}
            className="p-1.5 rounded-lg bg-anchor-brand text-white disabled:opacity-30 transition-opacity hover:opacity-90 shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </button>
        </div>
        <p className="text-center text-anchor-body text-xs mt-2 opacity-50">
          Enter to send · Shift+Enter for newline · /help for commands
        </p>
      </div>
    </div>
  )
}

function Message({ msg, anchorName, renderContent, onContentClick }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-lg bg-anchor-brand text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm selectable leading-relaxed">
          {msg.content}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-3">
      <Avatar name={anchorName} />
      <div className="flex-1 max-w-2xl">
        <div
          className={`rounded-2xl rounded-tl-sm px-4 py-3 text-sm prose ${
            msg.error ? 'bg-red-50 border border-red-100' : 'bg-anchor-aibg'
          }`}
          dangerouslySetInnerHTML={renderContent(msg.content)}
          onClick={onContentClick}
        />
        {msg.streaming && (
          <span className="inline-block w-1.5 h-3.5 bg-anchor-brand animate-pulse rounded-sm mt-1 ml-4" />
        )}
      </div>
    </div>
  )
}

function Avatar({ name }) {
  return (
    <div className="w-7 h-7 rounded-full bg-anchor-brand flex items-center justify-center shrink-0 mt-0.5">
      <span className="text-white text-xs font-semibold">
        {name ? name[0].toUpperCase() : '⚓'}
      </span>
    </div>
  )
}

function ThinkingDots() {
  return (
    <div className="flex gap-1 items-center h-4">
      {[0, 1, 2].map(i => (
        <div key={i} className="w-1.5 h-1.5 rounded-full bg-anchor-brand"
          style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
      ))}
      <style>{`@keyframes bounce{0%,80%,100%{transform:scale(0.6);opacity:.4}40%{transform:scale(1);opacity:1}}`}</style>
    </div>
  )
}
