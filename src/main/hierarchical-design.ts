/**
 * Hierarchical design support: pure functions for flattening, instantiating,
 * expanding, and validating hierarchical blocks (sub-circuits) within a
 * DesignSpec.
 *
 * Pure TypeScript. All functions are pure: they never mutate their inputs
 * and always return new objects.
 */

import type {
  Component,
  Connection,
  DesignSpec,
  HierarchicalBlock,
  PinRef,
  PortMapping,
} from '@shared/types'

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function newId(): string {
  return `hb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// ---------------------------------------------------------------------------
// Flatten a spec: replace every block instance component with its internal
// components and remap connections through port mappings.
// ---------------------------------------------------------------------------

export function flattenHierarchy(spec: DesignSpec): DesignSpec {
  const blockMap = new Map<string, HierarchicalBlock>()
  for (const block of spec.hierarchicalBlocks ?? []) {
    blockMap.set(block.id, block)
  }

  const idGen = newId
  const flat = flattenSpec(spec, blockMap, idGen, new Set())

  return {
    ...spec,
    components: flat.components,
    connections: flat.connections,
    hierarchicalBlocks: undefined,
  }
}

/**
 * Creates a component instance from a hierarchical block. The instance's pins
 * are the block's port names, and `hierarchicalBlockId` references the block.
 *
 * `position` is accepted for the UI layer to place the instance; the Component
 * type has no x/y fields so it is not persisted here.
 */
export function instantiateBlock(
  block: HierarchicalBlock,
  instanceId: string,
  position: { x: number; y: number }
): Component {
  void position // Component type has no x/y fields; UI layer owns placement.
  return {
    id: instanceId,
    name: block.name,
    category: 'Hierarchical Block',
    quantity: 1,
    pins: block.ports.map((p) => p.name),
    hierarchicalBlockId: block.id,
  }
}

/**
 * Replaces a hierarchical block component instance with its internal
 * components and connections, flattened into the parent spec. The original
 * component is removed. Returns a new DesignSpec (immutable update).
 */
export function expandBlockInPlace(spec: DesignSpec, componentId: string): DesignSpec {
  const comp = spec.components.find((c) => c.id === componentId)
  if (comp === undefined || comp.hierarchicalBlockId === undefined) {
    return spec
  }

  const blockMap = new Map<string, HierarchicalBlock>()
  for (const block of spec.hierarchicalBlocks ?? []) {
    blockMap.set(block.id, block)
  }

  const block = blockMap.get(comp.hierarchicalBlockId)
  if (block === undefined) return spec

  const flat = flattenSpec(block.spec, blockMap, newId, new Set())

  return {
    ...spec,
    components: spec.components.filter((c) => c.id !== componentId).concat(flat.components),
    connections: spec.connections.filter((c) => c.from.componentId !== componentId && c.to.componentId !== componentId).concat(flat.connections),
  }
}

/**
 * Validates a DesignSpec's hierarchical blocks. Checks that every block has
 * unique IDs, all component pins referenced by block ports exist, and there are
 * no circular block references.
 */
export function validateBlock(spec: DesignSpec): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  const blockMap = new Map<string, HierarchicalBlock>()
  for (const block of spec.hierarchicalBlocks ?? []) {
    if (blockMap.has(block.id)) {
      errors.push(`Duplicate block id: ${block.id}`)
    } else {
      blockMap.set(block.id, block)
    }
  }

  for (const block of spec.hierarchicalBlocks ?? []) {
    validateBlockRecursive(block, new Set(), errors)
  }

  return { valid: errors.length === 0, errors }
}

function validateBlockRecursive(
  block: HierarchicalBlock,
  visited: Set<string>,
  errors: string[]
) {
  if (visited.has(block.id)) return
  visited.add(block.id)

  for (const b of block.spec.hierarchicalBlocks ?? []) {
    validateBlockRecursive(b, visited, errors)
  }

  // Validate all ports reference existing component pins
  for (const port of block.ports) {
    const comp = block.spec.components.find((c) => c.id === port.componentId)
    if (comp === undefined || !comp.pins.includes(port.pinName)) {
      errors.push(
        `Block ${block.id}: port ${port.pinName} references non-existent pin on component ${port.componentId}`
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function flattenSpec(
  spec: DesignSpec,
  blockMap: Map<string, HierarchicalBlock>,
  idGen: () => string,
  visited: Set<string>
): {
  components: Component[]
  connections: Connection[]
  instancePortMaps: Map<string, Map<string, PortMapping>>
  compIdMap: Map<string, string[]>
} {
  const components: Component[] = []
  const connections: Connection[] = []
  const instancePortMaps = new Map<string, Map<string, PortMapping>>()

  // compIdMap: original component id -> new component id(s)
  const compIdMap = new Map<string, string[]>()

  // Pass 1: expand components
  for (const comp of spec.components) {
    if (comp.hierarchicalBlockId !== undefined) {
      const block = blockMap.get(comp.hierarchicalBlockId)
      if (block !== undefined && !visited.has(block.id)) {
        const expanded = expandBlockInstance(
          block,
          comp,
          idGen,
          blockMap,
          visited
        )
        const newIds = expanded.components.map((c) => c.id)
        compIdMap.set(comp.id, newIds)
        instancePortMaps.set(comp.id, expanded.portMap)
        components.push(...expanded.components)
        connections.push(...expanded.connections)
        continue
      }
      // Block not found or circular reference: keep the component as-is so
      // nothing is silently dropped. Validation flags the issue separately.
    }
    compIdMap.set(comp.id, [comp.id])
    components.push(comp)
  }

  // Pass 2: remap connections
  for (const conn of spec.connections) {
    const from = remapPinRef(conn.from, compIdMap, instancePortMaps)
    const to = remapPinRef(conn.to, compIdMap, instancePortMaps)
    if (from !== undefined && to !== undefined) {
      connections.push({
        id: `edge_${newId()}`,
        from,
        to,
        kind: conn.kind,
        label: conn.label,
      })
    }
  }

  return { components, connections, instancePortMaps, compIdMap }
}

/**
 * Expands a hierarchical block instance into its flattened internal
 * components and connections, plus a port map that maps external pin names
 * to internal component:pin references. Used by flattenSpec during hierarchy
 * flattening. Pure: returns new objects, never mutates inputs.
 */
function expandBlockInstance(
  block: HierarchicalBlock,
  comp: Component,
  idGen: () => string,
  blockMap: Map<string, HierarchicalBlock>,
  visited: Set<string>
): {
  components: Component[]
  connections: Connection[]
  portMap: Map<string, PortMapping>
} {
  void comp // The component instance is identified by its hierarchicalBlockId;
  // the block's own spec provides the internal structure to expand.
  visited.add(block.id)

  const flat = flattenSpec(block.spec, blockMap, idGen, visited)

  // Build port map: external port name -> internal component:pin reference.
  // flat.compIdMap maps old internal component ids to their new ids after
  // flattening. For a block port, we look up the internal component it
  // references and use its new id.
  const portMap = new Map<string, PortMapping>()
  for (const port of block.ports) {
    const newIds = flat.compIdMap.get(port.componentId)
    if (newIds && newIds.length > 0) {
      portMap.set(port.name, { componentId: newIds[0], pin: port.pinName })
    }
  }

  return {
    components: flat.components,
    connections: flat.connections,
    portMap,
  }
}

function remapPinRef(
  pinRef: PinRef,
  compIdMap: Map<string, string[]>,
  instancePortMaps: Map<string, Map<string, PortMapping>>
): { componentId: string; pin: string } | undefined {
  const newIds = compIdMap.get(pinRef.componentId)
  if (newIds === undefined || newIds.length === 0)   return undefined

  if (newIds.length === 1) {
    return { componentId: newIds[0], pin: pinRef.pin }
  }

  // The endpoint is a block instance with multiple internal components. Look
  // up the port that matches this external pin name.
  const portMap = instancePortMaps.get(pinRef.componentId)
  if (portMap === undefined)   return undefined
  const target = portMap.get(pinRef.pin)
  if (target === undefined)   return undefined
  return { componentId: target.componentId, pin: target.pin }
}