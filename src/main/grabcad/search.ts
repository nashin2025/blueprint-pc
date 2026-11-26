/**
 * GrabCAD part search module.
 *
 * Searches the GrabCAD Community Library by part name using Playwright
 * (the library page is JS-rendered Angular, so simple fetch won't work).
 * Extracts model IDs from search results for use with the community API v1.
 *
 * Search URL: https://grabcad.com/library?query=<name>&page=1&per_page=100
 * Model detail URL: https://grabcad.com/library/<model-slug>
 */

import { chromium, type Browser } from 'playwright'

const SEARCH_URL = 'https://grabcad.com/library'

let browser: Browser | null = null

const headless = process.env.GRABCAD_HEADLESS !== 'false'

/**
 * Ensure a browser is running for search operations.
 */
async function ensureBrowser(): Promise<Browser> {
  if (browser) return browser
  browser = await chromium.launch({ headless, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  return browser
}

/**
 * Close the search browser.
 */
export function closeSearchBrowser(): void {
  if (browser) {
    try { browser.close() } catch { /* ignore */ }
    browser = null
  }
}

/**
 * Search GrabCAD library by part name.
 *
 * Returns an array of { id, name, url } for matching models.
 * The `id` is the numeric model ID used with the community API v1.
 */
export async function searchGrabcadParts(
  query: string,
  sessionCookie: string | null
): Promise<{ ok: true; data: { id: string; name: string; url: string }[] } | { ok: false; error: string }> {
  try {
    const br = await ensureBrowser()
    const context = await br.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    })

    // Set session cookie if authenticated
    if (sessionCookie) {
      await context.addCookies([{
        name: '_grabcad_session',
        value: sessionCookie,
        domain: 'grabcad.com',
        path: '/'
      }])
    }

    const page = await context.newPage()

    // Build search URL
    const encodedQuery = encodeURIComponent(query)
    const url = `${SEARCH_URL}?query=${encodedQuery}&page=1&per_page=100`

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Wait for search results to render (Angular JS)
    // Results contain links with class "modelLink" or similar
    await page.waitForTimeout(3000)

    // Try multiple selectors for model links
    const modelLinks = await page.locator('a[href*="/library/"]').all()

    const results: { id: string; name: string; url: string }[] = []
    const seen = new Set<string>()

    for (const link of modelLinks) {
      const href = await link.getAttribute('href').catch(() => null)
      if (!href) continue

      // Extract model ID from URL like /library/esp32-devkit-v1
      const match = href.match(/\/library\/([^/?#]+)/)
      if (!match) continue

      const slug = match[1]
      if (seen.has(slug)) continue
      seen.add(slug)

      // Extract a readable name from the link text or slug
      const text = (await link.textContent().catch(() => ''))?.trim() || slug
      const name = text.length > 100 ? text.substring(0, 100) : text

      results.push({
        id: slug, // Use slug as ID for now; we'll resolve numeric ID via API if needed
        name,
        url: href.startsWith('http') ? href : `https://grabcad.com${href}`
      })

      if (results.length >= 20) break
    }

    await context.close()

    return { ok: true, data: results }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Search failed with unknown error'
    }
  }
}

/**
 * Resolve a model slug to its numeric ID using the community API v1.
 *
 * The model detail page URL is like https://grabcad.com/library/<slug>.
 * We call https://grabcad.com/community/api/v1/models/<slug> to get the
 * full model JSON including archive_url.
 */
export async function resolveModelBySlug(
  slug: string,
  sessionCookie: string
): Promise<{ ok: true; data: { id: number; name: string; archiveUrl: string | null } } | { ok: false; error: string }> {
  try {
    const apiUrl = `https://grabcad.com/community/api/v1/models/${encodeURIComponent(slug)}`

    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Cookie': `_grabcad_session=${sessionCookie}`
      },
      signal: AbortSignal.timeout(30000)
    })

    if (!res.ok) {
      return { ok: false, error: `API returned ${res.status} for model ${slug}` }
    }

    const data = await res.json() as any

    return {
      ok: true,
      data: {
        id: data.id ?? 0,
        name: data.name ?? slug,
        archiveUrl: data.archive_url ?? null
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : `Failed to resolve model ${slug}`
    }
  }
}
