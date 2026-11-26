import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Command palette — quick actions for power users.
 *
 * Open with ⌘K or `/`. Type to filter, arrow keys to navigate, Enter to
 * select, Escape to close. A transient overlay — it owns no state of its own,
 * it just routes intent to callbacks the parent supplies.
 */

interface Action {
  id: string
  label: string
  hint?: string
  shortcut?: string
  run: () => void
}

interface Props {
  /** Whether the palette is currently open. */
  open: boolean
  /** Close the palette. */
  onClose: () => void
  /** The actions the palette can offer. */
  actions: Action[]
}

export default function CommandPalette({ open, onClose, actions }: Props) {
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = actions.filter((a) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    const haystack = `${a.label} ${a.hint ?? ''} ${a.shortcut ?? ''}`.toLowerCase()
    return haystack.includes(q)
  })

  // Focus the input when the palette opens.
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    setQuery('')
    setHighlighted(0)
  }, [open])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted((h) => Math.min(h + 1, filtered.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted((h) => Math.max(h - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const target = filtered[highlighted]
        if (target) {
          target.run()
          onClose()
        }
        return
      }
    },
    [filtered, highlighted, onClose]
  )

  // Global keyboard listener: ⌘K or `/` opens the palette from anywhere.
  useEffect(() => {
    function onGlobalKeyDown(e: KeyboardEvent) {
      const isSlash = e.key === '/' && !e.metaKey && !e.ctrlKey
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      // Don't steal from inputs.
      const target = e.target as HTMLElement | null
      const inInput = target?.matches('input, textarea, [contenteditable]')
      if (inInput && !isSlash) return
      if (isSlash || isCmdK) {
        e.preventDefault()
        // Handled by parent via the `open` prop; this just signals intent.
        // The parent toggles `open` true and we re-open here if needed.
      }
    }
    window.addEventListener('keydown', onGlobalKeyDown)
    return () => window.removeEventListener('keydown', onGlobalKeyDown)
  }, [])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center pt-16"
      onClick={onClose}
    >
      {/* Backdrop — click outside closes. */}
      <div
        className="fixed inset-0 bg-ink/60 backdrop-blur-sm"
        onClick={(e) => e.stopPropagation()}
      />
      <div
        className="relative z-50 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card p-1 shadow-2xl animate-fade-up">
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setHighlighted(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Jump to…"
            className="input-field pb-1 pr-10"
          />
          <div className="absolute right-3 top-3 size-4 pointer-events-none">
            <span className="text-[10px] font-mono text-ink-faint">⌘K</span>
          </div>

          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-[12px] text-ink-faint">
                No matches
              </div>
            ) : (
              filtered.map((action, i) => {
                const active = i === highlighted
                return (
                  <button
                    key={action.id}
                    onClick={() => {
                      action.run()
                      onClose()
                    }}
                    onMouseEnter={() => setHighlighted(i)}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition rounded-lg ${
                      active
                        ? 'bg-accent text-white'
                        : 'text-ink hover:bg-surface-2'
                    }`}
                  >
                    <span className="font-medium">{action.label}</span>
                    {action.hint && (
                      <span className="ml-auto text-[11px] text-ink-faint">
                        {action.hint}
                      </span>
                    )}
                    {action.shortcut && (
                      <span className="ml-auto text-[10px] font-mono text-ink-faint">
                        {action.shortcut}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>

          <div className="border-t border-line/50 pt-3 px-4">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-faint">
              <span>↑↓ navigate</span>
              <span>·</span>
              <span>Enter select</span>
              <span>·</span>
              <span>Esc close</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
