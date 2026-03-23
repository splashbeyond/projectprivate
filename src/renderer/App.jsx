import React, { useState, useEffect } from 'react'
import Onboarding from './Onboarding'
import Chat       from './Chat'
import Editor     from './Editor'
import NoteViewer from './NoteViewer'
import Sidebar    from './Sidebar'
import StatusBar  from './StatusBar'
import Settings   from './Settings'

export default function App() {
  const [ready,    setReady]    = useState(false)
  const [booting,  setBooting]  = useState(true)
  const [onboarded, setOnboarded] = useState(false)
  const [mode,     setMode]     = useState('chat')      // 'chat' | 'edit' | 'view' | 'settings'
  const [activeNote, setActiveNote] = useState(null)    // { relPath, name }
  const [anchorName, setAnchorName] = useState('Anchor')
  const [greeting,   setGreeting]   = useState('')
  const [vaultNotes, setVaultNotes] = useState([])

  useEffect(() => {
    window.anchor.ready().then(({ onboardingComplete, greeting, anchorName }) => {
      setOnboarded(onboardingComplete)
      setGreeting(greeting)
      setAnchorName(anchorName || 'Anchor')
      setReady(true)
      setBooting(false)
    })

    // Listen for vault file changes
    window.anchor.onVaultChange(() => {
      refreshNotes()
    })
    refreshNotes()

    return () => window.anchor.offVaultChange()
  }, [])

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
  }

  if (booting) return <BootScreen />

  if (!onboarded) {
    return (
      <Onboarding
        onComplete={handleOnboardingComplete}
        anchorName={anchorName}
      />
    )
  }

  return (
    <div className="flex flex-col h-screen bg-anchor-canvas">
      {/* Title bar drag region */}
      <div
        className="h-10 flex items-center justify-between px-4 bg-anchor-canvas border-b border-anchor-border select-none"
        style={{ WebkitAppRegion: 'drag' }}
      >
        {/* Traffic lights space */}
        <div className="w-16" />

        {/* Tab bar */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' }}
        >
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
        />

        <main className="flex-1 flex flex-col overflow-hidden bg-anchor-canvas">
          {mode === 'chat' && (
            <Chat
              anchorName={anchorName}
              greeting={greeting}
              onOpenNote={openNote}
              vaultNotes={vaultNotes}
            />
          )}
          {mode === 'edit' && (
            <Editor
              note={activeNote}
              onSave={() => refreshNotes()}
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
          {mode === 'settings' && (
            <Settings />
          )}
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
