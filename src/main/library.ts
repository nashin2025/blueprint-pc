/**
 * Library management: pure functions for library health reporting and
 * part lifecycle analysis.
 *
 * The health report is a pure function over an array of CataloguePart
 * objects. Lifecycle updates are performed through the IPC layer which
 * has access to the catalogue database.
 */

import type {
  CataloguePart,
  LibraryHealthReport,
  PartLifecycleUpdate
} from '@shared/types'

/** Compute a library health report from a list of catalogue parts. */
export function libraryHealthReport(parts: CataloguePart[]): LibraryHealthReport {
  const byLifecycle: Record<'active' | 'preview' | 'nrnd' | 'obsolete', number> = {
    active: 0,
    preview: 0,
    nrnd: 0,
    obsolete: 0
  }

  let unclassified = 0
  let withSubstitutes = 0
  let withSuppliers = 0
  let obsoleteWithSubstitutes = 0

  for (const part of parts) {
    const lc = part.lifecycle
    if (lc === 'active' || lc === 'preview' || lc === 'nrnd' || lc === 'obsolete') {
      byLifecycle[lc]++
    } else {
      unclassified++
    }

    if (part.substitutes && part.substitutes.length > 0) {
      withSubstitutes++
      if (lc === 'obsolete') obsoleteWithSubstitutes++
    }

    if (part.suppliers && part.suppliers.length > 0) {
      withSuppliers++
    }
  }

  return {
    totalParts: parts.length,
    byLifecycle,
    unclassified,
    withSubstitutes,
    withSuppliers,
    obsoleteWithSubstitutes
  }
}

/** Apply a lifecycle update to a part (pure, returns a new part object). */
export function applyLifecycleUpdate(part: CataloguePart, update: PartLifecycleUpdate): CataloguePart {
  return { ...part, lifecycle: update.lifecycle }
}

/** Check whether a part is usable in a new design (not obsolete). */
export function isPartUsable(part: CataloguePart): boolean {
  return part.lifecycle !== 'obsolete'
}

/** Find substitute parts for a given part from a parts list. */
export function findSubstitutes(slug: string, parts: CataloguePart[]): CataloguePart[] {
  const part = parts.find((p) => p.slug === slug)
  if (!part || !part.substitutes) return []
  return parts.filter((p) => part.substitutes!.includes(p.slug))
}

/** Find all obsolete parts that have substitutes. */
export function findObsoleteWithSubstitutes(parts: CataloguePart[]): CataloguePart[] {
  return parts.filter((p) =>
    p.lifecycle === 'obsolete' && p.substitutes && p.substitutes.length > 0
  )
}
