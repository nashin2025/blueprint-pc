import { net } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import {
  extensionFor,
  extractMetaImage,
  isImageContentType,
  isSafeUrl
} from './partimage-parse'
import { imagesDir as sharedImagesDir } from './paths'
import { getCachedPartImage, searchCommonsImages, setCachedPartImage } from './partsearch'
import { getOffers } from './offers'

/**
 * Finds a product photo for a part, trying four sources in order:
 *
 *   1. A direct image URL supplied by the model
 *   2. The social preview image on the product page (a real vendor listing photo)
 *   3. A Wikimedia Commons search on the part name
 *   4. A retailer listing photo, from the same offers used for price comparison
 *
 * Sources 1 and 2 give shop photos but fail constantly: the model invents URLs
 * and vendors block scrapers. Commons is not commercial but it is reliable and
 * keyless, so it is the one that usually fills the table.
 *
 * Source 4 exists because Commons is a photo archive, not a shop: a generic
 * catalogue part like a "0.96 inch I2C OLED module" has no Commons entry at all,
 * while the shops selling it have a perfectly good product photo. That photo is
 * already fetched for the price comparison, so this costs nothing extra and it
 * turns "no picture" into the actual item.
 *
 * Every result is cached by part name, so each photo is looked up once per
 * machine.
 *
 * All requests go through Electron's net.fetch rather than the global fetch:
 * Electron's bundled CA store rejects some certificate chains outright
 * (Wikimedia returns CERT_HAS_EXPIRED) while the OS trust store accepts them.
 *
 * Returns null rather than throwing when nothing is found. A missing photo must
 * never break a parts list.
 */

const FETCH_TIMEOUT_MS = 12_000
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const SAFE_NAME = /^[a-f0-9-]{36}\.(png|jpe?g|webp|gif|avif)$/

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif'
}

function imagesDir(): string {
  return sharedImagesDir()
}

async function fetchAsImage(url: string): Promise<{ base64: string; ext: string } | null> {
  const res = await net.fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'image/*,*/*;q=0.8' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow'
  })

  if (!res.ok) return null

  const contentType = res.headers.get('content-type')
  if (!isImageContentType(contentType)) return null

  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return null

  return { base64: buffer.toString('base64'), ext: extensionFor(contentType ?? '', url) }
}

function store(base64: string, ext: string): string {
  const filename = `${randomUUID()}.${ext}`
  writeFileSync(join(imagesDir(), filename), Buffer.from(base64, 'base64'))
  return filename
}

/**
 * Finds a product photo for a part.
 *
 * Each source is tried in turn and any failure falls through to the next: a bad
 * model URL must not prevent the Commons lookup, and a blocked vendor page must
 * not either.
 */
export async function resolvePartImage(
  imageUrl: string | undefined,
  productUrl: string | undefined,
  searchQuery?: string
): Promise<string | null> {
  // 1. A direct image URL from the model, when it actually resolves.
  if (imageUrl && isSafeUrl(imageUrl)) {
    try {
      const direct = await fetchAsImage(imageUrl)
      if (direct) return store(direct.base64, direct.ext)
    } catch {
      // Fall through.
    }
  }

  // 2. The social preview image on the product page.
  if (productUrl && isSafeUrl(productUrl)) {
    try {
      const res = await net.fetch(productUrl, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow'
      })
      if (res.ok) {
        const html = await res.text()
        const meta = extractMetaImage(html, productUrl)
        if (meta && isSafeUrl(meta)) {
          const embedded = await fetchAsImage(meta)
          if (embedded) return store(embedded.base64, embedded.ext)
        }
      }
    } catch {
      // Fall through to the search.
    }
  }

  // 3. Commons. The reliable one.
  const query = (searchQuery ?? '').trim()
  if (query.length >= 3) {
    const cached = getCachedPartImage(query)
    if (cached && loadImageDataUrl(cached)) return cached

    try {
      const candidates = await searchCommonsImages(query)
      for (const candidate of candidates.slice(0, 4)) {
        try {
          const hit = await fetchAsImage(candidate)
          if (hit) {
            const filename = store(hit.base64, hit.ext)
            setCachedPartImage(query, filename)
            return filename
          }
        } catch {
          // Try the next candidate.
        }
      }
    } catch {
      return null
    }
  }

  // 4. A shop's own product photo. Last resort, because it runs a price
  // comparison to find one, but it is the only source that covers generic
  // catalogue parts. Failures here are swallowed: no photo is better than a
  // broken parts list.
  const shopPhoto = await shopImageFor(query)
  if (shopPhoto) {
    try {
      const hit = await fetchAsImage(shopPhoto)
      if (hit) {
        const filename = store(hit.base64, hit.ext)
        setCachedPartImage(query, filename)
        return filename
      }
    } catch {
      // Fall through to null.
    }
  }

  return null
}

/**
 * The first retailer listing photo for a part, or null.
 *
 * Reuses the price-comparison cache, so in the common case where the parts list
 * has already been opened this is a local read rather than a network call.
 */
async function shopImageFor(partName: string): Promise<string | null> {
  try {
    const result = await getOffers(partName)
    const withImage = result.offers.find(
      (offer) => typeof offer.imageUrl === 'string' && offer.imageUrl.length > 0
    )
    const url = withImage?.imageUrl
    return url && isSafeUrl(url) ? url : null
  } catch {
    return null
  }
}

/** Reads a stored part image back as a data URL, or null. */
export function loadImageDataUrl(filename: string): string | null {
  if (!SAFE_NAME.test(filename)) return null
  const path = join(imagesDir(), filename)
  if (!existsSync(path)) return null
  const mime = MIME_BY_EXT[extname(filename).toLowerCase()] ?? 'image/jpeg'
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`
}