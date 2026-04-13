import React, { useState, useEffect } from 'react'

export default function Settings() {
  const [sources,    setSources]    = useState({ feeds: [], urls: [] })
  const [newUrl,     setNewUrl]     = useState('')
  const [urlType,    setUrlType]    = useState('feed')
  const [feedback,   setFeedback]   = useState('')
  const [resetting,  setResetting]  = useState(false)
  const [status,     setStatus]     = useState(null)
  const [skills,     setSkills]     = useState([])

  // New skill form state
  const [skillName,    setSkillName]    = useState('')
  const [skillTriggers, setSkillTriggers] = useState('')
  const [skillInstr,   setSkillInstr]   = useState('')
  const [skillSaving,  setSkillSaving]  = useState(false)

  useEffect(() => {
    window.anchor.monitorSources().then(setSources)
    window.anchor.status().then(setStatus)
    window.anchor.skillsList().then(setSkills)
  }, [])

  function flash(msg) {
    setFeedback(msg)
    setTimeout(() => setFeedback(''), 2500)
  }

  async function addSource() {
    const url = newUrl.trim()
    if (!url) return
    try {
      new URL(url) // validate
    } catch {
      flash('Invalid URL')
      return
    }

    if (urlType === 'feed') {
      await window.anchor.monitorAddFeed(url)
      setSources(s => ({ ...s, feeds: [...s.feeds, url] }))
    } else {
      await window.anchor.monitorAddUrl(url)
      setSources(s => ({ ...s, urls: [...s.urls, url] }))
    }
    setNewUrl('')
    flash('Added')
  }

  async function removeSource(url) {
    await window.anchor.monitorRemove(url)
    setSources(s => ({
      feeds: s.feeds.filter(f => f !== url),
      urls:  s.urls.filter(u => u !== url),
    }))
  }

  async function runMonitorNow() {
    flash('Running web monitor...')
    await window.anchor.monitorRunNow()
    flash('Web monitor complete')
  }

  async function createSkill() {
    const name     = skillName.trim()
    const triggers = skillTriggers.split(',').map(t => t.trim()).filter(Boolean)
    const instr    = skillInstr.trim()
    if (!name || !triggers.length || !instr) { flash('Name, triggers, and instructions are required'); return }
    setSkillSaving(true)
    await window.anchor.skillCreate(name, triggers, instr)
    const updated = await window.anchor.skillsList()
    setSkills(updated)
    setSkillName(''); setSkillTriggers(''); setSkillInstr('')
    setSkillSaving(false)
    flash(`Skill "${name}" created`)
  }

  async function deleteSkill(name) {
    await window.anchor.skillDelete(name)
    setSkills(s => s.filter(sk => sk.name !== name))
    flash(`Skill "${name}" deleted`)
  }

  async function doReset() {
    if (!confirm('This will wipe memory and session and restart onboarding. Your notes will not be deleted. Continue?')) return
    setResetting(true)
    await window.anchor.reset()
    window.location.reload()
  }

  async function doHardReset() {
    const confirmed = prompt('Type YES to permanently delete your entire vault. This cannot be undone.')
    if (confirmed !== 'YES') return
    await window.anchor.resetHard()
    window.location.reload()
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6 max-w-2xl">
      <h1 className="text-lg font-semibold text-anchor-heading mb-6">Settings</h1>

      {/* System status */}
      {status && (
        <Section title="System">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <StatusRow label="Model"   value={status.model || 'llama3.2:3b'} />
            <StatusRow label="Notes"   value={status.notes} />
            <StatusRow label="Memory facts" value={status.memoryFacts} />
            <StatusRow label="Privacy" value="100% local — zero egress" accent />
            <div className="col-span-2">
              <StatusRow label="Vault" value={status.vault} mono />
            </div>
          </div>
        </Section>
      )}

      {/* Skills */}
      <Section title="Skills">
        <p className="text-xs text-anchor-body mb-4">
          Skills are triggered by phrases you type. Anchor runs the instructions and returns the result.
        </p>

        {/* Existing skills */}
        {skills.length > 0 && (
          <div className="space-y-2 mb-5">
            {skills.map(sk => (
              <div key={sk.name} className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-lg bg-anchor-sidebar border border-anchor-border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-anchor-heading">{sk.name}</span>
                    {sk.autoSuggested && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-anchor-brand/10 text-anchor-brand">auto</span>
                    )}
                    {sk.usageCount > 0 && (
                      <span className="text-[10px] text-anchor-body">used {sk.usageCount}×</span>
                    )}
                  </div>
                  <p className="text-[11px] text-anchor-body mt-0.5 truncate">
                    Triggers: {sk.triggers.slice(0, 3).join(', ')}{sk.triggers.length > 3 ? '…' : ''}
                  </p>
                </div>
                <button
                  onClick={() => deleteSkill(sk.name)}
                  className="text-anchor-body hover:text-red-500 transition-colors shrink-0 mt-0.5"
                  title="Delete skill"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Create skill form */}
        <div className="space-y-2.5 p-3 rounded-lg border border-anchor-border bg-anchor-sidebar">
          <p className="text-[11px] font-semibold text-anchor-heading uppercase tracking-wide">New skill</p>
          <input
            value={skillName}
            onChange={e => setSkillName(e.target.value)}
            placeholder="Name (e.g. summarise-meeting)"
            className="w-full px-3 py-1.5 rounded-lg text-xs border border-anchor-border bg-anchor-canvas text-anchor-heading outline-none focus:border-anchor-brand transition-colors"
          />
          <input
            value={skillTriggers}
            onChange={e => setSkillTriggers(e.target.value)}
            placeholder="Trigger phrases, comma separated (e.g. summarise meeting, meeting notes)"
            className="w-full px-3 py-1.5 rounded-lg text-xs border border-anchor-border bg-anchor-canvas text-anchor-heading outline-none focus:border-anchor-brand transition-colors"
          />
          <textarea
            value={skillInstr}
            onChange={e => setSkillInstr(e.target.value)}
            placeholder="Instructions — what should Anchor do when this skill runs?"
            rows={4}
            className="w-full px-3 py-1.5 rounded-lg text-xs border border-anchor-border bg-anchor-canvas text-anchor-heading outline-none focus:border-anchor-brand transition-colors resize-none"
          />
          <button
            onClick={createSkill}
            disabled={skillSaving}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-anchor-brand text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {skillSaving ? 'Saving…' : 'Create skill'}
          </button>
        </div>
      </Section>

      {/* Web monitor */}
      <Section title="Web Monitor">
        <p className="text-xs text-anchor-body mb-4">
          Approved sources are fetched daily at 6am and saved as notes in your vault.
          Web comes in. Nothing goes out.
        </p>

        {/* Add source */}
        <div className="flex items-center gap-2 mb-4">
          <select
            value={urlType}
            onChange={e => setUrlType(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-xs border border-anchor-border bg-anchor-canvas text-anchor-heading outline-none"
          >
            <option value="feed">RSS Feed</option>
            <option value="url">URL</option>
          </select>
          <input
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addSource()}
            placeholder={urlType === 'feed' ? 'https://example.com/feed.rss' : 'https://example.com'}
            className="flex-1 px-3 py-1.5 rounded-lg text-xs border border-anchor-border bg-anchor-canvas text-anchor-heading outline-none focus:border-anchor-brand transition-colors"
          />
          <button
            onClick={addSource}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-anchor-brand text-white hover:opacity-90 transition-opacity"
          >
            Add
          </button>
        </div>

        {/* RSS feeds */}
        {sources.feeds.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-anchor-body uppercase tracking-wide mb-2">RSS Feeds</p>
            <SourceList sources={sources.feeds} onRemove={removeSource} />
          </div>
        )}

        {/* URLs */}
        {sources.urls.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-anchor-body uppercase tracking-wide mb-2">URLs</p>
            <SourceList sources={sources.urls} onRemove={removeSource} />
          </div>
        )}

        {sources.feeds.length === 0 && sources.urls.length === 0 && (
          <p className="text-xs text-anchor-body">No sources added yet.</p>
        )}

        <button
          onClick={runMonitorNow}
          className="mt-3 px-3 py-1.5 rounded-lg text-xs font-medium bg-anchor-sidebar border border-anchor-border text-anchor-body hover:text-anchor-heading transition-colors"
        >
          Run monitor now
        </button>
      </Section>

      {/* Reset */}
      <Section title="Reset">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4 p-3 rounded-lg bg-anchor-sidebar border border-anchor-border">
            <div>
              <p className="text-sm font-medium text-anchor-heading">Soft reset</p>
              <p className="text-xs text-anchor-body mt-0.5">Wipes memory and session, restarts onboarding. Your notes are kept.</p>
            </div>
            <button
              onClick={doReset}
              disabled={resetting}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-anchor-sidebar border border-anchor-border text-anchor-body hover:border-anchor-brand hover:text-anchor-brand transition-colors shrink-0"
            >
              Reset
            </button>
          </div>

          <div className="flex items-start justify-between gap-4 p-3 rounded-lg bg-red-50 border border-red-100">
            <div>
              <p className="text-sm font-medium text-red-700">Hard reset</p>
              <p className="text-xs text-red-500 mt-0.5">Permanently deletes your entire vault. Cannot be undone.</p>
            </div>
            <button
              onClick={doHardReset}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-red-200 text-red-600 hover:bg-red-50 transition-colors shrink-0"
            >
              Delete vault
            </button>
          </div>
        </div>
      </Section>

      {/* Feedback toast */}
      {feedback && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-anchor-heading text-white text-xs shadow-lg">
          {feedback}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-8">
      <h2 className="text-xs font-semibold text-anchor-body uppercase tracking-wide mb-3">{title}</h2>
      {children}
    </div>
  )
}

function StatusRow({ label, value, accent, mono }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-anchor-border">
      <span className="text-xs text-anchor-body">{label}</span>
      <span className={`text-xs ${accent ? 'text-green-600 font-medium' : mono ? 'font-mono text-anchor-body' : 'text-anchor-heading'}`}>
        {value}
      </span>
    </div>
  )
}

function SourceList({ sources, onRemove }) {
  return (
    <div className="space-y-1.5">
      {sources.map(url => (
        <div key={url} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-anchor-canvas border border-anchor-border">
          <span className="text-xs text-anchor-body truncate font-mono">{url}</span>
          <button
            onClick={() => onRemove(url)}
            className="text-anchor-body hover:text-anchor-danger transition-colors shrink-0"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
