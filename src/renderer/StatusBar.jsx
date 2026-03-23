import React, { useState, useEffect } from 'react'

export default function StatusBar({ anchorName }) {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    window.anchor.status().then(setStatus)
    // Refresh every 60s
    const t = setInterval(() => window.anchor.status().then(setStatus), 60000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-anchor-sidebar border-t border-anchor-border text-xs text-anchor-body select-none">
      {/* Left — model + privacy */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
          llama3.2:3b
        </span>
        <span className="flex items-center gap-1 text-anchor-body">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          zero egress
        </span>
      </div>

      {/* Centre — vault stats */}
      <div className="flex items-center gap-3 text-anchor-body">
        {status && (
          <>
            <span>{status.notes} notes</span>
            <span>·</span>
            <span>{status.memoryFacts} memories</span>
          </>
        )}
      </div>

      {/* Right — vault path */}
      <div className="flex items-center gap-1 text-anchor-body opacity-60">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        <span className="truncate max-w-xs">~/anchor-vault</span>
      </div>
    </div>
  )
}
