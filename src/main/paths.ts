import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One stable location for everything the app writes to disk.
 *
 * The naive version of this is `app.getPath('userData')`, but that path is
 * derived from the app's display name, which is NOT the same in every context:
 *   - dev (package.json "name")        -> %APPDATA%/blueprint-pc
 *   - packaged (productName "Blueprint PC") -> %APPDATA%/Blueprint PC
 * So a packaged build silently used a different, empty folder than the dev
 * build -- and a reinstall lost the catalogue. Anchoring to appData plus a
 * FIXED folder name makes every context resolve to the same place, so the
 * catalogue, projects and images survive both a packaging switch and a
 * reinstall.
 *
 * appData is the per-user roaming directory (%APPDATA% on Windows,
 * ~/.config on Linux, ~/Library/Application Support on macOS). We append a
 * fixed, lowercase, space-free folder name so the path never changes.
 */

const APP_FOLDER = 'blueprint-pc'

/** The app's own data root: <appData>/blueprint-pc. */
function appDataRoot(): string {
  return join(app.getPath('appData'), APP_FOLDER)
}

/** Where the app stores its mutable data: <appData>/blueprint-pc/data. */
export function dataDir(): string {
  const dir = join(appDataRoot(), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Where generated and cached images live: <appData>/blueprint-pc/data/images. */
export function imagesDir(): string {
  const dir = join(dataDir(), 'images')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}