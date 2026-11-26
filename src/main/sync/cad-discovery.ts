/**
 * Bulk SnapEDA CAD discovery for the local parts catalogue.
 *
 * Walks every CAD-worthy part in the local mirror that still lacks a model URL,
 * searches SnapEDA by part name, extracts the signed S3 GLB viewer URL, and
 * saves it back to the catalogue database.
 *
 * Politeness rules (same discipline as the Schematik sync):
 *   - 400 ms gap between source requests (SnapEDA sits behind Cloudflare)
 *   - 40 parts per run, resumable across runs via sync_state
 *   - Never throws at the caller; every failure is counted and reported
 *   - One model URL per part, on demand for the user's own design
 *
 * IMPORTANT: SnapEDA sits behind Cloudflare and returns 403 Forbidden for
 * programmatic requests, even with browser-like headers. Automated discovery
 * is currently blocked. This is an external limitation, not a bug in this code.
 * The `blocked` count tracks how many parts hit the 403 wall.
 *
 * SnapEDA endpoints used (observed, undocumented):
 *   POST /api/v1/search_local_internal   part search, no auth
 *   GET  /parts/get-3d-viewer-url/{id}/?unipart_id={uid}  signed GLB viewer URL
 */

import { database, saveModelUrl, setState } from '../catalogue/db'
import { searchSnapedaPart, getSnapeda3dUrl } from '../snapeda'

const REQUEST_GAP_MS = 400
const DEFAULT_BATCH = 40

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Maps Schematik category names to CAD-worthy status.
 *
 * Schematik uses its own category taxonomy (e.g. "esp32-boards", "distance-sensors")
 * which doesn't match the simple set used in the renderer's cadSources.ts. This
 * maps each observed Schematik category to whether a part of that type plausibly
 * has a downloadable 3D model.
 *
 * CAD-worthy: parts with a distinct physical 3D shape (boards, sensors, motors,
 * displays, connectors, enclosures, breadboards, batteries).
 * Not CAD-worthy: passives, cables, chips, kits, add-on shields, networking
 * modules, tools - things where a 3D model adds little value.
 */
const CAD_WORTHY_CATEGORIES = new Set([
  // Microcontroller / computer boards
  'esp32-boards',
  'arduino-boards',
  'other-mcu-boards',
  'single-board-computers',
  'rp2040-pico-boards',
  // Displays
  'tft-lcd-displays',
  'oled-displays',
  'led-displays',
  'e-paper-displays',
  // Sensors
  'distance-sensors',
  'temperature-humidity-pressure',
  'gas-air-quality-sensors',
  'imu-motion-sensors',
  'soil-liquid-sensors',
  'light-color-sensors',
  'other-sensors',
  'environment-sensors',
  'biometric-sensors',
  'force-weight-sensors',
  'current-voltage-sensors',
  // Actuators
  'dc-gear-motors',
  'servos',
  'stepper-motors',
  'pumps-solenoids',
  'addressable-leds',
  // Power
  'power-supplies-regulators',
  'batteries',
  'chargers-fuel-gauges',
  'solar-power',
  // Connectors / interfaces
  'connectors',
  'buttons-switches',
  'relays',
  'logic-level-converters',
  // Structure / mechanical
  'breadboards-prototyping',
  'hardware-mounting',
  'robotics-mechanics',
  'enclosures-cases'
])

function hasCadModel(category: string): boolean {
  return CAD_WORTHY_CATEGORIES.has(category.toLowerCase())
}

export interface CadDiscoveryProgress {
  total: number
  known: number
  toDiscover: number
  done: number
  found: number
  failed: number
  blocked: number
  running: boolean
  message: string
}

let status: CadDiscoveryProgress = {
  total: 0,
  known: 0,
  toDiscover: 0,
  done: 0,
  found: 0,
  failed: 0,
  blocked: 0,
  running: false,
  message: 'not started'
}

export function cadDiscoveryStatus(): CadDiscoveryProgress {
  return { ...status }
}

let lastCall = 0

async function throttle(): Promise<void> {
  const wait = REQUEST_GAP_MS - (Date.now() - lastCall)
  if (wait > 0) await sleep(wait)
  lastCall = Date.now()
}

/**
 * One bounded, resumable discovery pass.
 *
 * Each run attempts at most `batch` parts, so a 6,000-part catalogue finishes
 * across several runs. Progress is written after every part.
 */
export async function runCadDiscovery(batch = DEFAULT_BATCH): Promise<CadDiscoveryProgress> {
  if (status.running) return status
  status = {
    ...status,
    running: true,
    done: 0,
    found: 0,
    failed: 0,
    blocked: 0,
    message: 'reading catalogue'
  }

  try {
    const conn = database()

    // All parts in the local mirror that still lack a model URL.
    const allSlugs = conn
      .prepare('SELECT slug, name, category FROM parts WHERE model_url IS NULL ORDER BY name')
      .all() as { slug: string; name: string; category: string | null }[]

    // Only CAD-worthy categories are worth discovering a model for.
    const queue = allSlugs.filter((p) => p.category && hasCadModel(p.category))

    status.total = allSlugs.length
    status.known = allSlugs.length - queue.length
    status.toDiscover = queue.length
    status.message = `${queue.length} CAD-worthy parts without a model URL`

    const target = queue.slice(0, batch)

    for (const part of target) {
      await throttle()

      try {
        const searchRes = await searchSnapedaPart(part.name)

        // Cloudflare 403 blocks everything - stop counting as "failed" and
        // report as "blocked" instead so the UI can explain the situation.
        if (searchRes.blocked) {
          status.blocked++
          status.message = `${status.done} saved, ${status.found} found, ${status.blocked} blocked (SnapEDA 403), ${status.failed} error`
          continue
        }
        if (!searchRes.ok || !searchRes.data) {
          status.failed++
          status.message = `${status.done} saved, ${status.found} found, ${status.blocked} blocked, ${status.failed} no match`
          continue
        }

        const urlRes = await getSnapeda3dUrl(searchRes.data.modelId, searchRes.data.unipartId)
        if (urlRes.blocked) {
          status.blocked++
          status.message = `${status.done} saved, ${status.found} found, ${status.blocked} blocked (SnapEDA 403), ${status.failed} error`
          continue
        }
        if (!urlRes.ok || !urlRes.data) {
          status.failed++
          status.message = `${status.done} saved, ${status.found} found, ${status.blocked} blocked, ${status.failed} no URL`
          continue
        }

        saveModelUrl(part.slug, urlRes.data)
        status.done++
        status.found++
        status.message = `${status.done} saved, ${status.found} found, ${status.blocked} blocked`
      } catch {
        status.failed++
        status.message = `${status.done} saved, ${status.found} found, ${status.blocked} blocked, ${status.failed} error`
      }
    }

    setState('last_cad_discovery_at', String(Date.now()))
    setState('last_cad_discovery_done', String(status.done))
    status.running = false
    status.message = `saved ${status.done}, found ${status.found}, blocked ${status.blocked}, no match ${status.failed}`
  } catch (err) {
    status.running = false
    status.message = err instanceof Error ? err.message : 'CAD discovery failed'
  }

  return status
}
