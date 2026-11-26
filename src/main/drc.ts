/**
 * Design Rule Check (DRC) engine for Blueprint PC.
 *
 * Runs rule-based validation on a DesignSpec and returns a list of violations.
 * Each violation has a severity, category, message, and the affected component(s).
 *
 * Current rules:
 *   - unconnected-pin: a pin with no wire connected (error)
 *   - duplicate-designator: two components share the same designator (error)
 *   - missing-footprint: a component without a 3D model URL (warning)
 */

import type { DesignSpec } from '@shared/types'

export interface DrcViolation {
  id: string
  severity: 'error' | 'warning' | 'info'
  category: string
  message: string
  componentId?: string
  componentName?: string
  pinName?: string
  designator?: string
}

/** Run all DRC rules on a design spec. Returns violations sorted by severity. */
export function runDrc(spec: DesignSpec): DrcViolation[] {
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

  // Rule: unconnected-pin
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

  // Rule: duplicate-designator
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

  // Rule: missing-footprint
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

  // Sort: errors first, then warnings, then info
  violations.sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 }
    return order[a.severity] - order[b.severity]
  })

  return violations
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
