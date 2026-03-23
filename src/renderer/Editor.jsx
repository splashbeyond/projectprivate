import React, { useState, useEffect, useRef } from 'react'
import { marked } from 'marked'

export default function Editor({ note, onSave, onViewNote }) {
  const [content,  setContent]  = useState('')
  const [noteName, setNoteName] = useState('')
  const [preview,  setPreview]  = useState(false)
  const [saved,    setSaved]    = useState(true)
  const textareaRef = useRef(null)
  const saveTimer   = useRef(null)

  useEffect(() => {
    if (note) {
      window.anchor.vaultRead(note.relPath).then(c => {
        setContent(c)
        setNoteName(note.name)
        setSaved(true)
      })
    } else {
      setContent('')
      setNoteName('Untitled')
      setSaved(true)
    }
  }, [note?.relPath])

  function handleChange(val) {
    setContent(val)
    setSaved(false)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(val), 1500)
  }

  async function save(val) {
    const c = val ?? content
    if (!noteName) return
    const relPath = note?.relPath || `${noteName}.md`
    await window.anchor.vaultWrite(relPath, c)
    setSaved(true)
    onSave?.()
  }

  function onKeyDown(e) {
    // Tab → insert 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault()
      const el    = textareaRef.current
      const start = el.selectionStart
      const end   = el.selectionEnd
      const next  = content.slice(0, start) + '  ' + content.slice(end)
      setContent(next)
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2
      })
    }
    // Cmd+S → save
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      save()
    }
  }

  function renderPreview() {
    const withLinks = content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
      return `<span class="wikilink" data-note="${target}">${label || target}</span>`
    })
    return { __html: marked(withLinks) }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-anchor-border bg-anchor-canvas">
        <div className="flex items-center gap-2">
          <input
            value={noteName}
            onChange={e => { setNoteName(e.target.value); setSaved(false) }}
            className="text-sm font-semibold text-anchor-heading bg-transparent outline-none border-b border-transparent focus:border-anchor-brand transition-colors w-48"
            placeholder="Note name..."
          />
          <span className={`text-xs ${saved ? 'text-green-500' : 'text-anchor-body'}`}>
            {saved ? '✓ Saved' : 'Saving...'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Preview toggle */}
          <button
            onClick={() => setPreview(p => !p)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              preview
                ? 'bg-anchor-brand text-white'
                : 'bg-anchor-sidebar text-anchor-body hover:text-anchor-heading'
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {preview ? 'Edit' : 'Preview'}
          </button>

          {/* View note */}
          {note && (
            <button
              onClick={() => onViewNote(note)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-anchor-sidebar text-anchor-body hover:text-anchor-heading transition-colors"
            >
              View
            </button>
          )}

          {/* Save */}
          <button
            onClick={() => save()}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-anchor-brand text-white hover:opacity-90 transition-opacity"
          >
            Save
          </button>
        </div>
      </div>

      {/* Editor / Preview */}
      <div className="flex-1 overflow-hidden flex">
        {preview ? (
          <div className="flex-1 overflow-y-auto px-8 py-6">
            <div
              className="prose max-w-none selectable"
              dangerouslySetInnerHTML={renderPreview()}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden px-6 py-4">
            {/* Formatting hints */}
            <div className="flex items-center gap-3 mb-3 pb-2 border-b border-anchor-border">
              {['# H1', '## H2', '**bold**', '*italic*', '- list', '[[link]]', '- [ ] task'].map(hint => (
                <button
                  key={hint}
                  onClick={() => insertSnippet(hint, textareaRef, content, setContent)}
                  className="text-xs text-anchor-body hover:text-anchor-brand transition-colors font-mono"
                >
                  {hint}
                </button>
              ))}
            </div>

            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => handleChange(e.target.value)}
              onKeyDown={onKeyDown}
              className="flex-1 bg-transparent text-anchor-heading text-sm font-mono leading-relaxed resize-none outline-none selectable"
              placeholder="Start writing in markdown...

Use [[Note Name]] to link to other notes.
Use # for headings, **bold**, *italic*, - for lists."
              spellCheck={false}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function insertSnippet(snippet, ref, content, setContent) {
  const el    = ref.current
  if (!el) return
  const start = el.selectionStart
  const next  = content.slice(0, start) + snippet + content.slice(start)
  setContent(next)
  requestAnimationFrame(() => {
    el.selectionStart = el.selectionEnd = start + snippet.length
    el.focus()
  })
}
