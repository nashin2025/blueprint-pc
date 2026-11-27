/**
 * Mechanical clearance checking for Blueprint PC PCB layouts.
 *
 * Pure functions for checking component-to-component and component-to-board-edge
 * clearance violations. Used by the 3D mechanical viewer (MechTab) to flag
 * physical fit problems before manufacturing.
 *
 * All distances are in mm.
 */

import type { PcbPlacement } from './pcb-layout'

/** One component-to-component clearance violation. */
export interface ComponentClearanceViolation {
  componentId1: string
  componentId2: string
  distance: number
  clearance: number
  violation: boolean
}

/** One component-to-board-edge clearance violation. */
export interface BoardEdgeClearanceViolation {
  componentId: string
  distance: number
  clearance: number
  violation: boolean
}

/** Build an AABB for a placement (centered, rotated rectangle). */
function placementAabb(p: PcbPlacement): { minX: number; minY: number; maxX: number; maxY: number } {
  const rad = (p.rotationDeg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const corners = [
    { x: p.center.x - p.w / 2, y: p.center.y - p.h / 2 },
    { x: p.center.x + p.w / 2, y: p.center.y - p.h / 2 },
    { x: p.center.x + p.w / 2, y: p.center.y + p.h / 2 },
    { x: p.center.x - p.w / 2, y: p.center.y + p.h / 2 }
  ]
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const corner of corners) {
    const rx = c * corner.x - s * corner.y
    const ry = s * corner.x + c * corner.y
    if (rx < minX) minX = rx
    if (ry < minY) minY = ry
    if (rx > maxX) maxX = rx
    if (ry > maxY) maxY = ry
  }
  return { minX, minY, maxX, maxY }
}

/** Minimum edge-to-edge distance between two axis-aligned rectangles. */
function rectDistance(a: { minX: number; minY: number; maxX: number; maxY: number },
                      b: { minX: number; minY: number; maxX: number; maxY: number }): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX)
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY)
  return Math.sqrt(dx * dx + dy * dy)
}

/** Check pairwise component clearances.
 *
 *  Returns one entry per component pair with distance and whether it violates
 *  the clearance threshold. Zero-distance pairs (overlapping footprints) are
 *  always violations.
 */
export function checkComponentClearance(
  placements: PcbPlacement[],
  clearance: number
): ComponentClearanceViolation[] {
  const violations: ComponentClearanceViolation[] = []
  const boxes = placements.map((p) => ({ componentId: p.componentId, aabb: placementAabb(p) }))

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      const distance = rectDistance(a.aabb, b.aabb)
      violations.push({
        componentId1: a.componentId,
        componentId2: b.componentId,
        distance,
        clearance,
        violation: distance < clearance
      })
    }
  }

  return violations
}

/** Check component-to-board-edge clearance.
 *
 *  Returns one entry per component with distance from the component's closest
 *  edge to the nearest board edge, and whether it violates the clearance
 *  threshold.
 */
export function checkBoardEdgeClearance(
  placements: PcbPlacement[],
  boardW: number,
  boardH: number,
  clearance: number
): BoardEdgeClearanceViolation[] {
  const violations: BoardEdgeClearanceViolation[] = []

  for (const p of placements) {
    const box = placementAabb(p)

    // Distance from each side of the component's AABB to the nearest board edge
    const distToLeft = box.minX
    const distToRight = boardW - box.maxX
    const distToBottom = boardH - box.maxY
    const distToTop = box.minY

    const distance = Math.min(distToLeft, distToRight, distToBottom, distToTop)

    violations.push({
      componentId: p.componentId,
      distance,
      clearance,
      violation: distance < clearance
    })
  }

  return violations
}
