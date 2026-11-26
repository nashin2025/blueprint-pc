import type { Component, Connection } from '@shared/types'

/**
 * Layout for the wiring diagram.
 *
 * Deliberately not a general graph layout engine: hardware builds read best as
 * power on the left, the controller in the middle, peripherals on the right.
 * We column by category, stack inside a column, and connect pins edge to edge.
 */

const COLUMN_BY_CATEGORY: Record<string, number> = {
  power: 0,
  battery: 0,
  micro: 1,
  microcontroller: 1,
  computer: 1,
  controller: 1
}

const COLUMN_WIDTH = 230
const COLUMN_GAP = 90
const PADDING = 32
const HEADER_H = 46
const PIN_H = 24
const MIN_PINS = 3

function columnOf(category: string): number {
  return COLUMN_BY_CATEGORY[category.trim().toLowerCase()] ?? 2
}

export interface PinPoint {
  /** Pin name as authored by the design. */
  name: string
  /** Left-edge dot. */
  x: number
  y: number
  /** Right-edge dot, at the same height, so a wire always lands on a pin. */
  rightX: number
}

export interface LaidOutNode {
  component: Component
  x: number
  y: number
  w: number
  h: number
  pins: PinPoint[]
}

export interface LaidOutWire {
  d: string
  kind: Connection['kind']
  net?: string
  label?: string
  from: { nodeId: string; pin: string }
  to: { nodeId: string; pin: string }
}

export interface WiringLayout {
  nodes: LaidOutNode[]
  wires: LaidOutWire[]
  /** Connections that could not be drawn, with the reason. Shown, never hidden. */
  unresolved: string[]
  width: number
  height: number
}

function boxHeight(component: Component): number {
  const pinCount = Math.max(component.pins.length, MIN_PINS)
  return HEADER_H + pinCount * PIN_H + 12
}

/**
 * Pin dot positions.
 *
 * Every pin gets a dot on *both* side edges at the same height, like a
 * through-hole header seen from above. This matters for correctness, not just
 * looks: a wire leaves from whichever edge faces its destination, so if pins
 * were only dotted on the left, wires heading right would start from a bare
 * edge with nothing under them.
 */
function pinPoints(node: Omit<LaidOutNode, 'pins'>, component: Component): PinPoint[] {
  const pinCount = Math.max(component.pins.length, MIN_PINS)
  const top = node.y + HEADER_H
  const usable = node.h - HEADER_H - 12
  const step = pinCount > 1 ? usable / (pinCount - 1) : 0
  return component.pins.map((name, i) => ({
    name,
    x: node.x,
    y: pinCount === 1 ? top + usable / 2 : top + i * step,
    rightX: node.x + node.w
  }))
}

/** Orthogonal-ish cubic path between two points, bowing out horizontally. */
function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1)
  const bow = Math.max(40, Math.min(dx * 0.5, 160))
  const dir = x2 >= x1 ? 1 : -1
  return `M ${x1} ${y1} C ${x1 + bow * dir} ${y1}, ${x2 - bow * dir} ${y2}, ${x2} ${y2}`
}

export function layoutWiring(components: Component[], connections: Connection[]): WiringLayout {
  const columns = new Map<number, Component[]>()
  for (const c of components) {
    const col = columnOf(c.category)
    const bucket = columns.get(col) ?? []
    bucket.push(c)
    columns.set(col, bucket)
  }

  const nodes: LaidOutNode[] = []
  const byId = new Map<string, LaidOutNode>()
  let maxRows = 0

  const sortedColumns = [...columns.entries()].sort((a, b) => a[0] - b[0])

  for (const [colIndex, comps] of sortedColumns) {
    // Taller boxes first inside a column keeps the vertical rhythm even.
    const ordered = [...comps].sort((a, b) => boxHeight(b) - boxHeight(a))
    let y = PADDING
    const x = PADDING + colIndex * (COLUMN_WIDTH + COLUMN_GAP)

    for (const component of ordered) {
      const h = boxHeight(component)
      const base = { component, x, y, w: COLUMN_WIDTH, h }
      const node: LaidOutNode = { ...base, pins: pinPoints(base, component) }
      nodes.push(node)
      byId.set(component.id, node)
      y += h + 26
    }
    maxRows = Math.max(maxRows, y)
  }

  const wires: LaidOutWire[] = []
  const unresolved: string[] = []

  for (const conn of connections) {
    const from = byId.get(conn.from.componentId)
    const to = byId.get(conn.to.componentId)
    if (!from || !to) {
      unresolved.push(`${conn.from.componentId} -> ${conn.to.componentId}: unknown component`)
      continue
    }

    const fromPin = from.pins.find((p) => p.name.toLowerCase() === conn.from.pin.toLowerCase())
    const toPin = to.pins.find((p) => p.name.toLowerCase() === conn.to.pin.toLowerCase())

    // A wire to a pin the part does not have is not drawn at all. Falling back
    // to the first pin would draw a confident line to the wrong place, which is
    // worse than a missing line.
    if (!fromPin || !toPin) {
      const which = !fromPin ? conn.from.pin : conn.to.pin
      unresolved.push(`${which}: not a pin on that part`)
      continue
    }

    // Leave from the edge facing the destination, and land on the matching dot
    // on the far side. Both dots exist, so the line always terminates on a pin.
    const goingRight = to.x >= from.x
    const x1 = goingRight ? fromPin.rightX : fromPin.x
    const x2 = goingRight ? toPin.x : toPin.rightX

    wires.push({
      d: wirePath(x1, fromPin.y, x2, toPin.y),
      kind: conn.kind,
      net: conn.net,
      label: conn.label,
      from: { nodeId: conn.from.componentId, pin: conn.from.pin },
      to: { nodeId: conn.to.componentId, pin: conn.to.pin }
    })
  }

  const width = Math.max(0, ...nodes.map((n) => n.x + n.w)) + PADDING
  const height = Math.max(maxRows, 260)

  return { nodes, wires, unresolved, width, height }
}

export const WIRE_COLORS: Record<Connection['kind'], string> = {
  power: 'var(--color-wire-power)',
  ground: 'var(--color-wire-ground)',
  signal: 'var(--color-wire-signal)',
  data: 'var(--color-wire-data)'
}

export const WIRE_LABELS: Record<Connection['kind'], string> = {
  power: 'Power',
  ground: 'Ground',
  signal: 'Signal',
  data: 'Data'
}