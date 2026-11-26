import { useMemo, useState } from 'react'
import type { Component, Connection, DesignSpec } from '@shared/types'
import { layoutWiring, WIRE_COLORS, type LaidOutNode } from '../lib/wiringLayout'

interface Props {
  spec: DesignSpec
  /** Highlights the wires touching this component. */
  focusComponentId?: string | null
  onFocusComponent?: (id: string | null) => void
  /** Dims every wire kind except this one. */
  filterKind?: Connection['kind'] | null
}

/**
 * Wiring canvas. Pure SVG from the layout module, so the on-screen diagram and
 * the exported SVG come from one source and cannot drift apart.
 *
 * Parts are drawn as boards rather than as identical grey boxes. A reader scans a
 * wiring diagram to answer "what connects to what", and that is faster when the
 * ESP32 looks like a dev board with pin headers, the OLED looks like a display,
 * and the breadboard looks like a breadboard.
 */

const PIN_DOT = 3.1

export default function WiringDiagram({ spec, focusComponentId, onFocusComponent, filterKind }: Props) {
  const layout = useMemo(() => layoutWiring(spec.components, spec.connections), [spec])
  const [hovered, setHovered] = useState<string | null>(null)

  const activeId = hovered ?? focusComponentId ?? null

  function isDimmed(wireNodeIds: string[]): boolean {
    if (!activeId) return false
    return !wireNodeIds.includes(activeId)
  }

  return (
    <div className="h-full w-full overflow-auto bg-blueprint-grid p-6">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="mx-auto block"
        style={{ minWidth: layout.width, minHeight: layout.height }}
      >
        <defs>
          <filter id="wireGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Wires first, so component boards sit on top of them. */}
        <g>
          {layout.wires.map((w, i) => {
            const dimmed = isDimmed([w.from.nodeId, w.to.nodeId])
            const kindFiltered = filterKind !== null && filterKind !== undefined && w.kind !== filterKind
            return (
              <path
                key={i}
                d={w.d}
                fill="none"
                stroke={WIRE_COLORS[w.kind]}
                strokeWidth={dimmed || kindFiltered ? 1.2 : 1.9}
                strokeOpacity={dimmed || kindFiltered ? 0.12 : 0.9}
                style={{ transition: 'stroke-opacity 140ms ease, stroke-width 140ms ease' }}
              />
            )
          })}
        </g>

        {/* Component boards */}
        <g>
          {layout.nodes.map((n) => (
            <BoardNode
              key={n.component.id}
              node={n}
              active={activeId === n.component.id}
              dimmed={activeId !== null && activeId !== n.component.id}
              onHover={setHovered}
              onSelect={() => onFocusComponent?.(activeId === n.component.id ? null : n.component.id)}
            />
          ))}
        </g>

        {/* Net labels on the wire midpoints */}
        {layout.wires.map((w, i) => {
          if (!w.net) return null
          const dimmed = isDimmed([w.from.nodeId, w.to.nodeId])
          if (dimmed) return null
          return <NetLabel key={i} d={w.d} text={w.net} color={WIRE_COLORS[w.kind]} />
        })}
      </svg>

      {layout.unresolved.length > 0 && (
        <p className="mx-auto mt-4 max-w-xl text-[11px] leading-relaxed text-warn">
          {layout.unresolved.length} connection
          {layout.unresolved.length === 1 ? '' : 's'} could not be drawn:{' '}
          {layout.unresolved.slice(0, 3).join('; ')}
          {layout.unresolved.length > 3 ? '; …' : ''}
        </p>
      )}
    </div>
  )
}

/** One component, drawn as a board. */
function BoardNode({
  node,
  active,
  dimmed,
  onHover,
  onSelect
}: {
  node: LaidOutNode
  active: boolean
  dimmed: boolean
  onHover: (id: string | null) => void
  onSelect: () => void
}) {
  const c = node.component
  const accent = active ? 'var(--color-accent)' : 'var(--color-line)'
  const art = categoryArt(c)

  return (
    <g
      onMouseEnter={() => onHover(c.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onSelect}
      style={{ cursor: 'pointer', opacity: dimmed ? 0.45 : 1, transition: 'opacity 140ms ease' }}
    >
      {/* Board body */}
      <rect
        x={node.x}
        y={node.y}
        width={node.w}
        height={node.h}
        rx={9}
        fill="#12151a"
        stroke={accent}
        strokeWidth={active ? 1.6 : 1}
      />

      {/* Header strip, like the silkscreen band on a real module */}
      <path
        d={headerPath(node)}
        fill="#171a21"
        stroke={accent}
        strokeOpacity={active ? 0.55 : 0.3}
        strokeWidth={1}
      />

      {/* Mounting holes */}
      {mountingHoles(node).map((h, i) => (
        <circle key={i} cx={h.x} cy={h.y} r={2.6} fill="#0b0d11" stroke="var(--color-line)" strokeWidth={0.9} />
      ))}

      <text
        x={node.x + 13}
        y={node.y + 21}
        fontSize="12.5"
        fontWeight="600"
        fill="var(--color-ink)"
        style={{ pointerEvents: 'none' }}
      >
        {truncate(c.name, 24)}
      </text>
      <text
        x={node.x + 13}
        y={node.y + 34}
        fontSize="8.5"
        fill="var(--color-ink-faint)"
        fontFamily="var(--font-mono)"
        style={{ pointerEvents: 'none' }}
      >
        {truncate(c.partName ?? c.category, 30)}
        {c.quantity > 1 ? `  x${c.quantity}` : ''}
      </text>

      {/* Category art in the body */}
      <g style={{ pointerEvents: 'none' }}>{art}</g>

      {/* Pin rails and dots on both edges */}
      {node.pins.map((p) => (
        <g key={p.name} style={{ pointerEvents: 'none' }}>
          <circle cx={p.x} cy={p.y} r={PIN_DOT} fill="#0d0d10" stroke="var(--color-line-bright)" strokeWidth={1.1} />
          <circle cx={p.rightX} cy={p.y} r={PIN_DOT} fill="#0d0d10" stroke="var(--color-line-bright)" strokeWidth={1.1} />
          <text
            x={node.x + 9}
            y={p.y - 4.5}
            fontSize="8.5"
            fill="var(--color-ink-dim)"
            fontFamily="var(--font-mono)"
          >
            {truncate(p.name, 14)}
          </text>
        </g>
      ))}
    </g>
  )
}

/** Rounded top band across the board. */
function headerPath(node: LaidOutNode): string {
  const { x, y, w } = node
  const h = 42
  const r = 9
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + w - r} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `L ${x + w} ${y + h}`,
    'Z'
  ].join(' ')
}

function mountingHoles(node: LaidOutNode): { x: number; y: number }[] {
  const inset = 9
  return [
    { x: node.x + inset, y: node.y + inset },
    { x: node.x + node.w - inset, y: node.y + inset },
    { x: node.x + inset, y: node.y + node.h - inset },
    { x: node.x + node.w - inset, y: node.y + node.h - inset }
  ]
}

/**
 * The drawing inside a board's body.
 *
 * Deliberately simple geometry: enough shape to recognise the kind of part at a
 * glance, not so much that it competes with the wires.
 */
function categoryArt(c: Component): React.ReactNode {
  const category = (c.category ?? '').toLowerCase()
  const cx = 0
  const cy = 0

  if (category.includes('display')) {
    return (
      <g transform="translate(-38, -14)">
        <rect x={0} y={0} width={76} height={46} rx={3} fill="#0b1a2a" stroke="#2b4a6b" strokeWidth={1} />
        <rect x={6} y={6} width={64} height={30} rx={1.5} fill="#0f2740" stroke="#3a6f9e" strokeWidth={0.8} />
        <rect x={0} y={40} width={76} height={6} rx={2} fill="#1a1d24" />
      </g>
    )
  }

  if (category.includes('micro') || category.includes('controller')) {
    return (
      <g transform="translate(-26, -22)">
        <rect x={0} y={0} width={52} height={44} rx={3} fill="#191d24" stroke="#2f3542" strokeWidth={1} />
        <rect x={13} y={11} width={26} height={22} rx={2} fill="#0e1116" stroke="#39404f" strokeWidth={0.9} />
        {[4, 12, 20, 28, 36, 44].map((x) => (
          <rect key={x} x={x} y={-3} width={4} height={4} fill="#3a4150" />
        ))}
        {[4, 12, 20, 28, 36, 44].map((x) => (
          <rect key={`b${x}`} x={x} y={43} width={4} height={4} fill="#3a4150" />
        ))}
      </g>
    )
  }

  if (category.includes('sensor') || category.includes('actuator')) {
    return (
      <g transform="translate(-20, -16)">
        <circle cx={20} cy={16} r={16} fill="#1a1e26" stroke="#39404f" strokeWidth={1} />
        <circle cx={20} cy={16} r={7} fill="#0d1015" stroke="#4a5364" strokeWidth={0.9} />
      </g>
    )
  }

  if (category.includes('power') || category.includes('battery')) {
    return (
      <g transform="translate(-24, -13)">
        <rect x={0} y={0} width={44} height={26} rx={3} fill="#1c2130" stroke="#3b455c" strokeWidth={1} />
        <rect x={44} y={8} width={5} height={10} rx={1.5} fill="#3b455c" />
        <rect x={4} y={4} width={36} height={18} rx={1.5} fill="#141a26" />
      </g>
    )
  }

  if (category.includes('connector')) {
    // A breadboard reads as a grid of tie points.
    const dots = []
    for (let r = 0; r < 3; r++) {
      for (let col = 0; col < 9; col++) {
        dots.push(<circle key={`${r}-${col}`} cx={-32 + col * 8} cy={-8 + r * 8} r={1.2} fill="#39404f" />)
      }
    }
    return <g>{dots}</g>
  }

  if (category.includes('passive')) {
    return (
      <g transform="translate(-16, -6)">
        <rect x={0} y={0} width={32} height={12} rx={6} fill="#241f1a" stroke="#4a3c2e" strokeWidth={1} />
      </g>
    )
  }

  if (category.includes('structure')) {
    return (
      <rect
        x={cx - 34}
        y={cy - 12}
        width={68}
        height={28}
        rx={4}
        fill="none"
        stroke="#39404f"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
    )
  }

  return null
}

/** Puts a label at the midpoint of a cubic path by measuring it in the DOM-free way. */
function NetLabel({ d, text, color }: { d: string; text: string; color: string }) {
  const point = useMemo(() => midpointOfCubic(d), [d])
  if (!point) return null
  const label = truncate(text, 12)
  const width = label.length * 6.2 + 12
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect
        x={point.x - width / 2}
        y={point.y - 8}
        width={width}
        height={15}
        rx="7.5"
        fill="#0d0d10"
        stroke={color}
        strokeOpacity="0.35"
        strokeWidth="1"
      />
      <text
        x={point.x}
        y={point.y + 3}
        fontSize="9.5"
        textAnchor="middle"
        fill={color}
        fontFamily="var(--font-mono)"
      >
        {label}
      </text>
    </g>
  )
}

/**
 * Midpoint of "M x1 y1 C x1b y1, x2b y2, x2 y2" at t=0.5. The layout module
 * always emits that exact form, so parsing it here is safe and avoids keeping
 * the control points around just for a label.
 */
function midpointOfCubic(d: string): { x: number; y: number } | null {
  const nums = d.match(/-?\d+(\.\d+)?/g)
  if (!nums || nums.length < 8) return null
  // Emitted as: M x1 y1 C c1x y1, c2x y2, x2 y2
  const x1 = Number(nums[0])
  const y1 = Number(nums[1])
  const c1x = Number(nums[2])
  const c2x = Number(nums[4])
  const c2y = Number(nums[5])
  const x2 = Number(nums[6])
  const y2 = Number(nums[7])
  if ([x1, y1, c1x, c2x, c2y, x2, y2].some((n) => Number.isNaN(n))) return null
  const t = 0.5
  const mt = 1 - t
  const x = mt * mt * mt * x1 + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * x2
  const y = mt * mt * mt * y1 + 3 * mt * mt * t * y1 + 3 * mt * t * t * c2y + t * t * t * y2
  return { x, y }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}