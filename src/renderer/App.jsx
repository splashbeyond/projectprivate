import React, { useState, useEffect } from 'react'
import Onboarding from './Onboarding'
import Chat       from './Chat'
import Editor     from './Editor'
import NoteViewer from './NoteViewer'
import Sidebar    from './Sidebar'
import StatusBar  from './StatusBar'
import Settings   from './Settings'

export default function App() {
  const [booting,    setBooting]    = useState(true)
  const [onboarded,  setOnboarded]  = useState(false)
  const [mode,       setMode]       = useState('chat')
  const [activeNote, setActiveNote] = useState(null)
  const [anchorName, setAnchorName] = useState('Anchor')
  const [greeting,   setGreeting]   = useState('')
  const [vaultNotes, setVaultNotes] = useState([])

  // Chat state
  const [chats,      setChats]      = useState([])
  const [activeChat, setActiveChat] = useState(null)

  useEffect(() => {
    window.anchor.ready().then(({ onboardingComplete, greeting, anchorName }) => {
      setOnboarded(onboardingComplete)
      setGreeting(greeting)
      setAnchorName(anchorName || 'Anchor')
      setBooting(false)

      if (onboardingComplete) {
        loadChats()
      }
    })

    window.anchor.onVaultChange(() => refreshNotes())
    refreshNotes()
    return () => window.anchor.offVaultChange()
  }, [])

  async function loadChats() {
    const list = await window.anchor.chatsList()
    setChats(list)
    // Auto-select most recent, or create first chat
    if (list.length > 0) {
      setActiveChat(list[0])
    } else {
      const fresh = await window.anchor.chatNew()
      setChats([fresh])
      setActiveChat(fresh)
    }
  }

  function refreshNotes() {
    window.anchor.vaultList().then(setVaultNotes)
  }

  function openNote(note, editMode = false) {
    setActiveNote(note)
    setMode(editMode ? 'edit' : 'view')
  }

  function handleOnboardingComplete(name) {
    setAnchorName(name)
    setOnboarded(true)
    setMode('chat')
    refreshNotes()
    loadChats()
  }

  // Called after every AI response — keeps sidebar in sync
  function handleChatUpdated(updatedChat) {
    setChats(prev => {
      const exists = prev.find(c => c.id === updatedChat.id)
      if (exists) return prev.map(c => c.id === updatedChat.id ? updatedChat : c)
      return [updatedChat, ...prev]
    })
    setActiveChat(updatedChat)
  }

  async function handleNewChat() {
    const fresh = await window.anchor.chatNew()
    setChats(prev => [fresh, ...prev])
    setActiveChat(fresh)
    setMode('chat')
  }

  async function handleDeleteChat(id) {
    await window.anchor.chatDelete(id)
    const updated = chats.filter(c => c.id !== id)
    setChats(updated)

    if (activeChat?.id === id) {
      if (updated.length > 0) {
        setActiveChat(updated[0])
      } else {
        const fresh = await window.anchor.chatNew()
        setChats([fresh])
        setActiveChat(fresh)
      }
    }
  }

  if (booting) return <BootScreen />

  if (!onboarded) {
    return <Onboarding onComplete={handleOnboardingComplete} anchorName={anchorName} />
  }

  return (
    <div className="flex flex-col h-screen bg-anchor-canvas">
      {/* Title bar */}
      <div
        className="h-10 flex items-center justify-between px-4 bg-anchor-canvas border-b border-anchor-border select-none"
        style={{ WebkitAppRegion: 'drag' }}
      >
        <div className="w-16" />
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' }}>
          {[
            { id: 'chat',     label: 'Chat'     },
            { id: 'edit',     label: 'Edit'     },
            { id: 'settings', label: 'Settings' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setMode(tab.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                mode === tab.id
                  ? 'bg-anchor-brand text-white'
                  : 'text-anchor-body hover:text-anchor-heading hover:bg-anchor-sidebar'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="w-16" />
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          notes={vaultNotes}
          activeNote={activeNote}
          onOpenNote={openNote}
          onNewNote={() => setMode('edit')}
          chats={chats}
          activeChat={activeChat}
          onSelectChat={(chat) => { setActiveChat(chat); setMode('chat') }}
          onNewChat={handleNewChat}
          onDeleteChat={handleDeleteChat}
        />

        <main className="flex-1 flex flex-col overflow-hidden bg-anchor-canvas">
          {mode === 'chat' && (
            <Chat
              anchorName={anchorName}
              greeting={greeting}
              onOpenNote={openNote}
              vaultNotes={vaultNotes}
              activeChat={activeChat}
              onChatUpdated={handleChatUpdated}
            />
          )}
          {mode === 'edit' && (
            <Editor
              note={activeNote}
              onSave={refreshNotes}
              onViewNote={(note) => openNote(note, false)}
            />
          )}
          {mode === 'view' && activeNote && (
            <NoteViewer
              note={activeNote}
              onEdit={() => setMode('edit')}
              onOpenNote={openNote}
            />
          )}
          {mode === 'settings' && <Settings />}
        </main>
      </div>

      <StatusBar anchorName={anchorName} />
    </div>
  )
}

function BootScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-anchor-canvas gap-3">
      <span className="text-3xl">⚓</span>
      <p className="text-anchor-body text-sm">Starting Anchor...</p>
      <div className="w-32 h-1 bg-anchor-sidebar rounded-full overflow-hidden">
        <div className="h-full bg-anchor-brand rounded-full animate-pulse" style={{ width: '60%' }} />
      </div>
    </div>
  )
}
