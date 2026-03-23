import React, { useState, useMemo } from 'react'

export default function Sidebar({
  notes, activeNote, onOpenNote, onNewNote,
  chats, activeChat, onSelectChat, onNewChat, onDeleteChat,
}) {
  const [search,    setSearch]    = useState('')
  const [collapsed, setCollapsed] = useState(false)

  const tree = useMemo(() => buildTree(notes), [notes])

  const filtered = useMemo(() => {
    if (!search) return null
    const q = search.toLowerCase()
    return notes.filter(n => n.name.toLowerCase().includes(q) || n.relPath.toLowerCase().includes(q))
  }, [notes, search])

  if (collapsed) {
    return (
      <div className="w-8 flex flex-col items-center pt-3 bg-anchor-sidebar border-r border-anchor-border">
        <button
          onClick={() => setCollapsed(false)}
          className="text-anchor-body hover:text-anchor-brand transition-colors"
          title="Expand sidebar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="w-56 flex flex-col bg-anchor-sidebar border-r border-anchor-border shrink-0 overflow-hidden">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-anchor-border">
        <span className="text-xs font-semibold text-anchor-heading tracking-wide uppercase">Anchor</span>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 rounded hover:bg-anchor-highlight transition-colors"
          title="Collapse"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5A5A72" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      {/* ── Chats section ── */}
      <div className="flex flex-col border-b border-anchor-border">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold text-anchor-body uppercase tracking-wide">Chats</span>
          <button
            onClick={onNewChat}
            className="p-1 rounded hover:bg-anchor-highlight transition-colors"
            title="New chat"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4DA6FF" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto max-h-48 px-1 pb-1">
          {(!chats || chats.length === 0) && (
            <p className="text-xs text-anchor-body px-2 py-1 opacity-60">No chats yet</p>
          )}
          {chats?.map(chat => (
            <ChatRow
              key={chat.id}
              chat={chat}
              active={activeChat?.id === chat.id}
              onSelect={() => onSelectChat(chat)}
              onDelete={() => onDeleteChat(chat.id)}
            />
          ))}
        </div>
      </div>

      {/* ── Vault section ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-anchor-border">
        <span className="text-xs font-semibold text-anchor-body uppercase tracking-wide">Vault</span>
        <button
          onClick={onNewNote}
          className="p-1 rounded hover:bg-anchor-highlight transition-colors"
          title="New note"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4DA6FF" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {/* ── Memory Calendar pinned link ── */}
      <button
        onClick={() => onOpenNote({ name: 'Memory-Calendar', relPath: 'Memory-Calendar.md' })}
        className="flex items-center gap-2 w-full px-3 py-2 border-b border-anchor-border hover:bg-anchor-highlight transition-colors text-left"
        title="Open Memory Calendar"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4DA6FF" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span className="text-xs text-anchor-body font-medium">Memory Calendar</span>
      </button>

      {/* Search */}
      <div className="px-2.5 py-2">
        <div className="flex items-center gap-1.5 bg-anchor-canvas border border-anchor-border rounded-lg px-2.5 py-1.5">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#5A5A72" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search notes..."
            className="flex-1 bg-transparent text-anchor-heading placeholder-anchor-body text-xs outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-anchor-body hover:text-anchor-heading">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="px-3 pb-1">
        <span className="text-xs text-anchor-body">{notes.length} notes</span>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto px-1 pb-3">
        {filtered
          ? <SearchResults results={filtered} activeNote={activeNote} onOpenNote={onOpenNote} />
          : <FileTree tree={tree} activeNote={activeNote} onOpenNote={onOpenNote} />
        }
      </div>
    </div>
  )
}

// ── Chat row ──────────────────────────────────────────────────────────────────

function ChatRow({ chat, active, onSelect, onDelete }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className={`group flex items-center justify-between rounded-lg px-2 py-1.5 cursor-pointer transition-colors ${
        active
          ? 'bg-anchor-highlight'
          : 'hover:bg-anchor-highlight'
      }`}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke={active ? '#4DA6FF' : '#5A5A72'} strokeWidth="2" className="shrink-0">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className={`text-xs truncate ${active ? 'text-anchor-brand font-medium' : 'text-anchor-body'}`}>
          {chat.title || 'New chat'}
        </span>
      </div>

      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="shrink-0 p-0.5 rounded text-anchor-body hover:text-anchor-danger transition-colors"
          title="Delete chat"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      )}
    </div>
  )
}

// ── Search results ────────────────────────────────────────────────────────────

function SearchResults({ results, activeNote, onOpenNote }) {
  if (!results.length) return <p className="text-xs text-anchor-body px-2 py-2">No results</p>
  return (
    <div className="space-y-0.5">
      {results.map(note => (
        <NoteRow key={note.relPath} note={note} active={activeNote?.relPath === note.relPath} onOpen={onOpenNote} />
      ))}
    </div>
  )
}

// ── File tree ─────────────────────────────────────────────────────────────────

function FileTree({ tree, activeNote, onOpenNote }) {
  return (
    <div className="space-y-0.5">
      {tree.map(node => (
        <TreeNode key={node.path || node.relPath} node={node} activeNote={activeNote} onOpenNote={onOpenNote} depth={0} />
      ))}
    </div>
  )
}

function TreeNode({ node, activeNote, onOpenNote, depth }) {
  const [open, setOpen] = useState(depth < 1)

  if (node.type === 'file') {
    return <NoteRow note={node} active={activeNote?.relPath === node.relPath} onOpen={onOpenNote} indent={depth} />
  }

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-left hover:bg-anchor-highlight transition-colors"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#5A5A72" strokeWidth="2"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
          <path d="M9 18l6-6-6-6" />
        </svg>
        <svg width="12" height="12" viewBox="0 0 24 24" fill={open ? '#A8D8FF' : 'none'} stroke="#4DA6FF" strokeWidth="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span className="text-xs text-anchor-heading font-medium truncate">{node.name}</span>
        <span className="text-xs text-anchor-body ml-auto">{node.children?.length}</span>
      </button>
      {open && node.children?.map(child => (
        <TreeNode key={child.path || child.relPath} node={child} activeNote={activeNote} onOpenNote={onOpenNote} depth={depth + 1} />
      ))}
    </div>
  )
}

function NoteRow({ note, active, onOpen, indent = 0 }) {
  return (
    <button
      onClick={() => onOpen(note)}
      className={`flex items-center gap-1.5 w-full py-1 rounded text-left transition-colors ${
        active ? 'bg-anchor-highlight text-anchor-brand' : 'text-anchor-body hover:bg-anchor-highlight hover:text-anchor-heading'
      }`}
      style={{ paddingLeft: `${8 + indent * 12}px`, paddingRight: '8px' }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span className="text-xs truncate">{note.name}</span>
    </button>
  )
}

function buildTree(notes) {
  const root = []
  const dirs = {}
  const sorted = [...notes].sort((a, b) => {
    const aDepth = a.relPath.split('/').length
    const bDepth = b.relPath.split('/').length
    return aDepth - bDepth || a.name.localeCompare(b.name)
  })
  for (const note of sorted) {
    const parts = note.relPath.split('/')
    if (parts.length === 1) { root.push({ type: 'file', ...note }); continue }
    let current = root
    let dirPath = ''
    for (let i = 0; i < parts.length - 1; i++) {
      dirPath = dirPath ? `${dirPath}/${parts[i]}` : parts[i]
      if (!dirs[dirPath]) {
        const folder = { type: 'folder', name: parts[i], path: dirPath, children: [] }
        dirs[dirPath] = folder
        current.push(folder)
      }
      current = dirs[dirPath].children
    }
    current.push({ type: 'file', ...note })
  }
  return root
}
