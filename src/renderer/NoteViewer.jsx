import React, { useState, useEffect } from 'react'
import { marked } from 'marked'

export default function NoteViewer({ note, onEdit, onOpenNote }) {
  const [content,   setContent]   = useState('')
  const [backlinks, setBacklinks] = useState([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    if (!note) return
    setLoading(true)
    window.anchor.vaultRead(note.relPath).then(c => {
      setContent(c)
      setLoading(false)
    })
    window.anchor.backlinks().then(bl => {
      setBacklinks(bl[note.name] || [])
    })
  }, [note?.relPath])

  function renderContent(raw) {
    const withLinks = raw.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
      const display = label || target
      return `<span class="wikilink" data-note="${target}">${display}</span>`
    })
    return { __html: marked(withLinks) }
  }

  function handleClick(e) {
    const el = e.target.closest('.wikilink')
    if (!el) return
    window.anchor.vaultList().then(notes => {
      const found = notes.find(n => n.name.toLowerCase() === el.dataset.note.toLowerCase())
      if (found) onOpenNote(found)
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-anchor-body text-sm">Loading...</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-anchor-border bg-anchor-canvas">
        <h2 className="text-sm font-semibold text-anchor-heading truncate">{note?.name}</h2>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-anchor-brand text-white hover:opacity-90 transition-opacity"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Edit
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div
          className="prose max-w-none selectable"
          dangerouslySetInnerHTML={renderContent(content)}
          onClick={handleClick}
        />

        {/* Backlinks */}
        {backlinks.length > 0 && (
          <div className="mt-10 pt-6 border-t border-anchor-border">
            <h3 className="text-xs font-semibold text-anchor-body uppercase tracking-wide mb-3">
              Linked from
            </h3>
            <div className="flex flex-wrap gap-2">
              {backlinks.map(name => (
                <button
                  key={name}
                  onClick={() => {
                    window.anchor.vaultList().then(notes => {
                      const found = notes.find(n => n.name === name)
                      if (found) onOpenNote(found)
                    })
                  }}
                  className="px-2.5 py-1 rounded-lg text-xs bg-anchor-aibg text-anchor-brand hover:bg-anchor-highlight transition-colors"
                >
                  ← {name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
