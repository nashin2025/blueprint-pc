/**
 * Pure helpers for vendor product images. No imports, so the self-check can
 * assert on them without touching the network or Electron.
 */

/**
 * Blocks URLs that point back into the machine or the local network.
 *
 * The model supplies these URLs, so treating them as untrusted is mandatory: a
 * "product page" pointing at 127.0.0.1 or a cloud metadata endpoint would turn
 * image fetching into a server-side request forgery primitive.
 */
export function isSafeUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (host === 'localhost' || host === '::1') return false
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false

  // IPv4 private and link-local ranges.
  if (/^127\./.test(host)) return false
  if (/^10\./.test(host)) return false
  if (/^192\.168\./.test(host)) return false
  if (/^169\.254\./.test(host)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
  if (/^0\./.test(host)) return false

  // IPv6 loopback and unique-local (fc00::/7).
  if (host === '::' || host === '::1') return false
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return false

  return true
}

const META_PATTERNS: RegExp[] = [
  // <meta property="og:image" content="...">
  /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/i,
  // <meta content="..." property="og:image">
  /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i
]

/**
 * Pulls the social preview image out of a product page. Returns an absolute URL,
 * resolving relative paths against the page URL.
 */
export function extractMetaImage(html: string, pageUrl: string): string | null {
  for (const re of META_PATTERNS) {
    const match = html.match(re)
    if (!match) continue
    const raw = match[1].trim()
    if (!raw) continue

    // Some sites put an HTML entity or escaped slash in the URL.
    const cleaned = raw.replace(/&amp;/g, '&').replace(/\\\//g, '/')

    try {
      const resolved = new URL(cleaned, pageUrl)
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        return resolved.toString()
      }
    } catch {
      // Try the next pattern.
    }
  }
  return null
}

/** True when a content-type header promises an image we can display. */
export function isImageContentType(contentType: string | null): boolean {
  if (!contentType) return false
  return /^image\/(png|jpe?g|webp|gif|avif|bmp)\b/i.test(contentType.trim())
}

/** Picks a file extension from a content type. */
export function extensionFor(contentType: string, fallbackUrl = ''): string {
  const ct = contentType.toLowerCase()
  if (ct.includes('png')) return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif')) return 'gif'
  if (ct.includes('avif')) return 'avif'
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg'

  const m = fallbackUrl.match(/\.(png|jpe?g|webp|gif|avif)(?:\?|$)/i)
  if (m) return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase()

  return 'jpg'
}