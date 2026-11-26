import { BrowserWindow } from 'electron'

/**
 * Fetches a page through a real browser window.
 *
 * Some retailers answer a plain HTTP client with a refusal and answer Chromium
 * with a full page. This is the fallback for exactly those stores:
 *
 * - eBay 403s `fetch` at its edge but serves every listing to a browser.
 * - Amazon 503s the first search of a session and serves results once the
 *   homepage has set its cookies, which is what `warmupUrl` is for.
 *
 * Electron already ships the browser engine, so the window is used rather than
 * adding a scraping dependency.
 *
 * The window is off-screen and never shown. It is a real renderer, so it gets no
 * Node access and no preload, matching the isolation the main window uses.
 *
 * This is deliberately slower than `fetch` - it is the store-specific escape
 * hatch, not the default path.
 */

const DEFAULT_TIMEOUT_MS = 20_000

interface LoadOptions {
  timeoutMs?: number
  /** Loaded first, ignoring errors, so the store can set cookies before the real request. */
  warmupUrl?: string
}

function browserWindow(): BrowserWindow {
  return new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })
}

/** Loads one URL and resolves once the document is done, or false on failure. */
async function navigate(
  wc: Electron.WebContents,
  url: string,
  timeoutMs: number
): Promise<boolean> {
  const done = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    wc.once('did-finish-load', () => {
      clearTimeout(timer)
      resolve(true)
    })
    wc.once('did-fail-load', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })

  await wc.loadURL(url)
  return done
}

/**
 * Loads a URL and resolves with its rendered HTML.
 *
 * `waitForSelector` is required because "page finished loading" and "products are
 * in the DOM" are not the same event on these sites - results arrive after the
 * first paint. The wait polls in the page and resolves false on timeout instead
 * of rejecting, so a slow store degrades to "no offers".
 *
 * Resolves null when the store refused, timed out, or the window could not be
 * created. Never throws.
 */
export async function loadRenderedHtml(
  url: string,
  waitForSelector: string,
  options: LoadOptions = {}
): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let win: BrowserWindow | null = null

  try {
    win = browserWindow()
    const wc = win.webContents

    if (options.warmupUrl) {
      // A failed warm-up is not fatal: the real request may still succeed.
      await navigate(wc, options.warmupUrl, timeoutMs)
    }

    if (!(await navigate(wc, url, timeoutMs))) return null

    // Results render after the document load event, so wait for a product tile.
    const found = await wc.executeJavaScript(
      `new Promise((resolve) => {
        const selector = ${JSON.stringify(waitForSelector)};
        const deadline = Date.now() + ${Math.min(timeoutMs, 12_000)};
        const tick = () => {
          if (document.querySelector(selector)) return resolve(true);
          if (Date.now() > deadline) return resolve(false);
          setTimeout(tick, 150);
        };
        tick();
      })`,
      true
    )

    if (!found) return null

    const html = await wc.executeJavaScript('document.documentElement.outerHTML', true)
    return typeof html === 'string' ? html : null
  } catch {
    return null
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
  }
}