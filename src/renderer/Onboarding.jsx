import React, { useState, useEffect, useRef } from 'react'

export default function Onboarding({ onComplete }) {
  const [history,  setHistory]  = useState([])
  const [input,    setInput]    = useState('')
  const [thinking, setThinking] = useState(false)
  const [streaming, setStreaming] = useState('')
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  // Kick off the first Anchor message on mount
  useEffect(() => {
    startOnboarding()
    inputRef.current?.focus()

    window.anchor.onToken((tok) => {
      setStreaming(prev => prev + tok)
    })
    window.anchor.onTokenEnd(async () => {
      const response = streamRef.current
      setStreaming('')
      setThinking(false)

      if (response) {
        const updated = [...historyRef.current, { role: 'assistant', content: response }]
        setHistory(updated)
        historyRef.current = updated

        // Check if onboarding is complete
        if (response.toLowerCase().includes("your vault is ready. let us get to work")) {
          setTimeout(async () => {
            const result = await window.anchor.onboardingFinish(updated)
            onComplete(result.anchorName || 'Anchor')
          }, 1200)
        }
      }
    })

    return () => window.anchor.offStreaming()
  }, [])

  // Refs to track latest state inside event handlers
  const historyRef = useRef(history)
  const streamRef  = useRef(streaming)
  useEffect(() => { historyRef.current = history }, [history])
  useEffect(() => { streamRef.current  = streaming }, [streaming])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, streaming])

  async function startOnboarding() {
    setThinking(true)
    window.anchor.onboardingChat('Hello', [])
  }

  async function send() {
    const msg = input.trim()
    if (!msg || thinking) return
    setInput('')

    const updated = [...history, { role: 'user', content: msg }]
    setHistory(updated)
    historyRef.current = updated
    setThinking(true)

    window.anchor.onboardingChat(msg, updated)
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const displayHistory = streaming
    ? [...history, { role: 'assistant', content: streaming, streaming: true }]
    : history

  return (
    <div className="flex flex-col h-screen bg-anchor-canvas">
      {/* Header */}
      <div
        className="h-10 bg-anchor-canvas border-b border-anchor-border"
        style={{ WebkitAppRegion: 'drag' }}
      />

      <div className="flex flex-col flex-1 max-w-2xl mx-auto w-full px-6 overflow-hidden">
        {/* Logo */}
        <div className="pt-12 pb-6 text-center">
          <div className="text-4xl mb-2">⚓</div>
          <h1 className="text-xl font-semibold text-anchor-heading">Anchor</h1>
          <p className="text-anchor-body text-xs mt-1">Private AI workspace — 100% local</p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 pb-4">
          {displayHistory.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-sm rounded-2xl px-4 py-3 text-sm selectable leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-anchor-brand text-white rounded-br-sm'
                  : 'bg-anchor-aibg text-anchor-heading rounded-bl-sm'
              }`}>
                {msg.content}
                {msg.streaming && (
                  <span className="inline-block w-1.5 h-3.5 bg-anchor-brand ml-0.5 animate-pulse rounded-sm" />
                )}
              </div>
            </div>
          ))}

          {thinking && !streaming && (
            <div className="flex justify-start">
              <div className="bg-anchor-aibg rounded-2xl rounded-bl-sm px-4 py-3">
                <ThinkingDots />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="pb-8">
          <div className="flex items-end gap-2 bg-anchor-sidebar border border-anchor-border rounded-2xl px-4 py-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type your answer..."
              rows={1}
              className="flex-1 bg-transparent text-anchor-heading placeholder-anchor-body text-sm resize-none outline-none selectable"
              style={{ maxHeight: '120px' }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || thinking}
              className="p-1.5 rounded-lg bg-anchor-brand text-white disabled:opacity-30 transition-opacity hover:opacity-90"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
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
