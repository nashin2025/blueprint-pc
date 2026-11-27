import { useCallback } from 'react'

export type SectionAxis = 'x' | 'y' | 'z'

const AXIS_LABEL: Record<SectionAxis, string> = { x: 'X', y: 'Y', z: 'Z' }

interface Props {
  enabled: boolean
  axis: SectionAxis
  position: number
  onToggle: (enabled: boolean) => void
  onAxisChange: (axis: SectionAxis) => void
  onPositionChange: (position: number) => void
}

export default function SectionView({
  enabled,
  axis,
  position,
  onToggle,
  onAxisChange,
  onPositionChange,
}: Props) {
  const handleToggle = useCallback(() => onToggle(!enabled), [enabled, onToggle])
  const handleAxisChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => onAxisChange(e.target.value as SectionAxis),
    [onAxisChange]
  )
  const handlePositionChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => onPositionChange(parseFloat(e.target.value)),
    [onPositionChange]
  )

  // RGB axis colours follow the universal 3D CAD convention (X=red, Y=green, Z=blue).
  const axisColor = axis === 'x' ? '#f47272' : axis === 'y' ? '#86efac' : '#93c5fd'

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Section plane</h3>
        <button
          onClick={handleToggle}
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${enabled ? 'bg-accent text-white border-transparent' : 'bg-surface-2 text-ink border border-line'}`}
        >
          {enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      <div className="space-y-2">
        <label className="label">Axis</label>
        <select
          value={axis}
          onChange={handleAxisChange}
          className="input-field w-auto md:w-32"
          disabled={!enabled}
        >
          <option value="x">X axis</option>
          <option value="y">Y axis</option>
          <option value="z">Z axis</option>
        </select>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <label className="label">Position (mm)</label>
          <span className="font-mono text-xs text-ink-dim">{position.toFixed(1)} mm</span>
        </div>
        <input
          type="range"
          min="-10"
          max="10"
          step="0.5"
          value={position}
          onChange={handlePositionChange}
          className="w-full accent-accent h-1.5 bg-surface-2 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!enabled}
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: axisColor }} />
        <span className="text-[10px] text-ink-faint">
          Cutting along {AXIS_LABEL[axis].toUpperCase()} at {position.toFixed(1)} mm
        </span>
      </div>
    </section>
  )
}
