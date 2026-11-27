/**
 * Persisted per-project PCB design rules.
 *
 * Stored as a single JSON file mapping projectId -> PcbDesignRules.
 * Falls back to DEFAULT_PCB_RULES when no rules are saved for a project.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths'
import type { PcbDesignRules } from '@shared/types'
import { DEFAULT_PCB_RULES } from '@shared/types'

const FILE_PATH = join(dataDir(), 'drc-rules.json')

function loadAll(): Map<string, PcbDesignRules> {
  const map = new Map<string, PcbDesignRules>()
  try {
    if (!existsSync(FILE_PATH)) return map
    const raw = readFileSync(FILE_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      for (const [projectId, rules] of Object.entries(parsed)) {
        map.set(projectId, { ...DEFAULT_PCB_RULES, ...(rules as object) })
      }
    }
  } catch {
    // Ignore read errors, return empty map
  }
  return map
}

function saveAll(map: Map<string, PcbDesignRules>): void {
  const obj: Record<string, PcbDesignRules> = {}
  for (const [projectId, rules] of map) {
    obj[projectId] = rules
  }
  writeFileSync(FILE_PATH, JSON.stringify(obj, null, 2))
}

let cache: Map<string, PcbDesignRules> | null = null

function getCache(): Map<string, PcbDesignRules> {
  if (!cache) cache = loadAll()
  return cache
}

/** Get the DRC rules for a project. Falls back to DEFAULT_PCB_RULES. */
export function getDrcRules(projectId: string): PcbDesignRules {
  return getCache().get(projectId) ?? { ...DEFAULT_PCB_RULES }
}

/** Save the DRC rules for a project. */
export function saveDrcRules(projectId: string, rules: PcbDesignRules): void {
  const map = getCache()
  map.set(projectId, rules)
  saveAll(map)
}
