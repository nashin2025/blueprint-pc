/**
 * Model file downloader.
 *
 * Downloads 3D model files (.stl, .obj, .gltf, .glb) from a URL into a local
 * `models/` directory under the app data folder, and saves the local path back
 * to the catalogue database so Three.js can load from disk (file://) instead of
 * fetching a remote URL every time.
 *
 * Politeness rules (same discipline as the Schematik sync and SnapEDA
 * discovery):
 *   - 400 ms gap between source requests
 *   - 40 parts per run, resumable across runs via sync_state
 *   - Never throws at the caller; every failure is counted and reported
 *
 * IMPORTANT: This only downloads files from URLs you already have. There is
 * no automated source for 6000+ CAD files (SnapEDA=403, GrabCAD=login,
 * Printables/Thingiverse=403, manufacturers=CAPTCHA). Paste a direct model
 * URL into a part row, then click Download to store it locally.
 */

import { database, saveModelFilePath } from '../catalogue/db'
import { dataDir } from '../paths'
import { join } from 'node:path'
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream'
import { promisify } from 'node:util'

const streamPipeline = promisify(pipeline)

const MODEL_DIR_NAME = 'models'

/** Minimum gap between source requests. Slow on purpose. */
const REQUEST_GAP_MS = 400
/** Parts attempted per download run. Keeps one run short and resumable. */
const DEFAULT_BATCH = 40

const UA = 'BlueprintPC/0.1 (local desktop app; personal model cache)'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Local directory for downloaded model files: <appData>/blueprint-pc/data/models. */
export function modelsDir(): string {
  const dir = join(dataDir(), MODEL_DIR_NAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Sanitize a URL into a safe filename. Keeps the extension. */
function urlToFilename(url: string): string {
  try {
    const parsed = new URL(url)
    const base = parsed.pathname.split('/').pop() || 'model'
    // Strip query string and extension, then append the real extension
    const name = base.split('?')[0].split('#')[0]
    const ext = name.split('.').pop() || 'bin'
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_')
    return `${safeName}.${ext}`
  } catch {
    return `model_${Date.now()}.bin`
  }
}

/** Supported model file extensions. */
const MODEL_EXTS = ['.stl', '.obj', '.gltf', '.glb']

function isModelUrl(url: string): boolean {
  const base = url.split('?')[0].split('#')[0].toLowerCase()
  return MODEL_EXTS.some((ext) => base.endsWith(ext))
}

export interface ModelDownloadProgress {
  total: number
  known: number
  toDownload: number
  done: number
  saved: number
  failed: number
  blocked: number
  running: boolean
  message: string
}

let status: ModelDownloadProgress = {
  total: 0,
  known: 0,
  toDownload: 0,
  done: 0,
  saved: 0,
  failed: 0,
  blocked: 0,
  running: false,
  message: 'not started'
}

export function modelDownloadStatus(): ModelDownloadProgress {
  return { ...status }
}

let lastCall = 0

async function throttle(): Promise<void> {
  const wait = REQUEST_GAP_MS - (Date.now() - lastCall)
  if (wait > 0) await sleep(wait)
  lastCall = Date.now()
}

/**
 * Download one model file from a URL to the local models directory.
 * Returns the local file path, or null on failure.
 */
export async function downloadModelFile(url: string): Promise<string | null> {
  if (!isModelUrl(url)) return null

  const filename = urlToFilename(url)
  const dest = join(modelsDir(), filename)

  // Skip if already downloaded.
  if (existsSync(dest)) return dest

  await throttle()

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      signal: AbortSignal.timeout(60_000)
    })
    if (!res.ok) return null
    if (!res.body) return null

    await streamPipeline(res.body as any, createWriteStream(dest))
    return dest
  } catch {
    return null
  }
}

/**
 * One bounded, resumable download pass.
 *
 * Each run attempts at most `batch` parts that have a model_url but no
 * local model_file_path. Progress is written after every part.
 */
export async function runModelDownload(batch = DEFAULT_BATCH): Promise<ModelDownloadProgress> {
  if (status.running) return status
  status = {
    ...status,
    running: true,
    done: 0,
    saved: 0,
    failed: 0,
    blocked: 0,
    message: 'reading catalogue'
  }

  try {
    const conn = database()

    // Parts with a model_url but no local file downloaded yet.
    const allSlugs = conn
      .prepare(
        `SELECT slug, name, model_url FROM parts WHERE model_url IS NOT NULL AND model_file_path IS NULL ORDER BY name`
      )
      .all() as { slug: string; name: string; model_url: string }[]

    status.total = allSlugs.length
    status.known = 0
    status.toDownload = allSlugs.length
    status.message = `${allSlugs.length} parts with a model URL but no local file`

    const target = allSlugs.slice(0, batch)

    for (const part of target) {
      await throttle()

      try {
        const localPath = await downloadModelFile(part.model_url)
        if (!localPath) {
          status.failed++
          status.message = `${status.saved} saved, ${status.failed} failed`
          continue
        }

        saveModelFilePath(part.slug, localPath)
        status.done++
        status.saved++
        status.message = `${status.saved} saved, ${status.failed} failed`
      } catch {
        status.failed++
        status.message = `${status.saved} saved, ${status.failed} failed`
      }
    }

    setState('last_model_download_at', String(Date.now()))
    setState('last_model_download_done', String(status.saved))
    status.running = false
    status.message = `saved ${status.saved}, failed ${status.failed}`
  } catch (err) {
    status.running = false
    status.message = err instanceof Error ? err.message : 'model download failed'
  }

  return status
}

function setState(key: string, value: string): void {
  try {
    database()
      .prepare(
        'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, value)
  } catch {
    // sync_state table may not exist yet
  }
}
