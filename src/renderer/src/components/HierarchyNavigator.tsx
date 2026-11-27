/**
 * Hierarchy navigator.
 *
 * Shows the current design hierarchy as a breadcrumb (top-level → sub-block →
 * sub-sub-block …) and lets the user drill down into a selected block or drill
 * back up to the parent.
 *
 * Props:
 *   currentPath - array of { id, name } from the root design to the current block
 *   onDrillDown - called with a block id when the user drills into a block
 *   onDrillUp   - called when the user navigates one level up
 */

import { useCallback } from 'react'

interface HierarchyNode {
  id: string
  name: string
}

interface Props {
  currentPath: HierarchyNode[]
  onDrillDown: (blockId: string) => void
  onDrillUp: () => void
}

export default function HierarchyNavigator({
  currentPath,
  onDrillDown,
  onDrillUp
}: Props) {
  const isRoot = currentPath.length === 0

  const handleDrillUp = useCallback(() => {
    onDrillUp()
  }, [onDrillUp])

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line px-6 py-2.5 bg-surface-0/80 backdrop-blur">
      {isRoot ? (
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
          Top-Level Design
        </span>
      ) : (
        <>
          <button
            onClick={handleDrillUp}
            className="flex items-center gap-1 rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-[11px] text-ink-dim transition hover:border-line-bright hover:text-ink"
            aria-label="Drill up"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Up
          </button>
          <span className="px-1 text-[10px] text-ink-faint">/</span>
          {currentPath.map((node, index) => {
            const isLast = index === currentPath.length - 1
            return (
              <span key={node.id} className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (isLast) return
                    onDrillDown(node.id)
                  }}
                  disabled={isLast}
                  className={`rounded px-1.5 py-0.5 text-[11px] transition ${
                    isLast
                      ? 'text-accent font-medium'
                      : 'text-ink-dim hover:text-ink hover:underline'
                  }`}
                >
                  {node.name}
                </button>
                {index < currentPath.length - 1 && (
                  <span className="text-[10px] text-ink-faint">/</span>
                )}
              </span>
            )
          })}
        </>
      )}
    </div>
  )
}
