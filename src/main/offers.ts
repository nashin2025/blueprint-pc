import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths'
import {
  matchOffers,
  parseAdafruit,
  parseAliExpress,
  parseAmazonSearch,
  parseEbaySearch,
  rankOffers,
  type ParsedOffer
} from './offers-parse'
import { modelTokens, searchCandidates } from './partsearch-parse'
import { loadRenderedHtml } from './store-browser'

/**
 * Price comparison across retailers.
 *
 * Four stores are queried per part. What each one needs, measured rather than
 * assumed:
 *
 * - Adafruit and AliExpress answer plain `fetch`.
 * - eBay 403s plain `fetch` at its edge and only serves listings to a real
 *   browser, so it goes through a hidden window and is the slow path.
 * - Amazon answers only after the homepage has set its cookies, so it gets a
 *   warm-up navigation in the same window.
 *
 * Walmart is deliberately not queried. It was reachable, but its listings are
 * US-only and this user is in the Maldives, so a cheap Walmart price is not a
 * price they can actually pay. A comparison that cannot be acted on is noise.
 *
 * The rest are unreachable without an API key or an account: DigiKey, Mouser,
 * RobotShop and Newark 403; SparkFun, Pololu and Temu render prices
 * client-side; Temu additionally redirects every search to a login page.
 *
 * Retailer calls use the global fetch rather than net.fetch: Walmart serves a
 * 15 KB bot-challenge page to Chromium's network stack but the full results page
 * to Node's, which is the opposite of the certificate problem that affects
 * Wikimedia image lookups.
 *
 * AliExpress and Amazon geo-localise by IP and quote this user in MVR, so offers
 * arrive in mixed currencies and are ranked by their dollar equivalent. Anything
 * shown converted is labelled "≈" in the interface.
 *
 * Prices are scraped and therefore a snapshot, not a live quote. They are cached
 * for a day so opening the parts list twice does not re-scrape, and the UI says
 * as much next to the numbers.
 */

const ADAFRUIT_SEARCH = 'https://www.adafruit.com/'
const ALIEXPRESS_SEARCH = 'https://www.aliexpress.com/w/wholesale-'
const EBAY_SEARCH = 'https://www.ebay.com/sch/i.html?_nkw='
const AMAZON_HOME = 'https://www.amazon.com/'
const AMAZON_SEARCH = 'https://www.amazon.com/s?k='
const TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

interface CacheEntry {
  fetchedAt: number
  offers: ParsedOffer[]
  strict: boolean
  /** Null means the search term matched nothing; keep the miss cached. */
  searchTerm: string
}

function cachePath(): string {
  return join(dataDir(), 'offers.json')
}

function cacheKey(partName: string): string {
  return partName.trim().toLowerCase().replace(/\s+/g, ' ')
}

function readCache(): Record<string, CacheEntry> {
  const path = cachePath()
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, CacheEntry>) : {}
  } catch {
    return {}
  }
}

function writeCache(cache: Record<string, CacheEntry>): void {
  const path = cachePath()
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf-8')
  renameSync(tmp, path)
}

/**
 * The term to search a shop for.
 *
 * A model number is the best query a shop can receive, so it wins when the part
 * name has one. Otherwise fall back to the cleaned name, trimmed to a few words.
 */
export function searchTermFor(partName: string): string {
  const models = modelTokens(partName)
  if (models.length > 0) return models[0]

  const cleaned = searchCandidates(partName)[0] ?? partName
  return cleaned.split(' ').slice(0, 4).join(' ')
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/** Looks up cached offers, or fetches and caches them. */
export async function getOffers(
  partName: string,
  force = false
): Promise<{ offers: ParsedOffer[]; strict: boolean; searchTerm: string }> {
  const key = cacheKey(partName)
  const cache = readCache()
  const hit = cache[key]

  if (!force && hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return { offers: hit.offers, strict: hit.strict, searchTerm: hit.searchTerm }
  }

  const term = searchTermFor(partName)

  const [adafruitHtml, aliexpressHtml] = await Promise.all([
    fetchHtml(`${ADAFRUIT_SEARCH}?q=${encodeURIComponent(term)}&sort=BestMatch`),
    fetchHtml(`${ALIEXPRESS_SEARCH}${encodeURIComponent(term)}.html`)
  ])

  // eBay and Amazon are the slow path: both need a real browser, so they run only
  // when the plain-fetch stores came up empty or could only offer approximate
  // matches. They run as separate windows in parallel rather than in sequence.
  const parsed: ParsedOffer[] = [
    ...(adafruitHtml ? parseAdafruit(adafruitHtml, ADAFRUIT_SEARCH) : []),
    ...(aliexpressHtml ? parseAliExpress(aliexpressHtml, ALIEXPRESS_SEARCH) : [])
  ]

  let matched = matchOffers(parsed, partName)

  // eBay and Amazon are the slow path: both need a real browser, so they run only
  // when the plain-fetch stores came up empty or could only offer approximate
  // matches. They run as separate windows in parallel rather than in sequence.
  if (matched.offers.length === 0 || !matched.strict) {
    const query = encodeURIComponent(term)
    const [ebayHtml, amazonHtml] = await Promise.all([
      loadRenderedHtml(`${EBAY_SEARCH}${query}`, 'li.s-item, li.s-card'),
      // Amazon refuses the first search of a session until the homepage sets cookies.
      loadRenderedHtml(`${AMAZON_SEARCH}${query}`, 'div[data-component-type="s-search-result"]', {
        warmupUrl: AMAZON_HOME
      })
    ])

    const browserOffers: ParsedOffer[] = [
      ...(ebayHtml ? parseEbaySearch(ebayHtml) : []),
      ...(amazonHtml ? parseAmazonSearch(amazonHtml) : [])
    ]

    if (browserOffers.length > 0) {
      const merged = matchOffers([...parsed, ...browserOffers], partName)
      // Keep the browser results only when they actually improved on the fast stores.
      if (merged.offers.length > 0 && (merged.strict || matched.offers.length === 0)) {
        matched = merged
      }
    }
  }

  const ranked = rankOffers(matched.offers)

  cache[key] = { fetchedAt: Date.now(), offers: ranked, strict: matched.strict, searchTerm: term }
  // Keep the cache from growing without bound.
  const entries = Object.entries(cache)
  if (entries.length > 200) {
    const trimmed = entries
      .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
      .slice(0, 200)
    writeCache(Object.fromEntries(trimmed))
  } else {
    writeCache(cache)
  }

  return { offers: ranked, strict: matched.strict, searchTerm: term }
}
