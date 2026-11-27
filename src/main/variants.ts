/**
 * Design variants + alternate BOM management for Blueprint PC.
 *
 * Design variants let the same PCB be built with different BOMs
 * (e.g., different regions, cost tiers, obsolescence replacements).
 * Each variant specifies component overrides: different part numbers,
 * footprints, or values for specific reference designators.
 *
 * Alternate BOM management lets you specify substitute parts for each
 * component, so if the primary part is unavailable or obsolete, an
 * alternate can be used.
 */

import type { BomAlternative, BomLineItem, Component, Variant } from '@shared/types'

/** Create a new variant from a base design. */
export function createVariant(
  id: string,
  name: string,
  description: string | null,
  baseVariantId: string | null,
  active: boolean
): Variant {
  return {
    id,
    name,
    description,
    baseVariantId,
    componentOverrides: [],
    active
  }
}

/** Add or update a component override in a variant. */
export function addVariantOverride(
  variant: Variant,
  designator: string,
  partNumber: string | null,
  footprintId: string | null,
  unitPrice: number | null,
  notes: string | null
): Variant {
  const override = { designator, partNumber, footprintId, unitPrice, notes }
  const existingIndex = variant.componentOverrides.findIndex((o) => o.designator === designator)
  const nextOverrides = existingIndex >= 0
    ? variant.componentOverrides.map((o, i) => (i === existingIndex ? override : o))
    : [...variant.componentOverrides, override]
  return { ...variant, componentOverrides: nextOverrides }
}

/** Remove a component override from a variant. */
export function removeVariantOverride(variant: Variant, designator: string): Variant {
  return {
    ...variant,
    componentOverrides: variant.componentOverrides.filter((o) => o.designator !== designator)
  }
}

/** Generate a BOM for a specific variant.
 *
 * Base components are used as-is unless overridden by the variant.
 * Alternate BOM entries can replace primary parts when marked.
 */
export function generateBomForVariant(
  components: Component[],
  variant: Variant,
  alternates: BomAlternative[]
): BomLineItem[] {
  const overrideByDesignator = new Map(
    variant.componentOverrides.map((o) => [o.designator, o])
  )
  // alternates is part of the public API for future alternate-selection UI.
  // Not auto-selected without an explicit override.
  void alternates

  const items: BomLineItem[] = []

  for (const comp of components) {
    const designator = comp.designator ?? comp.name
    const override = overrideByDesignator.get(designator)

    let partNumber: string | null = null
    let manufacturer: string | null = null
    let footprintId: string | null = null
    let unitPrice: number | null = null
    let source: 'primary' | 'alternate' | 'override' = 'primary'
    let alternateReason: string | null = null
    let leadTimeDays: number | null = null
    let url: string | null = null

    if (override) {
      // Variant override takes precedence
      partNumber = override.partNumber ?? comp.partName ?? null
      footprintId = override.footprintId ?? comp.footprintId ?? null
      unitPrice = override.unitPrice ?? comp.unitPrice ?? null
      source = 'override'
    } else {
      // Primary part from component. Alternates are available as metadata
      // but are not auto-selected without an explicit override.
      partNumber = comp.partName ?? null
      footprintId = comp.footprintId ?? null
      unitPrice = comp.unitPrice ?? null
    }

    const quantity = comp.quantity
    const extendedPrice = unitPrice !== null ? unitPrice * quantity : null

    items.push({
      designator,
      partNumber,
      manufacturer,
      footprintId,
      quantity,
      unitPrice,
      unitPriceCurrency: comp.unitPriceCurrency ?? 'USD',
      extendedPrice,
      source,
      alternateReason,
      leadTimeDays,
      url
    })
  }

  return items
}

/** Compare two BOMs and return the differences. */
export function compareBoms(
  bomA: BomLineItem[],
  bomB: BomLineItem[]
): Array<{
  designator: string
  field: 'partNumber' | 'footprintId' | 'unitPrice' | 'source' | 'alternateReason'
  valueA: string | null
  valueB: string | null
}> {
  const diffs: Array<{
    designator: string
    field: 'partNumber' | 'footprintId' | 'unitPrice' | 'source' | 'alternateReason'
    valueA: string | null
    valueB: string | null
  }> = []

  const mapA = new Map(bomA.map((i) => [i.designator, i]))
  const mapB = new Map(bomB.map((i) => [i.designator, i]))

  const allDesignators = new Set([...mapA.keys(), ...mapB.keys()])

  for (const designator of allDesignators) {
    const a = mapA.get(designator)
    const b = mapB.get(designator)

    if (!a && b) {
      diffs.push({ designator, field: 'partNumber', valueA: null, valueB: b.partNumber })
      diffs.push({ designator, field: 'source', valueA: null, valueB: b.source })
      continue
    }
    if (a && !b) {
      diffs.push({ designator, field: 'partNumber', valueA: a.partNumber, valueB: null })
      diffs.push({ designator, field: 'source', valueA: a.source, valueB: null })
      continue
    }

    // Both exist - compare fields
    if (!a || !b) continue
    if (a.partNumber !== b.partNumber) {
      diffs.push({ designator, field: 'partNumber', valueA: a.partNumber, valueB: b.partNumber })
    }
    if (a.footprintId !== b.footprintId) {
      diffs.push({ designator, field: 'footprintId', valueA: a.footprintId, valueB: b.footprintId })
    }
    if (a.unitPrice !== b.unitPrice) {
      diffs.push({ designator, field: 'unitPrice', valueA: a.unitPrice?.toString() ?? null, valueB: b.unitPrice?.toString() ?? null })
    }
    if (a.source !== b.source) {
      diffs.push({ designator, field: 'source', valueA: a.source, valueB: b.source })
    }
    if (a.alternateReason !== b.alternateReason) {
      diffs.push({ designator, field: 'alternateReason', valueA: a.alternateReason, valueB: b.alternateReason })
    }
  }

  return diffs
}
