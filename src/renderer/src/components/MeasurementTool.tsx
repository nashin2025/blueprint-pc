import { useCallback } from 'react'

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Euclidean distance between two 3D points, in scene units (mm). */
export function measureDistance3D(a: Vec3, b: Vec3): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

interface Props {
  enabled: boolean
  onToggle: (enabled: boolean) => void
  point1: Vec3 | null
  point2: Vec3 | null
  distance: number | null
  onClear: () => void
}

export default function MeasurementTool({ enabled, onToggle, point1, point2, distance, onClear }: Props) {
  const phase = point1 ? (point2 ? 'second' : 'first') : 'idle'

  const handleToggle = useCallback(() => onToggle(!enabled), [enabled, onToggle])
  const handleClear = useCallback(() => onClear(), [onClear])

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Measure distance</h3>
        <button
          onClick={handleToggle}
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${enabled ? 'bg-accent text-white border-transparent' : 'bg-surface-2 text-ink border border-line'}`}
        >
          {enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      <p className="text-[11px] text-ink-faint">
        {!enabled
          ? 'Turn on measurement mode, then click two points in the 3D view.'
          : phase === 'idle'
          ? 'Click the first point in the 3D view.'
          : phase === 'first'
          ? 'Click the second point.'
          : 'Two points measured. Click in the view to start a new measurement.'}
      </p>

      {distance !== null && (
        <div className="flex items-center gap-2 pt-1">
          <span className="font-mono text-sm">{distance.toFixed(2)} mm</span>
          <button
            onClick={handleClear}
            className="rounded px-2 py-0.5 text-[10px] text-ink-faint hover:bg-surface-2 transition"
          >
            Clear
          </button>
        </div>
      )}
    </section>
  )
}
