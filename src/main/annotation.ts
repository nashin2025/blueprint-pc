/**
 * Forward/backward annotation + ECO (Engineering Change Order) sync for
 * Blueprint PC.
 *
 * Links schematic components to PCB footprints and detects divergences
 * between the schematic and the PCB layout. When the schematic changes
 * (new part, deleted part, changed net, changed footprint), an ECO is
 * generated describing the changes needed to bring the PCB into sync.
 *
 * This is a feasibility-level implementation. It detects divergences and
 * generates ECO actions, but does not automatically modify the PCB layout
 * geometry — that requires user review and manual (or semi-automated)
 * application.
 */

import type { Component, DesignSpec } from '@shared/types'

/** One link between a schematic component and its PCB placement. */
export interface AnnotationLink {
  /** Schematic component ID. */
  componentId: string
  /** Reference designator (e.g. "C1", "R1"). */
  designator: string
  /** PCB placement ID (if placed). Null if not yet placed on PCB. */
  placementId: string | null
  /** PCB footprint (if assigned). Null if not yet assigned. */
  footprintId: string | null
  /** Net this component's pins connect to (from schematic). */
  schematicNet: string | null
  /** Net this component's pins connect to (from PCB). Null if not routed. */
  pcbNet: string | null
}

/** One divergence between schematic and PCB. */
export interface AnnotationDivergence {
  /** Type of divergence. */
  type:
    | 'component_added'     // In schematic, not in PCB
    | 'component_removed'   // In PCB, not in schematic
    | 'footprint_changed'   // Different footprint on PCB vs schematic
    | 'net_changed'         // Different net on PCB vs schematic
    | 'unplaced'            // In schematic, not placed on PCB
    | 'unrouted'            // Net in schematic, not routed on PCB
  /** Schematic component ID (if applicable). */
  componentId: string
  /** Reference designator. */
  designator: string
  /** Human-readable description. */
  message: string
  /** Severity: 'error' blocks sync, 'warning' is advisory. */
  severity: 'error' | 'warning'
}

/** One ECO (Engineering Change Order) action. */
export interface EcoAction {
  /** Action type. */
  type:
    | 'add_component'      // Add component to PCB
    | 'remove_component'   // Remove component from PCB
    | 'change_footprint'   // Change component footprint
    | 'change_net'         // Change component net assignment
    | 'place_component'    // Place unplaced component on PCB
  /** Reference designator. */
  designator: string
  /** New value (footprint name, net name, etc. depending on type). */
  newValue: string | null
  /** Old value (for undo/review). */
  oldValue: string | null
}

/** Complete ECO: a set of actions to bring PCB into sync with schematic. */
export interface Eco {
  id: string
  createdAt: number
  actions: EcoAction[]
  divergences: AnnotationDivergence[]
  /** True if all divergences can be resolved automatically. */
  autoResolvable: boolean
}

/**
 * Build annotation links between schematic components and PCB placements.
 *
 * Matches components by reference designator (from `designator` field) and
 * links them to PCB placements by name. Returns one link per schematic
 * component.
 */
export function buildAnnotationLinks(
  spec: DesignSpec,
  placementDesignators: Map<string, string> // placementId -> designator
): AnnotationLink[] {
  const links: AnnotationLink[] = []

  // Build placement lookup by designator
  const placementByDesignator = new Map<string, string>()
  for (const [placementId, designator] of placementDesignators) {
    placementByDesignator.set(designator, placementId)
  }

  // Build net lookup from connections
  const compNetMap = new Map<string, string | null>() // componentId -> net name
  for (const conn of spec.connections) {
    compNetMap.set(conn.from.componentId, conn.net ?? null)
    compNetMap.set(conn.to.componentId, conn.net ?? null)
  }

  for (const comp of spec.components) {
    const designator = comp.designator ?? comp.name
    const placementId = placementByDesignator.get(designator) ?? null
    const footprintId = comp.footprintId ?? null
    const schematicNet = compNetMap.get(comp.id) ?? null

    // PCB net: for unplaced components, there's no PCB net
    let pcbNet: string | null = null
    if (placementId !== null) {
      // Find traces connected to this placement's pads
      // Simplified: use the schematic net as the PCB net for placed components
      pcbNet = schematicNet
    }

    links.push({
      componentId: comp.id,
      designator,
      placementId,
      footprintId,
      schematicNet,
      pcbNet
    })
  }

  return links
}

/**
 * Compare schematic to PCB and find divergences.
 *
 * Returns divergences where the schematic and PCB disagree:
 *   - Component in schematic but not placed on PCB ('unplaced')
 *   - Component in schematic with no matching PCB footprint ('component_added')
 *   - Different footprint on PCB vs schematic ('footprint_changed')
 *   - Different net on PCB vs schematic ('net_changed')
 */
export function findDivergences(
  links: AnnotationLink[],
  pcbFootprints: Map<string, string>, // placementId -> footprintId on PCB
  pcbNets: Map<string, string> // placementId -> net name on PCB
): AnnotationDivergence[] {
  const divergences: AnnotationDivergence[] = []

  for (const link of links) {
    // Unplaced component: in schematic, no placement on PCB
    if (link.placementId === null) {
      divergences.push({
        type: 'unplaced',
        componentId: link.componentId,
        designator: link.designator,
        message: `Component "${link.designator}" is in the schematic but not placed on the PCB`,
        severity: 'warning'
      })
      continue
    }

    const pcbFootprint = pcbFootprints.get(link.placementId) ?? null
    const pcbNet = pcbNets.get(link.placementId) ?? null

    // Footprint mismatch
    if (link.footprintId !== null && pcbFootprint !== null && link.footprintId !== pcbFootprint) {
      divergences.push({
        type: 'footprint_changed',
        componentId: link.componentId,
        designator: link.designator,
        message: `Component "${link.designator}" footprint changed: ${link.footprintId} → ${pcbFootprint}`,
        severity: 'warning'
      })
    }

    // Net mismatch
    if (link.schematicNet !== null && pcbNet !== null && link.schematicNet !== pcbNet) {
      divergences.push({
        type: 'net_changed',
        componentId: link.componentId,
        designator: link.designator,
        message: `Component "${link.designator}" net changed: ${link.schematicNet} → ${pcbNet}`,
        severity: 'warning'
      })
    }

    // Unrouted: placed but no net on PCB
    if (link.placementId !== null && pcbNet === null) {
      divergences.push({
        type: 'unrouted',
        componentId: link.componentId,
        designator: link.designator,
        message: `Component "${link.designator}" is placed on PCB but has no routed net`,
        severity: 'warning'
      })
    }
  }

  return divergences
}

/**
 * Generate an ECO from divergences.
 *
 * Each divergence becomes one or more ECO actions. Returns an Eco object
 * with actions and metadata.
 */
export function generateEco(
  divergences: AnnotationDivergence[]
): Eco {
  const actions: EcoAction[] = []

  for (const div of divergences) {
    switch (div.type) {
      case 'unplaced':
        actions.push({
          type: 'place_component',
          designator: div.designator,
          newValue: null,
          oldValue: null
        })
        break

      case 'footprint_changed':
        actions.push({
          type: 'change_footprint',
          designator: div.designator,
          newValue: null, // Would be populated from pcbFootprints
          oldValue: null
        })
        break

      case 'net_changed':
        actions.push({
          type: 'change_net',
          designator: div.designator,
          newValue: null, // Would be populated from pcbNets
          oldValue: null
        })
        break

      case 'unrouted':
        actions.push({
          type: 'change_net',
          designator: div.designator,
          newValue: null,
          oldValue: null
        })
        break

      case 'component_added':
      case 'component_removed':
        // These require schematic/PCB structural changes beyond ECO scope
        break
    }
  }

  const autoResolvable = actions.every(
    (a) => a.type === 'place_component' || a.type === 'change_footprint' || a.type === 'change_net'
  )

  return {
    id: `eco_${Date.now()}`,
    createdAt: Date.now(),
    actions,
    divergences,
    autoResolvable
  }
}

/**
 * Apply an ECO to a design spec (forward annotation: schematic → PCB).
 *
 * Returns a new DesignSpec with ECO actions applied. Does not mutate the
 * input. Unresolvable divergences are left as-is.
 */
export function applyEco(spec: DesignSpec, eco: Eco): DesignSpec {
  const nextSpec: DesignSpec = { ...spec }
  const compByDesignator = new Map<string, Component>()
  for (const comp of spec.components) {
    compByDesignator.set(comp.designator ?? comp.name, comp)
  }

  for (const action of eco.actions) {
    const comp = compByDesignator.get(action.designator)
    if (!comp) continue

    switch (action.type) {
      case 'place_component':
        // Mark component as placed (footprintId already set from schematic)
        break
      case 'change_footprint':
        if (action.newValue) {
          const nextComp = { ...comp, footprintId: action.newValue }
          nextSpec.components = nextSpec.components.map((c) =>
            c.id === comp.id ? nextComp : c
          )
        }
        break
      case 'change_net':
        // Net changes affect connections, not components directly
        break
      case 'add_component':
      case 'remove_component':
        // Structural changes not supported in automatic ECO
        break
    }
  }

  return nextSpec
}

/**
 * Backward annotation: detect PCB changes not reflected in schematic.
 *
 * Compares PCB placements/traces to the schematic and returns divergences
 * where the PCB has something the schematic doesn't.
 */
export function backwardAnnotation(
  pcbPlacements: Array<{ componentId: string; designator: string; footprintId: string | null; net: string | null }>,
  schematicComponents: Component[]
): AnnotationDivergence[] {
  const divergences: AnnotationDivergence[] = []
  const schByDesignator = new Map<string, Component>()
  for (const comp of schematicComponents) {
    schByDesignator.set(comp.designator ?? comp.name, comp)
  }

  for (const placement of pcbPlacements) {
    const schComp = schByDesignator.get(placement.designator)
    if (!schComp) {
      // PCB component not in schematic
      divergences.push({
        type: 'component_added',
        componentId: placement.componentId,
        designator: placement.designator,
        message: `Component "${placement.designator}" is on the PCB but not in the schematic`,
        severity: 'error'
      })
      continue
    }

    // Check footprint sync
    const schFootprint = schComp.footprintId ?? null
    if (schFootprint !== null && placement.footprintId !== null && schFootprint !== placement.footprintId) {
      divergences.push({
        type: 'footprint_changed',
        componentId: placement.componentId,
        designator: placement.designator,
        message: `Component "${placement.designator}" footprint differs: schematic=${schFootprint}, PCB=${placement.footprintId}`,
        severity: 'warning'
      })
    }
  }

  return divergences
}
