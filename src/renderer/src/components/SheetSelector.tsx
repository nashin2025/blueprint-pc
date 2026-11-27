import { useState } from 'react'
import type { Sheet } from '@shared/types'
import { PlusIcon, TrashIcon, EditIcon, ChevronIcon } from '../components/Icons'

interface Props {
  sheets: Sheet[]
  activeSheetId: string | null
  onSheetChange: (sheetId: string) => void
  onAddSheet: (name: string) => void
  onRenameSheet: (sheetId: string, name: string) => void
  onDeleteSheet: (sheetId: string) => void
  onReorderSheets: (sheetIds: string[]) => void
}

/**
 * Toolbar for managing sheets in a multi-sheet design.
 *
 * Shows a dropdown to switch the active sheet, plus add / rename / delete and
 * up / down reorder controls for the active sheet. All mutations are reported
 * back through callbacks so the owner (ProjectView) persists the spec.
 */
export default function SheetSelector({
  sheets,
  activeSheetId,
  onSheetChange,
  onAddSheet,
  onRenameSheet,
  onDeleteSheet,
  onReorderSheets
}: Props) {
  const [renameMode, setRenameMode] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  const activeSheet = sheets.find((s) => s.id === activeSheetId) ?? null
  const activeIndex = sheets.findIndex((s) => s.id === activeSheetId)

  function moveSheet(direction: 'up' | 'down') {
    if (activeIndex === -1) return
    const target = direction === 'up' ? activeIndex - 1 : activeIndex + 1
    if (target < 0 || target >= sheets.length) return
    const next = [...sheets]
    ;[next[activeIndex], next[target]] = [next[target], next[activeIndex]]
    onReorderSheets(next.map((s) => s.id))
  }

  function handleAdd() {
    const name = prompt('Sheet name', `Sheet ${sheets.length + 1}`)
    if (!name) return
    onAddSheet(name.trim())
  }

  function handleRename() {
    if (!activeSheet) return
    setRenameValue(activeSheet.name)
    setRenameMode(true)
  }

  function handleSaveRename() {
    if (!activeSheet) return
    const name = renameValue.trim()
    if (!name || name === activeSheet.name) {
      setRenameMode(false)
      return
    }
    onRenameSheet(activeSheet.id, name)
    setRenameMode(false)
  }

  function handleDelete() {
    if (!activeSheet) return
    if (
      !window.confirm(`Delete sheet "${activeSheet.name}"? Its connections and ports will be removed.`)
    ) {
      return
    }
    onDeleteSheet(activeSheet.id)
  }

  if (sheets.length === 0) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-6 py-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Sheets</span>
        <button
          onClick={handleAdd}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-[13px] text-ink-dim transition hover:border-line-bright hover:text-ink"
        >
          <PlusIcon size={13} />
          Add sheet
        </button>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Sheets</span>
        <select
          value={activeSheetId ?? ''}
          onChange={(e) => onSheetChange(e.target.value)}
          className="rounded border border-line bg-surface-1 px-2.5 py-1.5 text-[13px] text-ink transition focus:outline-none focus:border-accent"
        >
          {sheets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {activeSheet && (
          <>
            <button
              onClick={() => moveSheet('up')}
              disabled={activeIndex <= 0}
              className="rounded-md border border-line bg-surface-1 px-2 py-1.5 text-[11px] text-ink-dim transition disabled:opacity-50 disabled:pointer-events-none"
              title="Move sheet up"
            >
              <ChevronIcon size={11} className="-rotate-90" />
            </button>
            <button
              onClick={() => moveSheet('down')}
              disabled={activeIndex >= sheets.length - 1}
              className="rounded-md border border-line bg-surface-1 px-2 py-1.5 text-[11px] text-ink-dim transition disabled:opacity-50 disabled:pointer-events-none"
              title="Move sheet down"
            >
              <ChevronIcon size={11} className="rotate-90" />
            </button>
            {renameMode ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveRename()
                    if (e.key === 'Escape') setRenameMode(false)
                  }}
                  className="rounded border border-line bg-surface-1 px-2 py-1 text-[12px] text-ink focus:outline-none focus:border-accent w-32"
                />
                <button
                  onClick={handleSaveRename}
                  className="btn-secondary"
                >
                  Save
                </button>
                <button
                  onClick={() => setRenameMode(false)}
                  className="btn-ghost p-1"
                  title="Cancel"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleRename}
                  className="rounded-md border border-line bg-surface-1 px-2 py-1.5 text-[11px] text-ink-dim transition hover:bg-surface-2 hover:text-ink"
                  title="Rename sheet"
                >
                  <EditIcon size={12} />
                </button>
                <button
                  onClick={handleDelete}
                  className="rounded-md border border-line bg-surface-1 px-2 py-1.5 text-[11px] text-ink-dim transition hover:bg-danger/5 hover:text-danger"
                  title="Delete sheet"
                >
                  <TrashIcon size={12} />
                </button>
              </div>
            )}
            <button
              onClick={handleAdd}
              className="rounded-md border border-line bg-surface-1 px-2 py-1.5 text-[11px] text-ink-dim transition hover:bg-surface-2 hover:text-ink"
              title="Add sheet"
            >
              <PlusIcon size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
