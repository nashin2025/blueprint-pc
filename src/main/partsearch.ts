import { net } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSafeUrl } from './partimage-parse'
import { dataDir } from './paths'
import {
  isImageFile,
  isRelevantTitle,
  LOOKS_LIKE_DOCUMENT,
  searchCandidates
} from './partsearch-parse'

/**
 * Finds a part photo by searching Wikimedia Commons.
 *
 * Why Commons: it is the only keyless image source that stayed reliable under
 * load. DuckDuckGo's image endpoint answered one burst of queries and then began
 * returning empty results with no explanation, which is not something to build a
 * parts list on.
 *
 * Why net.fetch and not the global fetch: Electron's bundled CA store rejects
 * Wikimedia's certificate chain with CERT_HAS_EXPIRED, while the same request
 * succeeds from Node using the operating system store. net.fetch goes through
 * Chromium's network stack and the OS trust store, so it validates correctly.
 *
 * The trade-off: Commons is a photo archive, not a shop. You get an accurate
 * picture of the part, not a retailer's listing photo. When the model does supply
 * a working product URL, that is still tried first and its photo wins.
 *
 * Relevance and query generation live in ./partsearch-parse so they can be
 * asserted on without a network call. Coverage on a real 10-part build is 8 of 10;
 * the two that miss (a capacitive soil sensor and a generic OLED module) are not
 * on Commons at all.
 */

const API = 'https://commons.wikimedia.org/w/api.php'
const TIMEOUT_MS = 12_000
const UA = 'BlueprintPC/0.1 (local desktop app)'

function cachePath(): string {
  return join(dataDir(), 'part-images.json')
}

export function cacheKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ')
}

function readCache(): Record<string, string> {
  const path = cachePath()
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function writeCache(cache: Record<string, string>): void {
  const path = cachePath()
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf-8')
  renameSync(tmp, path)
}

export function getCachedPartImage(query: string): string | null {
  return readCache()[cacheKey(query)] ?? null
}

export function setCachedPartImage(query: string, filename: string): void {
  const cache = readCache()
  cache[cacheKey(query)] = filename
  writeCache(cache)
}

/**
 * Every filename the cache points at.
 *
 * Part photos are not recorded on the component itself, so the prune would
 * otherwise treat them as orphans and delete them on the next launch, forcing a
 * re-download of every photo each time the app starts.
 */
export function listCachedPartImages(): string[] {
  const cache = readCache()
  return Object.values(cache).filter((v) => typeof v === 'string' && v.length > 0)
}

interface CommonsImage {
  thumburl: string
  url: string
  width: number
  title: string
}

/** Searches Commons and returns candidate image URLs, best query first. */
export async function searchCommonsImages(name: string): Promise<string[]> {
  for (const query of searchCandidates(name)) {
    try {
      const res = await net.fetch(
        `${API}?` +
          new URLSearchParams({
            action: 'query',
            format: 'json',
            generator: 'search',
            gsrnamespace: '6',
            gsrlimit: '8',
            gsrsearch: query,
            prop: 'imageinfo',
            iiprop: 'url|size',
            iiurlwidth: '400'
          }),
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) }
      )
      if (!res.ok) continue

      const json = (await res.json()) as {
        query?: { pages?: Record<string, { title?: string; imageinfo?: CommonsImage[] }> }
      }
      const pages = Object.values(json.query?.pages ?? {})

      const hits = pages
        .map((p) => {
          const ii = p.imageinfo?.[0]
          return ii ? { ...ii, title: p.title ?? '' } : null
        })
        .filter((ii): ii is CommonsImage => ii !== null)
        .filter((ii) => Boolean(ii.thumburl))
        .filter((ii) => ii.width >= 150)
        .filter((ii) => isImageFile(ii.url))
        // Reject diagrams and documents; a pinout is not a product photo.
        .filter((ii) => !LOOKS_LIKE_DOCUMENT.test(ii.title))
        // Reject photos whose title does not fit the part.
        .filter((ii) => isRelevantTitle(ii.title, query))
        .map((ii) => ii.thumburl)
        .filter(isSafeUrl)

      if (hits.length > 0) return hits
    } catch {
      // Try the next, simpler query.
    }
  }

  return []
}