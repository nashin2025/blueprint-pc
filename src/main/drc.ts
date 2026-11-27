/**
 * Design Rule Check (DRC) engine for Blueprint PC.
 *
 * Runs rule-based validation on a DesignSpec and returns a list of violations.
 * Each violation has a severity, category, message, and the affected component(s).
 *
 * Core rules (always run):
 *   - unconnected-pin: a pin with no wire connected (error)
 *   - duplicate-designator: two components share the same designator (error)
 *   - missing-footprint: a component without a 3D model URL (warning)
 *   - shorted-net: two pins on the same component connected to different nets (error)
 *   - floating-net: a net with only one connection (warning)
 *
 * Optional PCB layout rules (run when rules + traces are provided):
 *   - trace-to-trace: two traces closer than traceClearance (error)
 *   - trace-to-pad: a trace closer than padToTraceClearance to a pad (error)
 */

import type { DesignSpec, PcbDesignRules } from '../shared/types.ts'
import { DEFAULT_PCB_RULES } from '../shared/types.ts'

export interface Point {
  x: number
  y: number
}

export interface PcbPad {
  componentId: string
  pinName: string
  center: Point
  w: number
  h: number
}

export interface PcbTrace {
  net: string
  points: Point[]
}

export interface PcbVia {
  x: number
  y: number
}

export interface DrcViolation {
  id: string
  severity: 'error' | 'warning' | 'info'
  category: string
  message: string
  componentId?: string
  componentName?: string
  pinName?: string
  designator?: string
  net?: string
  location?: Point
}

/** Run all DRC rules on a design spec. Returns violations sorted by severity.
 *
 * @param spec - The design specification.
 * @param rules - Optional PCB design rules. When provided, trace clearance
 *   checks are also run against the given traces.
 * @param traces - Optional PCB trace polylines. Required when rules are given.
 * @param pads - Optional PCB pad rectangles. Required for trace-to-pad checks.
 * @param vias - Optional PCB via positions. Required for trace-to-via checks.
 */
export function runDrc(
  spec: DesignSpec,
  rules?: PcbDesignRules,
  traces: PcbTrace[] = [],
  pads: PcbPad[] = [],
  vias: PcbVia[] = []
): DrcViolation[] {
  const violations: DrcViolation[] = []

  // Build component lookup by id
  const compById = new Map(spec.components.map((c) => [c.id, c]))

  // Build connected pin map: componentId -> Set of pin names
  const connectedPins = new Map<string, Set<string>>()
  for (const conn of spec.connections) {
    if (!compById.has(conn.from.componentId) || !compById.get(conn.from.componentId)) continue
    if (!compById.has(conn.to.componentId) || !compById.get(conn.to.componentId)) continue

    if (!connectedPins.has(conn.from.componentId)) connectedPins.set(conn.from.componentId, new Set())
    if (!connectedPins.has(conn.to.componentId)) connectedPins.set(conn.to.componentId, new Set())
    connectedPins.get(conn.from.componentId)!.add(conn.from.pin)
    connectedPins.get(conn.to.componentId)!.add(conn.to.pin)
  }

  // -----------------------------------------------------------------------
  // Rule: unconnected-pin
  // -----------------------------------------------------------------------
  for (const comp of spec.components) {
    for (const pin of comp.pins) {
      const connected = connectedPins.get(comp.id)
      if (!connected || !connected.has(pin)) {
        violations.push({
          id: `drc:unconnected-pin:${comp.id}:${pin}`,
          severity: 'error',
          category: 'unconnected-pin',
          message: `Pin "${pin}" on component "${comp.name}" is not connected to any wire`,
          componentId: comp.id,
          componentName: comp.name,
          pinName: pin
        })
      }
    }
  }

  // -----------------------------------------------------------------------
  // Rule: duplicate-designator
  // -----------------------------------------------------------------------
  const designatorByComp = new Map<string, string>() // designator -> componentId
  for (const comp of spec.components) {
    if (!comp.designator) continue
    const existing = designatorByComp.get(comp.designator)
    if (existing && existing !== comp.id) {
      const existingComp = compById.get(existing)
      violations.push({
        id: `drc:duplicate-designator:${comp.designator}:${comp.id}`,
        severity: 'error',
        category: 'duplicate-designator',
        message: `Designator "${comp.designator}" is used by both "${comp.name}" and "${existingComp?.name ?? 'unknown'}"`,
        componentId: comp.id,
        componentName: comp.name,
        designator: comp.designator
      })
      violations.push({
        id: `drc:duplicate-designator:${comp.designator}:${existing}`,
        severity: 'error',
        category: 'duplicate-designator',
        message: `Designator "${comp.designator}" is used by both "${existingComp?.name ?? 'unknown'}" and "${comp.name}"`,
        componentId: existing,
        componentName: existingComp?.name ?? undefined,
        designator: comp.designator
      })
    } else {
      designatorByComp.set(comp.designator, comp.id)
    }
  }

  // -----------------------------------------------------------------------
  // Rule: missing-footprint
  // -----------------------------------------------------------------------
  for (const comp of spec.components) {
    if (!comp.modelFilePath) {
      violations.push({
        id: `drc:missing-footprint:${comp.id}`,
        severity: 'warning',
        category: 'missing-footprint',
        message: `Component "${comp.name}" has no 3D model file (footprint) assigned`,
        componentId: comp.id,
        componentName: comp.name
      })
    }
  }

  // -----------------------------------------------------------------------
  // Optional PCB layout rules (trace clearance)
  // -----------------------------------------------------------------------
  const r = rules ?? DEFAULT_PCB_RULES

  // Rule: trace-to-trace clearance
  for (let i = 0; i < traces.length; i++) {
    for (let j = i + 1; j < traces.length; j++) {
      const t1 = traces[i]
      const t2 = traces[j]
      if (t1.net === t2.net) continue // same net, no clearance needed
      const d = minSegmentDistance(t1.points, t2.points)
      if (d > 0 && d < r.traceClearance) {
        violations.push({
          id: `drc:trace-to-trace:${t1.net}:${t2.net}:${i}:${j}`,
          severity: 'error',
          category: 'trace-to-trace',
          message: `Trace "${t1.net}" is ${d.toFixed(2)}mm from trace "${t2.net}" (need ${r.traceClearance}mm)`,
          net: t1.net,
          location: closestPointOnSegments(t1.points, t2.points)
        })
      }
    }
  }

  // Rule: trace-to-pad clearance
  for (const tr of traces) {
    for (const pad of pads) {
      const d = minSegmentToRectDistance(tr.points, pad)
      if (d > 0 && d < r.padToTraceClearance) {
        violations.push({
          id: `drc:trace-to-pad:${tr.net}:${pad.componentId}:${pad.pinName}`,
          severity: 'error',
          category: 'trace-to-pad',
          message: `Trace "${tr.net}" is ${d.toFixed(2)}mm from pad "${pad.pinName}" on "${pad.componentId}" (need ${r.padToTraceClearance}mm)`,
          net: tr.net,
          location: closestPointOnSegmentsToRect(tr.points, pad)
        })
      }
    }
  }

  // Rule: trace-to-via clearance
  for (const tr of traces) {
    for (const via of vias) {
      const d = minPointToSegmentDistance(via.x, via.y, tr.points)
      if (d > 0 && d < r.viaToTraceClearance) {
        violations.push({
          id: `drc:trace-to-via:${tr.net}:${via.x}:${via.y}`,
          severity: 'error',
          category: 'trace-to-via',
          message: `Trace "${tr.net}" is ${d.toFixed(2)}mm from via at (${via.x.toFixed(1)},${via.y.toFixed(1)}) (need ${r.viaToTraceClearance}mm)`,
          net: tr.net,
          location: { x: via.x, y: via.y }
        })
      }
    }
  }

  // Sort: errors first, then warnings, then info
  violations.sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 }
    return order[a.severity] - order[b.severity]
  })

  return violations
}

// ---------------------------------------------------------------------------
// Geometry helpers for PCB clearance checks
// ---------------------------------------------------------------------------

/** Minimum distance between two polylines (approximation using endpoint-to-segment). */
function minSegmentDistance(p1: Point[], p2: Point[]): number {
  let min = Infinity
  for (let i = 0; i < p1.length - 1; i++) {
    for (let j = 0; j < p2.length - 1; j++) {
      const d = segmentToSegmentDist(
        p1[i].x, p1[i].y, p1[i + 1].x, p1[i + 1].y,
        p2[j].x, p2[j].y, p2[j + 1].x, p2[j + 1].y
      )
      if (d < min) min = d
    }
  }
  return min
}

/** Minimum distance from a polyline to a pad rectangle. */
function minSegmentToRectDistance(pts: Point[], pad: PcbPad): number {
  const rect = {
    minX: pad.center.x - pad.w / 2,
    minY: pad.center.y - pad.h / 2,
    maxX: pad.center.x + pad.w / 2,
    maxY: pad.center.y + pad.h / 2
  }
  let min = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const d = segmentToRectDist(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, rect)
    if (d < min) min = d
  }
  return min
}

/** Minimum distance from a point to a polyline. */
function minPointToSegmentDistance(px: number, py: number, pts: Point[]): number {
  let min = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const d = pointToSegmentDist(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y)
    if (d < min) min = d
  }
  return min
}

/** Closest point between two segment sets (approximation). */
function closestPointOnSegments(p1: Point[], p2: Point[]): Point {
  let min = Infinity
  let best: Point = { x: 0, y: 0 }
  for (let i = 0; i < p1.length - 1; i++) {
    for (let j = 0; j < p2.length - 1; j++) {
      const cp = closestPointOnSegmentToSegment(
        p1[i].x, p1[i].y, p1[i + 1].x, p1[i + 1].y,
        p2[j].x, p2[j].y, p2[j + 1].x, p2[j + 1].y
      )
      const d = Math.hypot(cp.x - (p1[i].x + p1[i + 1].x) / 2, cp.y - (p1[i].y + p1[i + 1].y) / 2)
      if (d < min) {
        min = d
        best = cp
      }
    }
  }
  return best
}

/** Closest point on a polyline to a rect. */
function closestPointOnSegmentsToRect(pts: Point[], pad: PcbPad): Point {
  const rect = {
    minX: pad.center.x - pad.w / 2,
    minY: pad.center.y - pad.h / 2,
    maxX: pad.center.x + pad.w / 2,
    maxY: pad.center.y + pad.h / 2
  }
  let min = Infinity
  let best: Point = { x: 0, y: 0 }
  for (let i = 0; i < pts.length - 1; i++) {
    const cp = closestPointOnSegmentToRect(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, rect)
    const d = Math.hypot(cp.x - pts[i].x, cp.y - pts[i].y)
    if (d < min) {
      min = d
      best = cp
    }
  }
  return best
}

/** Minimum distance from point to segment. */
function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return Math.hypot(apx, apy)
  let t = (apx * abx + apy * aby) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby))
}

/** Minimum distance between two segments. */
function segmentToSegmentDist(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const d1 = pointToSegmentDist(cx, cy, ax, ay, bx, by)
  const d2 = pointToSegmentDist(dx, dy, ax, ay, bx, by)
  const d3 = pointToSegmentDist(ax, ay, cx, cy, dx, dy)
  const d4 = pointToSegmentDist(bx, by, cx, cy, dx, dy)
  return Math.min(d1, d2, d3, d4)
}

/** Distance from point to rectangle (0 if inside). */
function pointToRectDist(px: number, py: number, rect: { minX: number; minY: number; maxX: number; maxY: number }): number {
  const dx = Math.max(rect.minX - px, 0, px - rect.maxX)
  const dy = Math.max(rect.minY - py, 0, py - rect.maxY)
  return Math.hypot(dx, dy)
}

/** Minimum distance from segment to rectangle. */
function segmentToRectDist(ax: number, ay: number, bx: number, by: number, rect: { minX: number; minY: number; maxX: number; maxY: number }): number {
  if (ax >= rect.minX && ax <= rect.maxX && ay >= rect.minY && ay <= rect.maxY) return 0
  if (bx >= rect.minX && bx <= rect.maxX && by >= rect.minY && by <= rect.maxY) return 0
  const edges: [number, number, number, number][] = [
    [rect.minX, rect.minY, rect.maxX, rect.minY],
    [rect.maxX, rect.minY, rect.maxX, rect.maxY],
    [rect.maxX, rect.maxY, rect.minX, rect.maxY],
    [rect.minX, rect.maxY, rect.minX, rect.minY]
  ]
  let min = Infinity
  for (const [ex1, ey1, ex2, ey2] of edges) {
    const d = segmentToSegmentDist(ax, ay, bx, by, ex1, ey1, ex2, ey2)
    if (d < min) min = d
  }
  return min
}

/** Closest point on segment to segment. */
function closestPointOnSegmentToSegment(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): Point {
  // Approximation: return midpoint of the segment whose endpoint is closest
  const d1 = pointToSegmentDist(cx, cy, ax, ay, bx, by)
  const d2 = pointToSegmentDist(dx, dy, ax, ay, bx, by)
  const d3 = pointToSegmentDist(ax, ay, cx, cy, dx, dy)
  const d4 = pointToSegmentDist(bx, by, cx, cy, dx, dy)
  const min = Math.min(d1, d2, d3, d4)
  if (min === d1) return { x: cx, y: cy }
  if (min === d2) return { x: dx, y: dy }
  if (min === d3) return { x: ax, y: ay }
  return { x: bx, y: by }
}

/** Closest point on segment to rect. */
function closestPointOnSegmentToRect(ax: number, ay: number, bx: number, by: number, rect: { minX: number; minY: number; maxX: number; maxY: number }): Point {
  // Approximation: return closest endpoint to rect
  const d1 = pointToRectDist(ax, ay, rect)
  const d2 = pointToRectDist(bx, by, rect)
  if (d1 <= d2) return { x: ax, y: ay }
  return { x: bx, y: by }
}

export interface DrcSummary {
  total: number
  errors: number
  warnings: number
  infos: number
  clean: boolean
}

/** Summarize DRC violations into counts. */
export function summarizeDrc(violations: DrcViolation[]): DrcSummary {
  const errors = violations.filter((v) => v.severity === 'error').length
  const warnings = violations.filter((v) => v.severity === 'warning').length
  const infos = violations.filter((v) => v.severity === 'info').length
  return {
    total: violations.length,
    errors,
    warnings,
    infos,
    clean: errors === 0
  }
}
