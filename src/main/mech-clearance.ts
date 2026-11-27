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
import type { KeepInZone, KeepOutZone, Enclosure } from '@shared/types'

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

/** One keep-in zone violation: component is outside the zone. */
export interface KeepInZoneViolation {
  componentId: string
  zoneId: string
  zoneName: string
  distance: number  // how far outside the zone (0 = on edge, negative = inside)
}

/** One keep-out zone violation: component overlaps the zone. */
export interface KeepOutZoneViolation {
  componentId: string
  zoneId: string
  zoneName: string
  overlap: number  // overlap area in mm²
}

/** One enclosure collision violation: component collides with enclosure. */
export interface EnclosureCollision {
  componentId: string
  distance: number  // how far outside the enclosure (0 = touching, negative = inside)
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

/** Check components against a keep-in zone. Returns violations for components
 *  whose AABB is not fully inside the zone. */
export function checkKeepInZone(
  placements: PcbPlacement[],
  zone: KeepInZone
): KeepInZoneViolation[] {
  const violations: KeepInZoneViolation[] = []
  const zMinX = zone.x - zone.w / 2
  const zMaxX = zone.x + zone.w / 2
  const zMinY = zone.y - zone.h / 2
  const zMaxY = zone.y + zone.h / 2

  for (const p of placements) {
    const box = placementAabb(p)
    const outsideLeft = zMinX - box.minX
    const outsideRight = box.maxX - zMaxX
    const outsideBottom = zMinY - box.minY
    const outsideTop = box.maxY - zMaxY
    const maxOutside = Math.max(outsideLeft, outsideRight, outsideBottom, outsideTop)

    if (maxOutside > 0) {
      violations.push({
        componentId: p.componentId,
        zoneId: zone.id,
        zoneName: zone.name,
        distance: maxOutside
      })
    }
  }

  return violations
}

/** Check components against a keep-out zone. Returns violations for components
 *  whose AABB overlaps the zone. */
export function checkKeepOutZone(
  placements: PcbPlacement[],
  zone: KeepOutZone
): KeepOutZoneViolation[] {
  const violations: KeepOutZoneViolation[] = []
  const zMinX = zone.x - zone.w / 2
  const zMaxX = zone.x + zone.w / 2
  const zMinY = zone.y - zone.h / 2
  const zMaxY = zone.y + zone.h / 2

  for (const p of placements) {
    const box = placementAabb(p)
    const overlapX = Math.max(0, Math.min(box.maxX, zMaxX) - Math.max(box.minX, zMinX))
    const overlapY = Math.max(0, Math.min(box.maxY, zMaxY) - Math.max(box.minY, zMinY))
    const overlap = overlapX * overlapY

    if (overlap > 0) {
      violations.push({
        componentId: p.componentId,
        zoneId: zone.id,
        zoneName: zone.name,
        overlap
      })
    }
  }

  return violations
}

/** Check components against a 3D enclosure box. Returns violations for components
 *  whose AABB extends outside the enclosure (X/Y only, Z ignored for now). */
export function checkEnclosureCollision(
  placements: PcbPlacement[],
  enclosure: Enclosure
): EnclosureCollision[] {
  const violations: EnclosureCollision[] = []
  const eMinX = enclosure.x - enclosure.w / 2
  const eMaxX = enclosure.x + enclosure.w / 2
  const eMinY = enclosure.y - enclosure.h / 2
  const eMaxY = enclosure.y + enclosure.h / 2

  for (const p of placements) {
    const box = placementAabb(p)
    const outsideLeft = eMinX - box.minX
    const outsideRight = box.maxX - eMaxX
    const outsideBottom = eMinY - box.minY
    const outsideTop = box.maxY - eMaxY
    const maxOutside = Math.max(outsideLeft, outsideRight, outsideBottom, outsideTop)

    if (maxOutside > 0) {
      violations.push({
        componentId: p.componentId,
        distance: maxOutside
      })
    }
  }

  return violations
}
