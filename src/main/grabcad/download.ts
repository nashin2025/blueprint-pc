/**
 * GrabCAD model download module.
 *
 * Given a model slug and session cookie:
 * 1. Calls community API v1 to get archive_url
 * 2. Downloads original.zip from CloudFront CDN
 * 3. Extracts ZIP to local models directory
 * 4. Returns paths to extracted CAD files (STEP, STL, IGES, etc.)
 *
 * CloudFront URL pattern:
 *   https://d2t1xqejof9utc.cloudfront.net/cads/files/{archive_url_part}/original.zip
 */

import { createWriteStream, mkdirSync, unlinkSync } from 'node:fs'
import { pipeline } from 'node:stream'
import { promisify } from 'node:util'
import { dirname } from 'node:path'
import * as unzipper from 'unzipper'

import { modelsDir } from '../sync/model-downloader'

const streamPipeline = promisify(pipeline)

const CLOUDFRONT_BASE = 'https://d2t1xqejof9utc.cloudfront.net/cads/files'

/** CAD file extensions we care about. */
const CAD_EXTS = ['.stp', '.step', '.stl', '.iges', '.igs', '.obj', '.x_t', '.x_b', '.3mf']

function isCadFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase()
  return ext ? CAD_EXTS.includes(ext) : false
}

/**
 * Resolve a model slug to its archive URL via community API v1.
 */
export async function getModelArchiveUrl(
  slug: string,
  sessionCookie: string
): Promise<{ ok: true; data: { archiveUrl: string } } | { ok: false; error: string }> {
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

    if (!data.archive_url) {
      return { ok: false, error: `No archive_url for model ${slug}` }
    }

    return { ok: true, data: { archiveUrl: data.archive_url } }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : `Failed to get archive URL for ${slug}`
    }
  }
}

/**
 * Download a ZIP from CloudFront and extract CAD files to the local models directory.
 * Returns paths to extracted CAD files.
 */
export async function downloadAndExtractModel(
  archiveUrl: string,
  modelId: string | number
): Promise<{ ok: true; data: { files: string[]; zipPath: string } } | { ok: false; error: string }> {
  try {
    // Build CloudFront download URL
    // archive_url might be like "/cads/files/abc123" or just an ID
    // Extract the meaningful part after the last /
    const parts = archiveUrl.split('/')
    const lastPart = parts[parts.length - 1]
    // The CloudFront URL uses the part after the last = in archive_url
    const fileId = lastPart.split('=').pop() ?? lastPart
    const downloadUrl = `${CLOUDFRONT_BASE}/${fileId}/original.zip`

    const zipFilename = `grabcad_${modelId}_${Date.now()}.zip`
    const zipPath = `${modelsDir()}/${zipFilename}`

    // Download ZIP
    const res = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(120000)
    })

    if (!res.ok) {
      return { ok: false, error: `Download returned ${res.status} for ${downloadUrl}` }
    }
    if (!res.body) {
      return { ok: false, error: 'No response body from download' }
    }

    await streamPipeline(res.body as any, createWriteStream(zipPath))

    // Extract ZIP and find CAD files
    const extractDir = `${modelsDir()}/grabcad_${modelId}_${Date.now()}`
    mkdirSync(extractDir, { recursive: true })

    const directory = await unzipper.Open.file(zipPath)

    const cadFiles: string[] = []
    for (const entry of directory.files) {
      if (!isCadFile(entry.path)) continue
      // Extract to subdirectory preserving structure
      const targetPath = `${extractDir}/${entry.path}`
      mkdirSync(dirname(targetPath), { recursive: true })
      await entry.extract(targetPath)
      cadFiles.push(targetPath)
    }

    // Clean up ZIP after extraction
    try { unlinkSync(zipPath) } catch { /* ignore */ }

    if (cadFiles.length === 0) {
      return { ok: false, error: `No CAD files found in ZIP for model ${modelId}` }
    }

    return { ok: true, data: { files: cadFiles, zipPath: extractDir } }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : `Failed to download/extract model ${modelId}`
    }
  }
}
