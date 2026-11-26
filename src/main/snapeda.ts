/**
 * SnapEDA (SnapMagic Search) CAD discovery.
 *
 * SnapEDA serves 3D models (GLB is the dependable anonymous format) through a
 * viewer URL that contains a time-limited signed S3 link. Neither the search
 * endpoint nor the viewer URL endpoint is a documented public API - they are
 * observed from the site's own network traffic. Treat this as best-effort:
 * every failure returns an error info, never throws.
 *
 * IMPORTANT: SnapEDA sits behind Cloudflare and returns 403 Forbidden for
 * programmatic requests, even with browser-like headers. Automated discovery
 * is currently blocked. This is an external limitation, not a bug in this code.
 * Manual paste of .stl/.obj/.gltf/.glb URLs remains the reliable path.
 *
 * Sources (observed, undocumented):
 *   POST /api/v1/search_local_internal   part search, no auth
 *   GET  /parts/get-3d-viewer-url/{id}/?unipart_id={uid}  signed GLB viewer URL
 *
 * Politeness: one request per part per session, minimum REQUEST_GAP_MS gap
 * between source requests, results cached by part name for the session.
 */

const BASE = 'https://www.snapeda.com'
const SEARCH_PATH = '/api/v1/search_local_internal'
const VIEWER_PATH = (modelId: string) => `/parts/get-3d-viewer-url/${modelId}/`

/** Minimum gap between SnapEDA requests. Slow on purpose. */
const REQUEST_GAP_MS = 400

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Last SnapEDA request timestamp, for enforcing the inter-request gap. */
let lastRequestAt = 0

async function throttle(): Promise<void> {
  const now = Date.now()
  const gap = now - lastRequestAt
  if (gap < REQUEST_GAP_MS) await sleep(REQUEST_GAP_MS - gap)
  lastRequestAt = Date.now()
}

/** Session cache of search results by normalised part name. */
const searchCache = new Map<string, SnapedaPartResult | null>()

function cacheKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Result of a SnapEDA request. `blocked` is true when Cloudflare (403) stops us. */
export interface SnapedaResult<T> {
  ok: boolean
  data: T | null
  status: number | null
  blocked: boolean
}

export interface SnapedaPartResult {
  modelId: string
  unipartId: string
}

async function fetchWithStatus(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number | null; body: string | null }> {
  await throttle()
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        ...(init?.headers ?? {})
      },
      signal: AbortSignal.timeout(15_000),
      method: init?.method ?? 'GET',
      body: init?.body
    })
    const text = await res.text().catch(() => null)
    return { ok: res.ok, status: res.status, body: text }
  } catch {
    return { ok: false, status: null, body: null }
  }
}

async function fetchJsonWithStatus(
  url: string,
  init?: RequestInit
): Promise<SnapedaResult<unknown>> {
  const res = await fetchWithStatus(url, init)
  if (!res.ok) {
    return { ok: false, data: null, status: res.status, blocked: res.status === 403 }
  }
  return { ok: true, data: res.body ? JSON.parse(res.body) : null, status: res.status, blocked: false }
}

async function fetchTextWithStatus(
  url: string
): Promise<SnapedaResult<string>> {
  const res = await fetchWithStatus(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/json,*/*'
    }
  })
  if (!res.ok) {
    return { ok: false, data: null, status: res.status, blocked: res.status === 403 }
  }
  return { ok: true, data: res.body, status: res.status, blocked: false }
}

/**
 * Search SnapEDA for a part by name. Returns the first result that advertises a
 * 3D model, or an error result if blocked by Cloudflare (403).
 */
export async function searchSnapedaPart(
  name: string
): Promise<SnapedaResult<SnapedaPartResult>> {
  const key = cacheKey(name)
  const cached = searchCache.get(key)
  if (cached !== undefined) {
    return cached
      ? { ok: true, data: cached, status: 200, blocked: false }
      : { ok: false, data: null, status: 200, blocked: false }
  }

  try {
    const bodies: Record<string, unknown>[] = [
      { q: name },
      { query: name },
      { keyword: name },
      { search: name }
    ]

    for (const body of bodies) {
      const res = await fetchJsonWithStatus(`${BASE}${SEARCH_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      // 403 = Cloudflare blocked. Don't retry with other body shapes.
      if (res.blocked) {
        const result: SnapedaResult<SnapedaPartResult> = {
          ok: false,
          data: null,
          status: res.status,
          blocked: true
        }
        searchCache.set(key, null)
        return result
      }
      if (!res.ok || !res.data) continue

      const results = extractResults(res.data)
      for (const item of results) {
        const modelId = pick(item, ['model_id', 'modelId', 'id', 'cad_id', 'cadId'])
        const unipartId = pick(item, ['unipart_id', 'unipartId', 'uid'])
        const has3d = pick(item, ['has_3d', 'has3d', 'has3dModel', 'has_3d_model'])
        if (!modelId || !unipartId) continue
        if (has3d !== undefined && has3d !== true && has3d !== 1 && has3d !== '1') continue
        const result: SnapedaPartResult = {
          modelId: String(modelId),
          unipartId: String(unipartId)
        }
        searchCache.set(key, result)
        return { ok: true, data: result, status: 200, blocked: false }
      }
    }

    // No match found (not blocked)
    searchCache.set(key, null)
    return { ok: false, data: null, status: 200, blocked: false }
  } catch {
    const result: SnapedaResult<SnapedaPartResult> = {
      ok: false,
      data: null,
      status: null,
      blocked: false
    }
    searchCache.set(key, null)
    return result
  }
}

/**
 * Given a model_id and unipart_id, fetch the 3D viewer page and extract the
 * signed S3 GLB URL embedded in it. Returns an error result if blocked.
 */
export async function getSnapeda3dUrl(
  modelId: string,
  unipartId: string
): Promise<SnapedaResult<string>> {
  const url = `${BASE}${VIEWER_PATH(encodeURIComponent(modelId))}?unipart_id=${encodeURIComponent(unipartId)}`
  const res = await fetchTextWithStatus(url)
  if (!res.ok) {
    return { ok: false, data: null, status: res.status, blocked: res.blocked }
  }

  const html = res.data
  if (!html) {
    return { ok: false, data: null, status: res.status, blocked: false }
  }

  // SnapEDA viewer pages embed a signed S3 GLB link, e.g.
  // https://snapeda.s3.amazonaws.com/media/CADParts/...--3DModel-fbx-....glb?AWSAccessKeyId=...&Expires=...&Signature=...
  const glbRe =
    /https:\/\/snapeda\.s3\.amazonaws\.com\/[^"'\\\s]+\.glb[^"'\\\s]*/gi
  const match = glbRe.exec(html)
  if (!match) {
    return { ok: false, data: null, status: 200, blocked: false }
  }

  return {
    ok: true,
    data: match[0].replace(/[;,)\]\s]+$/, ''),
    status: 200,
    blocked: false
  }
}

/** Pull candidate result arrays out of an unknown-shaped JSON response. */
function extractResults(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (data === null || typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  for (const key of ['results', 'data', 'parts', 'items', 'hits', 'search_results']) {
    const val = obj[key]
    if (Array.isArray(val)) return val
  }
  return []
}

/** Pick the first defined value from a record across several candidate keys. */
function pick(record: unknown, keys: string[]): unknown {
  if (record === null || typeof record !== 'object') return undefined
  const obj = record as Record<string, unknown>
  for (const key of keys) {
    if (key in obj) return obj[key]
  }
  return undefined
}
