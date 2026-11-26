/**
 * GrabCAD authentication module.
 *
 * Logs in to GrabCAD via Playwright (handles JS rendering, CSRF tokens,
 * and cookie management automatically) and captures the _grabcad_session
 * cookie for subsequent API calls.
 *
 * The session cookie is valid for 2 days from last use. After that,
 * re-authentication is required.
 *
 * Credentials are used only for the login request and session cookie
 * capture — they are never written to disk. The session cookie lives
 * in memory only.
 */

import { chromium, type Browser } from 'playwright'

const LOGIN_URL = 'https://grabcad.com/community/login?return=true'

// In-memory session cookie. Populated after a successful login.
let sessionCookie: string | null = null
let browser: Browser | null = null

/** Browser launch options. Headless by default. Set GRABCAD_HEADLESS=false to see the browser. */
const headless = process.env.GRABCAD_HEADLESS !== 'false'

/**
 * Log in to GrabCAD and capture the session cookie.
 *
 * @param email - GrabCAD account email
 * @param password - GrabCAD account password
 * @returns { ok: true, data: { cookie: string } } or { ok: false, error: string }
 */
export async function login(email: string, password: string): Promise<{ ok: true; data: { cookie: string } } | { ok: false; error: string }> {
  try {
    // Close any existing browser first
    if (browser) {
      try { await browser.close() } catch { /* ignore */ }
      browser = null
    }

    browser = await chromium.launch({ headless, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const context = await browser.newContext({
      acceptDownloads: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    })
    const page = await context.newPage()

    // Navigate to login page
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Fill in credentials. GrabCAD community login uses name="member[email]" and name="member[password]".
    await page.fill('input[name="member[email]"]', email, { timeout: 10000 })
    await page.fill('input[name="member[password]"]', password, { timeout: 10000 })

    // Submit the form. The Sign In button is #signInButton / button.sign-in__button.
    // No reCAPTCHA on this page; the button is enabled on load.
    const submitButton = page.locator('#signInButton, button.sign-in__button')
    await submitButton.click({ timeout: 10000 })

    // Wait for navigation away from login page (success) or error message
    await page.waitForTimeout(3000)

    // Check if we're still on the login page (login failed)
    const currentUrl = page.url()
    const hasError = await page.locator('.alert, .error, .flash-error, [data-test="error"]').count() > 0

    if (hasError || currentUrl.includes('login')) {
      const errorText = await page.locator('.alert, .error, .flash-error').first().textContent().catch(() => null)
      await browser.close()
      browser = null
      return {
        ok: false,
        error: errorText ? `Login failed: ${errorText}` : 'Login failed — still on login page after submission'
      }
    }

    // Extract the _grabcad_session cookie
    const cookies = await context.cookies()
    const sessionCookieEntry = cookies.find((c) => c.name === '_grabcad_session')

    if (!sessionCookieEntry) {
      await browser.close()
      browser = null
      return {
        ok: false,
        error: 'Login succeeded but _grabcad_session cookie not found'
      }
    }

    sessionCookie = sessionCookieEntry.value
    await browser.close()
    browser = null

    return { ok: true, data: { cookie: sessionCookie } }
  } catch (err) {
    if (browser) {
      try { await browser.close() } catch { /* ignore */ }
      browser = null
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Login failed with unknown error'
    }
  }
}

/** Get the current session cookie, or null if not logged in. */
export function getSessionCookie(): string | null {
  return sessionCookie
}

/** Clear the session cookie (logout). */
export function logout(): void {
  sessionCookie = null
  if (browser) {
    try { browser.close() } catch { /* ignore */ }
    browser = null
  }
}

/** Check if we have an active session. */
export function isAuthenticated(): boolean {
  return sessionCookie !== null
}
