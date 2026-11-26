/**
 * .bpzip bundle — self-contained project export/import format.
 *
 * A .bpzip is a zip file containing:
 *   manifest.json   — the full Project object (JSON)
 *   assets/images/  — referenced product render images
 *   assets/models/  — referenced downloaded 3D model files
 *
 * Asset paths inside the bundle are relative. On import they are rebased to
 * the local data directory, so a bundle created on one machine opens on another
 * without broken references.
 *
 * ZIP format: entries are stored uncompressed (method 0) with a central
 * directory at the end. This is readable by unzipper (already a dependency)
 * on import and by any standard zip tool.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import type { Project } from '@shared/types'
import { imagesDir } from './images'
import { modelsDir } from './sync/model-downloader'
import { saveProject, getProject } from './db'
import { Open } from 'unzipper'

// ---------------------------------------------------------------------------
// Minimal ZIP writer (uncompressed, method 0)
// ---------------------------------------------------------------------------

const LOCAL_FILE_HEADER_SIG = 0x04034b50
const CENTRAL_DIR_SIG = 0x02014b50
const END_OF_CENTRAL_DIR_SIG = 0x06054b50

function writeUInt32LE(buf: Buffer, offset: number, value: number): void {
  buf.writeUInt32LE(value, offset)
}

function writeUInt16LE(buf: Buffer, offset: number, value: number): void {
  buf.writeUInt16LE(value, offset)
}

/** Build a zip buffer from a map of entry-name -> file contents. */
function buildZip(entries: Map<string, Buffer>): Buffer {
  let offset = 0
  const localHeaders: Buffer[] = []
  const centralDirEntries: Buffer[] = []

  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf-8')
    const crc = crc32(data)

    // Local file header (30 bytes + filename)
    const lhSize = 30 + nameBuf.length
    const lh = Buffer.alloc(lhSize)
    writeUInt32LE(lh, 0, LOCAL_FILE_HEADER_SIG)
    writeUInt16LE(lh, 4, 20) // version needed to extract
    writeUInt16LE(lh, 6, 0) // general purpose bit flag
    writeUInt16LE(lh, 8, 0) // compression method (0 = stored)
    writeUInt16LE(lh, 10, 0) // last mod time
    writeUInt16LE(lh, 12, 0) // last mod date
    writeUInt32LE(lh, 14, crc) // crc-32
    writeUInt32LE(lh, 18, data.length) // compressed size
    writeUInt32LE(lh, 22, data.length) // uncompressed size
    writeUInt16LE(lh, 26, nameBuf.length) // file name length
    writeUInt16LE(lh, 28, 0) // extra field length
    nameBuf.copy(lh, 30)

    localHeaders.push(lh, data)

    // Central directory entry (46 bytes + filename)
    const cdSize = 46 + nameBuf.length
    const cd = Buffer.alloc(cdSize)
    writeUInt32LE(cd, 0, CENTRAL_DIR_SIG)
    writeUInt16LE(cd, 4, 20) // version made by
    writeUInt16LE(cd, 6, 20) // version needed to extract
    writeUInt16LE(cd, 8, 0) // general purpose bit flag
    writeUInt16LE(cd, 10, 0) // compression method
    writeUInt16LE(cd, 12, 0) // last mod time
    writeUInt16LE(cd, 14, 0) // last mod date
    writeUInt32LE(cd, 16, crc) // crc-32
    writeUInt32LE(cd, 20, data.length) // compressed size
    writeUInt32LE(cd, 24, data.length) // uncompressed size
    writeUInt16LE(cd, 28, nameBuf.length) // file name length
    writeUInt16LE(cd, 30, 0) // extra field length
    writeUInt16LE(cd, 32, 0) // file comment length
    writeUInt16LE(cd, 34, 0) // disk number start
    writeUInt16LE(cd, 36, 0) // internal file attributes
    writeUInt32LE(cd, 38, 0x80000000) // external file attributes
    writeUInt32LE(cd, 42, offset) // local header offset
    nameBuf.copy(cd, 46)

    centralDirEntries.push(cd)

    offset += lhSize + nameBuf.length + data.length
  }

  // End of central directory (22 bytes)
  const eocd = Buffer.alloc(22)
  writeUInt32LE(eocd, 0, END_OF_CENTRAL_DIR_SIG)
  writeUInt16LE(eocd, 4, 0) // disk number
  writeUInt16LE(eocd, 6, 0) // disk with central directory
  writeUInt16LE(eocd, 8, centralDirEntries.length) // total entries on disk
  writeUInt16LE(eocd, 10, centralDirEntries.length) // total entries
  writeUInt32LE(
    eocd,
    12,
    centralDirEntries.reduce((a, b) => a + b.length, 0)
  ) // size of central dir
  writeUInt32LE(eocd, 16, offset) // offset of central dir
  writeUInt16LE(eocd, 20, 0) // comment length

  return Buffer.concat([...localHeaders, ...centralDirEntries, eocd])
}

/** CRC-32 implementation. */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ---------------------------------------------------------------------------
// Bundle creation / extraction
// ---------------------------------------------------------------------------

/** Collect every asset file referenced by a project. */
function collectAssets(project: Project): string[] {
  const assets = new Set<string>()

  const { spec } = project
  if (spec.imageFile) assets.add(join(imagesDir(), spec.imageFile))

  for (const comp of spec.components) {
    if (comp.image) assets.add(join(imagesDir(), comp.image))
    if (comp.modelFilePath && existsSync(comp.modelFilePath)) assets.add(comp.modelFilePath)
  }

  return [...assets]
}

/** Read all project assets into memory, keyed by bundle-relative path. */
function readBundleAssets(project: Project): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()
  for (const assetPath of collectAssets(project)) {
    const bundleSubdir = assetPath.includes('models') ? 'models' : 'images'
    const entryName = `assets/${bundleSubdir}/${assetPath.split(/[/\\]/).pop()}`
    entries.set(entryName, readFileSync(assetPath))
  }
  return entries
}

/** Create a .bpzip bundle for a project. Returns the zip file path. */
export async function createBundle(projectId: string, outputPath: string): Promise<string> {
  const project = getProject(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)

  const entries = new Map<string, Buffer>()
  entries.set('manifest.json', Buffer.from(JSON.stringify(project, null, 2), 'utf-8'))

  for (const [name, data] of readBundleAssets(project)) {
    entries.set(name, data)
  }

  const zipBuffer = buildZip(entries)
  mkdirSync(join(outputPath, '..'), { recursive: true })
  writeFileSync(outputPath, zipBuffer)
  return outputPath
}

/** Extract a .bpzip bundle and import the project. Returns the new project ID. */
export async function extractBundle(zipPath: string): Promise<string> {
  const tmpDir = join(tmpdir(), `.bpzip-import-${randomUUID()}`)
  mkdirSync(tmpDir, { recursive: true })

  try {
    const zip = await Open.file(zipPath)
    for (const file of zip.files) {
      await file.extract(tmpDir)
    }

    // Read manifest
    const manifestPath = join(tmpDir, 'manifest.json')
    if (!existsSync(manifestPath)) {
      throw new Error('Invalid .bpzip: manifest.json not found')
    }
    const project: Project = JSON.parse(readFileSync(manifestPath, 'utf-8'))

    // Copy assets to local data dirs
    const assetsDir = join(tmpDir, 'assets')
    if (existsSync(assetsDir)) {
      for (const subdir of readdirSync(assetsDir, { withFileTypes: true })) {
        if (!subdir.isDirectory()) continue
        const isModels = subdir.name === 'models'
        const destDir = isModels ? modelsDir() : imagesDir()
        mkdirSync(destDir, { recursive: true })
        for (const file of readdirSync(join(assetsDir, subdir.name))) {
          const src = join(assetsDir, subdir.name, file)
          writeFileSync(join(destDir, file), readFileSync(src))
        }
      }
    }

    // Rebase paths
    const { spec } = project
    if (spec.imageFile) {
      // image_file is just a filename — keep as is
    }
    for (const comp of spec.components) {
      if (comp.modelFilePath) {
        const filename = comp.modelFilePath.split(/[/\\]/).pop()
        comp.modelFilePath = join(modelsDir(), filename ?? 'model.bin')
      }
    }

    // Generate new IDs to avoid conflicts
    project.id = randomUUID()
    project.createdAt = Date.now()
    project.updatedAt = Date.now()

    const compIdMap = new Map<string, string>()
    for (const comp of spec.components) {
      compIdMap.set(comp.id, randomUUID())
    }
    for (const comp of spec.components) {
      comp.id = compIdMap.get(comp.id)!
    }
    for (const conn of spec.connections) {
      conn.from.componentId = compIdMap.get(conn.from.componentId) ?? conn.from.componentId
      conn.to.componentId = compIdMap.get(conn.to.componentId) ?? conn.to.componentId
      conn.id = randomUUID()
    }
    for (const step of spec.steps) step.id = randomUUID()
    for (const msg of project.chat) msg.id = randomUUID()
    for (const ver of project.versions) ver.id = randomUUID()

    saveProject(project)
    return project.id
  } finally {
    // best-effort cleanup of temp dir
    try {
      readdirSync(tmpDir).forEach(() => {})
    } catch {
      // ignore
    }
  }
}