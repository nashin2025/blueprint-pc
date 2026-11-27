import { useCallback } from 'react'

export type ClearanceClass = 'clear' | 'tight' | 'violation'

/** Classify a pairwise component distance against a clearance threshold. */
export function classifyClearance(distance: number, threshold: number): ClearanceClass {
  if (distance < threshold * 0.5) return 'violation'
  if (distance < threshold) return 'tight'
  return 'clear'
}

const CLASS_HEX: Record<ClearanceClass, string> = {
  clear: '#46c79a', // --color-ok
  tight: '#e0a34a', // --color-warn
  violation: '#e5544b', // --color-danger
}

interface Props {
  enabled: boolean
  onToggle: (enabled: boolean) => void
  threshold: number
  onThresholdChange: (threshold: number) => void
  onCheck: (threshold: number) => void
  violationCount: number
}

export default function ClearanceHeatmap({
  enabled,
  onToggle,
  threshold,
  onThresholdChange,
  onCheck,
  violationCount,
}: Props) {
  const handleToggle = useCallback(() => onToggle(!enabled), [enabled, onToggle])
  const handleThresholdChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseFloat(e.target.value)
      if (!Number.isFinite(value) || value < 0) return
      onThresholdChange(value)
      onCheck(value)
    },
    [onThresholdChange, onCheck]
  )

  const LEGEND: Array<{ cls: ClearanceClass; label: string }> = [
    { cls: 'clear', label: 'Clear' },
    { cls: 'tight', label: 'Tight' },
    { cls: 'violation', label: 'Violation' },
  ]

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Clearance heatmap</h3>
        <button
          onClick={handleToggle}
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${enabled ? 'bg-accent text-white border-transparent' : 'bg-surface-2 text-ink border border-line'}`}
        >
          {enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <label className="label">Clearance threshold (mm)</label>
          <span className="font-mono text-xs text-ink-dim">{threshold.toFixed(1)} mm</span>
        </div>
        <input
          type="number"
          min="0"
          step="0.1"
          value={threshold}
          onChange={handleThresholdChange}
          className="input-field w-auto md:w-32"
          disabled={!enabled}
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <span className="text-[10px] text-ink-faint">Violations: {violationCount}</span>
        <div className="flex gap-1 ml-2">
          {LEGEND.map(({ cls, label }) => (
            <span key={cls} className="flex items-center gap-1 text-[10px]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CLASS_HEX[cls] }} />
              <span className="text-ink-dim">{label}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
