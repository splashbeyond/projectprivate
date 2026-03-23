import React, { useState, useEffect, useRef } from 'react'
import { marked } from 'marked'

marked.setOptions({ breaks: true, gfm: true })

export default function Chat({ anchorName, greeting, onOpenNote, vaultNotes }) {
  const [history,   setHistory]   = useState([])
  const [input,     setInput]     = useState('')
  const [thinking,  setThinking]  = useState(false)
  const [streaming, setStreaming] = useState('')
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  // Refs to track state inside event callbacks
  const historyRef  = useRef(history)
  const streamRef   = useRef(streaming)
  useEffect(() => { historyRef.current  = history  }, [history])
  useEffect(() => { streamRef.current   = streaming }, [streaming])

  // Greeting message on mount
  useEffect(() => {
    if (greeting) {
      setHistory([{ role: 'assistant', content: greeting }])
    }

    window.anchor.onToken((tok) => {
      setStreaming(prev => prev + tok)
    })
    window.anchor.onTokenEnd(() => {
      const response = streamRef.current
      setStreaming('')
      setThinking(false)
      if (response) {
        const updated = [...historyRef.current, { role: 'assistant', content: response }]
        setHistory(updated)
        historyRef.current = updated
      }
    })
    window.anchor.onTokenErr((msg) => {
      setStreaming('')
      setThinking(false)
      const updated = [...historyRef.current, {
        role: 'assistant',
        content: `Something went wrong: ${msg}`,
        error: true,
      }]
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
    if (!msg || thinking) return
    setInput('')

    // Handle /newchat
    if (msg === '/newchat') {
      setHistory([{ role: 'assistant', content: 'Starting fresh. I still remember everything.' }])
      historyRef.current = []
      return
    }

    const updated = [...history, { role: 'user', content: msg }]
    setHistory(updated)
    historyRef.current = updated
    setThinking(true)

    window.anchor.chat(msg, updated.slice(-10))
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // Render markdown with wikilink support
  function renderContent(content) {
    // Convert [[Note]] to clickable spans before markdown parse
    const withLinks = content.replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
      return `<span class="wikilink" data-note="${name}">${name}</span>`
    })
    return { __html: marked(withLinks) }
  }

  // Handle wikilink clicks in rendered HTML
  function handleContentClick(e) {
    const el = e.target.closest('.wikilink')
    if (!el) return
    const noteName = el.dataset.note
    const found = vaultNotes.find(n =>
      n.name.toLowerCase() === noteName.toLowerCase()
    )
    if (found) onOpenNote(found)
  }

  const displayHistory = streaming
    ? [...history, { role: 'assistant', content: streaming, streaming: true }]
    : history

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
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
            disabled={!input.trim() || thinking}
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
  const isUser = msg.role === 'user'

  if (isUser) {
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
          <div className="mt-1 ml-4">
            <span className="inline-block w-1.5 h-3.5 bg-anchor-brand animate-pulse rounded-sm" />
          </div>
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
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-anchor-brand"
          style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40%            { transform: scale(1);   opacity: 1;   }
        }
      `}</style>
    </div>
  )
}
