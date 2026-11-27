import { useCallback, useEffect, useState } from 'react'

/**
 * Status bar — runs along the bottom of the work area.
 *
 * Shows the cursor position (when a canvas tab is active), the current units,
 * the zoom level, and a small error count. It's intentionally minimal: the
 * numbers it shows come from props the parent tabs feed in, so each tab owns
 * its own canvas state and the bar just reflects it.
 */

interface StatusBarProps {
  /** Current cursor X position in canvas units, when tracked. */
  cursorX?: number | null
  /** Current cursor Y position in canvas units, when tracked. */
  cursorY?: number | null
  /** Current units: 'mm' or 'in'. */
  units?: 'mm' | 'in'
  /** Current zoom as a percentage, e.g. 100. */
  zoom?: number
  /** Number of validation errors to surface. */
  errorCount?: number
  /** Sync status: online flag and pending edit count. */
  syncStatus?: { online: boolean; pendingEdits: number }
}

export default function StatusBar({
  cursorX = null,
  cursorY = null,
  units = 'mm',
  zoom = 100,
  errorCount = 0,
  syncStatus
}: StatusBarProps) {
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)

  // Track viewport dimensions so the "fit" zoom hint can be meaningful.
  const handleResize = useCallback(() => {
    setWidth(window.innerWidth)
    setHeight(window.innerHeight)
  }, [])
  useEffect(() => {
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [handleResize])

  return (
    <div className="shrink-0 border-t border-line bg-surface-0/80 backdrop-blur px-5 py-2 flex items-center justify-between gap-4 text-[11px]">
      <div className="flex items-center gap-4 text-ink-dim">
        <span className="font-mono">
          {cursorX !== null && cursorY !== null
            ? `${cursorX.toFixed(1)}, ${cursorY.toFixed(1)} ${units.toUpperCase()}`
            : '— —'}
        </span>
        <span className="w-[1px] h-3 bg-line" />
        <span className="font-mono">Zoom {zoom}%</span>
        <span className="w-[1px] h-3 bg-line" />
        <span className="font-mono text-ink-faint">
          {width} × {height} px
        </span>
      </div>

      <div className="flex items-center gap-4 text-ink-dim">
        <span
          className={`font-mono rounded-full px-1.5 py-0.5 ${
            errorCount > 0
              ? 'bg-danger/10 text-danger border border-danger/30'
              : 'bg-ok/10 text-ok border border-ok/30'
          }`}
        >
          {errorCount > 0 ? `${errorCount} error${errorCount === 1 ? '' : 's'}` : 'OK'}
        </span>
        {syncStatus !== undefined && (
          <span
            className={`font-mono rounded-full px-1.5 py-0.5 ${
              syncStatus.online
                ? 'bg-ok/10 text-ok border border-ok/30'
                : 'bg-danger/10 text-danger border border-danger/30'
            }`}
          >
            {syncStatus.online ? '● Online' : '○ Offline'}
            {syncStatus.pendingEdits > 0 ? ` · ${syncStatus.pendingEdits} pending` : ''}
          </span>
        )}
      </div>
    </div>
  )
}
