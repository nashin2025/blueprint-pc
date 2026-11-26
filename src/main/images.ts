import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { imagesDir as sharedImagesDir } from './paths'

/**
 * Product renders are written to disk as image files rather than inlined into
 * projects.json. A 1024px JPEG base64 is a few hundred KB, and every version of
 * a project would carry its own copy, so the JSON would balloon fast.
 *
 * They are read back as data URLs through IPC. That keeps the renderer's
 * Content-Security-Policy tight (no custom protocol, no file:// access) at the
 * cost of one small round trip per image.
 */

const SAFE_NAME = /^[a-f0-9-]{36}\.(png|jpg|jpeg|webp|gif|avif)$/

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif'
}

/** The app's own images directory: <appData>/blueprint-pc/data/images. */
export function imagesDir(): string {
  return sharedImagesDir()
}

function extForMime(mime: string): string {
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  return 'jpg'
}

/** Stores a base64 image and returns the filename to record in the design. */
export function saveImage(base64: string, mime: string): string {
  const filename = `${randomUUID()}.${extForMime(mime)}`
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length === 0) throw new Error('Image payload was empty.')
  writeFileSync(join(imagesDir(), filename), buffer)
  return filename
}

/** Reads an image back as a data URL, or null when it is missing or malformed. */
export function loadImageDataUrl(filename: string): string | null {
  // The name comes from our own database, but it is still validated: a
  // traversal payload must not be able to read arbitrary files off disk.
  if (!SAFE_NAME.test(filename)) return null

  const path = join(imagesDir(), filename)
  if (!existsSync(path)) return null

  const mime = MIME_BY_EXT[extname(filename).toLowerCase()] ?? 'image/jpeg'
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`
}

/**
 * Deletes stored images that no project or version points at any more.
 *
 * Every regenerated render writes a new file, and nothing ever removed the old
 * one, so the folder grew by ~150 KB per regeneration forever. Called once at
 * startup; the caller supplies the set of filenames still in use.
 */
export function pruneImages(referenced: Set<string>): number {
  const dir = imagesDir()
  if (!existsSync(dir)) return 0

  let removed = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (!SAFE_NAME.test(entry.name)) continue
    if (referenced.has(entry.name)) continue
    try {
      unlinkSync(join(dir, entry.name))
      removed++
    } catch {
      // A locked or vanished file is not worth failing startup over.
    }
  }
  return removed
}