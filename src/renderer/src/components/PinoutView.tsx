import { useMemo, useState } from 'react'
import { layoutPackage, type LayoutPin } from '../lib/packageLayout'

/**
 * Interactive pinout: a package diagram beside a pin table, the two linked by a
 * shared selection.
 *
 * Hover or focus a pin in either view and it highlights in both — the same
 * logical↔physical connection schematik.io draws, rebuilt on our own data and
 * design tokens. When true pad coordinates exist (a later addition) the diagram
 * becomes to-scale; until then it is an honest schematic layout, not a footprint.
 */

interface Props {
  pins: LayoutPin[]
  /** Optional part name drawn on the package body. */
  label?: string
}

export default function PinoutView({ pins, label }: Props) {
  const layout = useMemo(() => layoutPackage(pins), [pins])
  const [active, setActive] = useState<number | null>(null)

  if (pins.length === 0) {
    return <p className="text-[12.5px] text-ink-faint">No pinout for this part.</p>
  }

  const { board } = layout

  return (
    <div className="grid gap-4 lg:grid-cols-[auto_1fr] lg:items-start">
      {/* Board diagram */}
      <div className="mx-auto w-full max-w-[260px]">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Pinout diagram for ${label ?? 'this part'}, ${pins.length} pins`}
        >
          {/* Package body */}
          <rect
            x={board.x}
            y={board.y}
            width={board.w}
            height={board.h}
            rx={8}
            fill="var(--color-surface-2)"
            stroke="var(--color-line-bright)"
            strokeWidth={1.4}
          />
          {label && (
            <text
              x={board.x + board.w / 2}
              y={board.y + board.h / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={8}
              fill="var(--color-ink-faint)"
              style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}
            >
              {label.length > 18 ? label.slice(0, 17) + '…' : label}
            </text>
          )}

          {layout.pins.map((p) => {
            const isActive = active === p.index
            const dim = active !== null && !isActive
            return (
              <g
                key={p.index}
                onMouseEnter={() => setActive(p.index)}
                onMouseLeave={() => setActive(null)}
                style={{ opacity: dim ? 0.4 : 1, transition: 'opacity 150ms ease-out', cursor: 'pointer' }}
              >
                {/* Trace line from label to pad */}
                <line
                  x1={p.lineX1}
                  y1={p.lineY1}
                  x2={p.lineX2}
                  y2={p.lineY2}
                  stroke={isActive ? p.color : 'rgba(120,120,140,.35)'}
                  strokeWidth={isActive ? 1.8 : 1.2}
                />
                {/* Contact pad */}
                <circle
                  cx={p.padX}
                  cy={p.padY}
                  r={isActive ? 5.5 : 4}
                  fill={p.color}
                  stroke="var(--color-surface-0)"
                  strokeWidth={1.5}
                  style={{ transition: 'r 150ms ease-out' }}
                />
                {/* Label chip */}
                <rect
                  x={p.labelX}
                  y={p.labelY}
                  width={p.labelW}
                  height={p.labelH}
                  rx={4.5}
                  fill={isActive ? 'var(--color-surface-3)' : 'var(--color-surface-1)'}
                  stroke={isActive ? p.color : 'var(--color-line)'}
                  strokeWidth={1.2}
                />
                <text
                  x={p.labelX + p.labelW / 2}
                  y={p.labelY + p.labelH / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={9.5}
                  fill={isActive ? 'var(--color-ink)' : 'var(--color-ink-dim)'}
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {(pins[p.index].label || `#${p.index + 1}`).slice(0, 12)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Pin table */}
      <div className="min-w-0 overflow-hidden rounded-lg border border-line">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-surface-2/60">
              <th className="px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-widest text-ink-faint">
                Pin
              </th>
              <th className="px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-widest text-ink-faint">
                Type
              </th>
              <th className="px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-widest text-ink-faint">
                Function
              </th>
            </tr>
          </thead>
          <tbody>
            {pins.map((pin, i) => {
              const cat = layout.pins[i]
              const isActive = active === i
              const dim = active !== null && !isActive
              return (
                <tr
                  key={i}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  className="border-b border-line/50 last:border-0"
                  style={{
                    backgroundColor: isActive ? 'var(--color-surface-2)' : 'transparent',
                    opacity: dim ? 0.5 : 1,
                    transition: 'background-color 150ms ease-out, opacity 150ms ease-out'
                  }}
                >
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: cat.color }}
                        aria-hidden
                      />
                      <span className="font-mono text-[11.5px] text-ink">
                        {pin.label || `#${i + 1}`}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                    {pin.type ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-ink-dim">{pin.function ?? pin.voltage ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}