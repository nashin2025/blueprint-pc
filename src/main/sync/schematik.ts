import { lastmods, savePart, setState, getState, type PartRecord } from '../catalogue/db'
import { normalisePin, parseCurrency, parsePriceValue, type SourcePin } from './schematik-parse'

/**
 * Reading the public Schematik catalogue.
 *
 * Two rules shape this file:
 *
 * 1. Be a good guest. The source is someone else's service, offered free. The
 *    importer runs slowly, in bounded batches, remembers where it stopped, and
 *    never runs faster than REQUEST_GAP_MS. "No hurry" is a design constraint,
 *    not an apology.
 * 2. Never throw at the caller. A sync that dies halfway through a 6,000-part
 *    import is worse than one that skips a part and says so, so every failure is
 *    counted and reported.
 */

const MCP_URL = 'https://www.schematik.io/mcp'
const SITEMAP_URL = 'https://www.schematik.io/sitemap.xml'

/** Minimum gap between source requests. Slow on purpose. */
const REQUEST_GAP_MS = 400
/** Parts attempted per sync run. Keeps one run short and resumable. */
const DEFAULT_BATCH = 40

const UA = 'BlueprintPC/0.1 (local desktop app; personal catalogue mirror)'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

export interface SitemapEntry {
  slug: string
  lastmod: string | null
}

/**
 * Part slugs from the source's sitemap.
 *
 * The sitemap is the only cheap way to enumerate the catalogue: there is no
 * list-all tool, and search caps at 20 results with no pagination.
 */
export async function fetchSitemap(): Promise<SitemapEntry[]> {
  const res = await fetch(SITEMAP_URL, {
    headers: { 'User-Agent': UA, Accept: 'application/xml,text/xml,*/*' },
    signal: AbortSignal.timeout(30_000)
  })
  if (!res.ok) throw new Error(`sitemap returned ${res.status}`)

  const xml = await res.text()
  const entries: SitemapEntry[] = []
  for (const match of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const block = match[1]
    const loc = block.match(/<loc>([^<]+)<\/loc>/i)?.[1]?.trim()
    if (!loc || !/\/parts\/[^/?#]+$/.test(loc)) continue
    const slug = loc.split('/').pop()
    if (!slug) continue
    const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/i)?.[1]?.trim() ?? null
    entries.push({ slug, lastmod })
  }
  return entries
}

// ---------------------------------------------------------------------------
// MCP client
// ---------------------------------------------------------------------------

interface McpSession {
  sessionId: string | null
  requestId: number
}

const session: McpSession = { sessionId: null, requestId: 0 }

async function rpc(
  method: string,
  params?: Record<string, unknown>,
  notify = false
): Promise<Record<string, unknown> | null> {
  const body: Record<string, unknown> = { jsonrpc: '2.0', method }
  if (params) body.params = params
  if (!notify) body.id = ++session.requestId

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'User-Agent': UA
  }
  if (session.sessionId) headers['Mcp-Session-Id'] = session.sessionId

  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  })

  const sid = res.headers.get('mcp-session-id')
  if (sid) session.sessionId = sid

  const text = await res.text()
  if (!text.trim()) return null

  // Streamable HTTP may answer as server-sent events; take the data payload.
  const data = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('')

  try {
    return JSON.parse(data || text) as Record<string, unknown>
  } catch {
    return null
  }
}

let initialised = false

async function ensureSession(): Promise<void> {
  if (initialised) return
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'blueprint-pc', version: '0.1.0' }
  })
  await rpc('notifications/initialized', {}, true)
  initialised = true
}

interface SourcePart {
  slug?: string
  name?: string
  brand?: string
  partNumber?: string
  description?: string
  category?: string
  price?: string
  priceValue?: number
  priceCurrency?: string
  url?: string
  image?: string
  pinout?: SourcePin[]
}

/**
 * One part, converted to our row shape.
 *
 * The source quotes price as display text ("from 3.95 EUR"). We keep both the
 * text and a parsed number: the text is what the user should see, the number is
 * what lets us sort and compare. Parsing lives in schematik-parse.ts so the
 * self-check can cover it without a network or a database.
 */
async function fetchPart(slug: string): Promise<PartRecord | null> {
  await ensureSession()
  const res = await rpc('tools/call', { name: 'get_part', arguments: { slug } })
  const content = (res?.result as { content?: { text?: string }[] } | undefined)?.content
  const text = content?.[0]?.text
  if (!text) return null

  let raw: SourcePart
  try {
    raw = JSON.parse(text) as SourcePart
  } catch {
    return null
  }

  const priceText = raw.price ?? null
  return {
    slug: raw.slug ?? slug,
    name: raw.name ?? slug,
    brand: raw.brand ?? null,
    partNumber: raw.partNumber ?? null,
    description: raw.description ?? null,
    category: raw.category ?? null,
    priceText,
    priceValue: parsePriceValue(priceText, raw.priceValue),
    priceCurrency: parseCurrency(priceText, raw.priceCurrency),
    url: raw.url ?? null,
    image: raw.image ?? null,
    pinout: (raw.pinout ?? []).map(normalisePin),
    lastmod: null,
    fetchedAt: Date.now(),
    modelUrl: null,
    modelFilePath: null
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface SyncProgress {
  total: number
  known: number
  toFetch: number
  done: number
  failed: number
  running: boolean
  message: string
}

let status: SyncProgress = {
  total: 0,
  known: 0,
  toFetch: 0,
  done: 0,
  failed: 0,
  running: false,
  message: 'not started'
}

export function syncStatus(): SyncProgress {
  return status
}

/**
 * One bounded, resumable sync pass.
 *
 * Each run does at most `batch` parts, so a 6,000-part import finishes across
 * several runs rather than in one long sit. Progress is written after every part,
 * so stopping the app mid-import costs at most one request.
 */
export async function runSync(batch = DEFAULT_BATCH): Promise<SyncProgress> {
  if (status.running) return status
  status = { ...status, running: true, done: 0, failed: 0, message: 'reading sitemap' }

  try {
    const entries = await fetchSitemap()
    const local = lastmods()

    // Parts we have never seen, plus ones whose source page changed since we last
    // looked. Only a minority of sitemap entries carry a lastmod, so the changed
    // set is usually empty and new parts dominate.
    const queue = entries.filter((entry) => {
      const seen = local.get(entry.slug)
      if (seen === undefined) return true
      return entry.lastmod !== null && (seen === null || entry.lastmod > seen)
    })

    status.total = entries.length
    status.known = local.size
    status.toFetch = queue.length
    status.message = `${queue.length} new or changed`

    const target = queue.slice(0, batch)
    let lastCall = 0

    for (const entry of target) {
      // Keep a polite gap between requests regardless of how fast the last one was.
      const wait = REQUEST_GAP_MS - (Date.now() - lastCall)
      if (wait > 0) await sleep(wait)

      try {
        const part = await fetchPart(entry.slug)
        if (part) {
          part.lastmod = entry.lastmod
          savePart(part)
          status.done++
        } else {
          status.failed++
        }
      } catch {
        status.failed++
      }
      lastCall = Date.now()
      status.message = `${status.done} saved, ${status.failed} failed, ${queue.length - status.done - status.failed} left in this batch`
    }

    setState('last_sync_at', String(Date.now()))
    setState('last_sync_done', String(status.done))
    status.running = false
    status.message = `saved ${status.done}, failed ${status.failed}`
  } catch (err) {
    status.running = false
    status.message = err instanceof Error ? err.message : 'sync failed'
  }

  return status
}

export function lastSyncAt(): number | null {
  const raw = getState('last_sync_at')
  return raw ? Number(raw) : null
}