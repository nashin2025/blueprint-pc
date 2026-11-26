import { ipcMain, shell } from 'electron'
import { store } from './store'
import { loadSettings, saveSettings } from './settings'
import { requestDesign, LlmError, listNvidiaModels } from './ai/llm'
import { normaliseDesign } from './ai/normalise'
import { generateImage, generateSummary } from './ai/info'
import { loadImageDataUrl, saveImage } from './images'
import { resolvePartImage } from './partimages'
import { getOffers } from './offers'
import { countParts, getPart, lookupModel, searchParts, saveModelFilePathByUrl } from './catalogue/db'
import { lastSyncAt, runSync, syncStatus } from './sync/schematik'
import { cadDiscoveryStatus, runCadDiscovery } from './sync/cad-discovery'
import { modelDownloadStatus, runModelDownload, downloadModelFile } from './sync/model-downloader'
import { searchSnapedaPart, getSnapeda3dUrl } from './snapeda'
import { login, logout, getSessionCookie, isAuthenticated } from './grabcad/auth'
import { searchGrabcadParts } from './grabcad/search'
import { getModelArchiveUrl, downloadAndExtractModel } from './grabcad/download'
import type { AppSettings, DesignSpec, GenerateRequest, InfoRequest, Project } from '@shared/types'
import { createBundle, extractBundle } from './zip'

/**
 * Every IPC channel is registered once at startup. Each handler returns an
 * IpcResult so the renderer never has to distinguish "threw" from "returned a
 * falsy value" - it always gets { ok, data } or { ok, error }.
 */

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof LlmError) return { ok: false, error: err.message }
  if (err instanceof Error) return { ok: false, error: err.message }
  return { ok: false, error: 'Something went wrong.' }
}

const MODEL_EXTS = ['.stl', '.obj', '.gltf', '.glb']

function endsWithModelExt(url: string): boolean {
  const base = url.split('?')[0].split('#')[0].toLowerCase()
  return MODEL_EXTS.some((ext) => base.endsWith(ext))
}

/** Fetches a product page (main process, so no CORS) and returns the first direct
 *  link to a downloadable 3D model file, or null when none is found. A missing
 *  model is a normal outcome, not an error. */
async function findModelUrl(productUrl: string): Promise<string | null> {
  let controller: AbortController | null = null
  try {
    controller = new AbortController()
    const timer = setTimeout(() => controller?.abort(), 15000)
    const res = await fetch(productUrl, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const html = await res.text()
    const base = new URL(productUrl)
    const seen = new Set<string>()
    const attrRe = /(?:href|src)=["']([^"']+)["']/gi
    let match: RegExpExecArray | null
    while ((match = attrRe.exec(html)) !== null) {
      const raw = match[1]
      if (!raw || raw.startsWith('data:')) continue
      let abs: string
      try {
        abs = new URL(raw, base).href
      } catch {
        continue
      }
      if (seen.has(abs)) continue
      seen.add(abs)
      if (endsWithModelExt(abs)) return abs
    }
    return null
  } catch {
    return null
  } finally {
    controller = null
  }
}

export function registerIpc(): void {
  ipcMain.handle('projects:list', async (): Promise<Project[]> => {
    return store.list()
  })

  ipcMain.handle('projects:get', async (_e, id: string) => {
    return store.get(id)
  })

  ipcMain.handle('projects:save', async (_e, project: Project) => {
    return store.save(project)
  })

  ipcMain.handle('projects:delete', async (_e, id: string) => {
    return store.delete(id)
  })

  ipcMain.handle('projects:archive', async (_e, args: { id: string; archived: boolean }) => {
    return store.archive(args.id, args.archived)
  })

  ipcMain.handle('projects:purge', async (_e, id: string) => {
    return store.purge(id)
  })

  ipcMain.handle('projects:duplicate', async (_e, id: string) => {
    return store.duplicate(id)
  })

  ipcMain.handle('projects:export', async (_e, args: { id: string; outputPath: string }) => {
    return await createBundle(args.id, args.outputPath)
  })

  ipcMain.handle('projects:import', async (_e, zipPath: string) => {
    return await extractBundle(zipPath)
  })

  ipcMain.handle('settings:load', async (): Promise<AppSettings> => {
    return loadSettings()
  })

  ipcMain.handle('settings:save', async (_e, settings: AppSettings) => {
    return saveSettings(settings)
  })

  ipcMain.handle('offers:get', async (_e, partName: string, force?: boolean) => {
    try {
      const result = await getOffers(partName, force === true)
      return { ok: true as const, data: result }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('app:showDataFolder', async () => {
    await shell.showItemInFolder(store.dataFilePath())
    return true
  })

  ipcMain.handle('design:generate', async (_e, req: GenerateRequest) => {
    try {
      const raw = await requestDesign({
        provider: req.provider,
        apiKey: req.apiKey,
        model: req.model,
        prompt: req.prompt,
        currentSpec: req.currentSpec
      })
      const spec: DesignSpec = normaliseDesign(raw)
      return { ok: true as const, data: spec }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('nvidia:models', async (_e, apiKey: string) => {
    try {
      const models = await listNvidiaModels(apiKey)
      return { ok: true as const, data: models }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('info:summarize', async (_e, req: InfoRequest) => {
    try {
      const summary = await generateSummary(req.spec, {
        provider: req.provider,
        apiKey: req.apiKey,
        model: req.model
      })
      return { ok: true as const, data: summary }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('info:image', async (_e, req: InfoRequest) => {
    try {
      const image = await generateImage(req.spec, {
        provider: req.provider,
        apiKey: req.apiKey,
        model: req.model
      })
      // Persist on disk and hand back only the filename, so projects.json stays
      // small even when a design is regenerated several times.
      const imageFile = saveImage(image.base64, image.mime)
      return { ok: true as const, data: imageFile }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('images:load', async (_e, filename: string) => {
    return { ok: true as const, data: loadImageDataUrl(filename) }
  })

  ipcMain.handle('partimage:resolve', async (_e, args: { imageUrl?: string; productUrl?: string; query?: string }) => {
    try {
      // Returns null for "no photo found", which is a normal outcome, not an error.
      const filename = await resolvePartImage(args.imageUrl, args.productUrl, args.query)
      return { ok: true as const, data: filename }
    } catch (err) {
      return fail(err)
    }
  })

  // -------------------------------------------------------------------------
  // Local parts catalogue
  // -------------------------------------------------------------------------

  ipcMain.handle('catalogue:status', async () => {
    try {
      return {
        ok: true as const,
        data: { progress: syncStatus(), lastSyncAt: lastSyncAt(), count: countParts() }
      }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:search', async (_e, args: { query: string; limit?: number }) => {
    try {
      return { ok: true as const, data: searchParts(args.query, args.limit ?? 20) }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:get', async (_e, slug: string) => {
    try {
      return { ok: true as const, data: getPart(slug) }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:sync', async (_e, batch?: number) => {
    try {
      // The sync is slow by design; it does not block startup.
      const progress = await runSync(batch)
      return { ok: true as const, data: progress }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:find-model-url', async (_e, args: { productUrl: string; partName?: string }) => {
    try {
      // 1. Try the part's product page first: scrape direct .stl/.obj/.gltf/.glb links.
      const pageModelUrl = await findModelUrl(args.productUrl)
      if (pageModelUrl) return { ok: true as const, data: pageModelUrl }

      // 2. Fall back to SnapEDA: search by part name, then extract the signed
      //    S3 GLB URL from its 3D viewer page. Keyless, no account needed.
      //    SnapEDA is behind Cloudflare (403) - blocked is reported so the UI
      //    can tell the user manual paste is the reliable path.
      if (args.partName) {
        const part = await searchSnapedaPart(args.partName)
        if (part.ok && part.data) {
          const snapedaUrl = await getSnapeda3dUrl(part.data.modelId, part.data.unipartId)
          if (snapedaUrl.ok && snapedaUrl.data) return { ok: true as const, data: snapedaUrl.data }
        }
        // SnapEDA blocked (403) or no match - fall through to return null.
        // The blocked flag isn't surfaced here; cad-discovery-status covers it.
      }

      // null = no model link found anywhere, which is a normal outcome.
      return { ok: true as const, data: null }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:cad-discovery-status', async () => {
    try {
      return { ok: true as const, data: cadDiscoveryStatus() }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:run-cad-discovery', async (_e, batch?: number) => {
    try {
      const progress = await runCadDiscovery(batch)
      return { ok: true as const, data: progress }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:lookup-model', async (_e, args: { name: string; partNumber?: string }) => {
    try {
      const result = lookupModel(args.name, args.partNumber)
      return { ok: true as const, data: result }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:download-model-by-url', async (_e, args: { modelUrl: string }) => {
    try {
      const localPath = await downloadModelFile(args.modelUrl)
      if (!localPath) return { ok: false, error: 'Download failed' }
      saveModelFilePathByUrl(args.modelUrl, localPath)
      return { ok: true as const, data: localPath }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:model-download-status', async () => {
    try {
      return { ok: true as const, data: modelDownloadStatus() }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:run-model-download', async (_e, batch?: number) => {
    try {
      const progress = await runModelDownload(batch)
      return { ok: true as const, data: progress }
    } catch (err) {
      return fail(err)
    }
  })

  // -------------------------------------------------------------------------
  // GrabCAD Community Library (authenticated, Playwright-backed)
  // -------------------------------------------------------------------------

  ipcMain.handle('catalogue:grabcad-status', async () => {
    try {
      return { ok: true as const, data: { authenticated: isAuthenticated() } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:grabcad-login', async (_e, args: { email: string; password: string }) => {
    try {
      return await login(args.email, args.password)
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:grabcad-logout', async () => {
    try {
      logout()
      return { ok: true as const, data: null }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:grabcad-search', async (_e, args: { query: string }) => {
    try {
      const sessionCookie = getSessionCookie()
      if (!sessionCookie) {
        return { ok: false, error: 'Not logged in to GrabCAD. Sign in first.' }
      }
      return await searchGrabcadParts(args.query, sessionCookie)
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:grabcad-download', async (_e, args: { slug: string }) => {
    try {
      const sessionCookie = getSessionCookie()
      if (!sessionCookie) {
        return { ok: false, error: 'Not logged in to GrabCAD. Sign in first.' }
      }

      // 1. Resolve the model slug to its CloudFront archive URL.
      const archiveRes = await getModelArchiveUrl(args.slug, sessionCookie)
      if (!archiveRes.ok) return { ok: false, error: archiveRes.error }

      // 2. Download the ZIP from CloudFront and extract CAD files to disk.
      const downloadRes = await downloadAndExtractModel(archiveRes.data.archiveUrl, args.slug)
      if (!downloadRes.ok) return { ok: false, error: downloadRes.error }

      // Save the first extracted CAD file path back to the catalogue DB keyed
      // by model URL, so future lookups can find it. We don't have a catalogue
      // slug for a GrabCAD model, so we key by the archive URL instead.
      const firstFile = downloadRes.data.files[0]
      if (firstFile) {
        saveModelFilePathByUrl(archiveRes.data.archiveUrl, firstFile)
      }

      return {
        ok: true as const,
        data: {
          slug: args.slug,
          archiveUrl: archiveRes.data.archiveUrl,
          files: downloadRes.data.files,
          extractDir: downloadRes.data.zipPath,
          localFile: firstFile ?? null
        }
      }
    } catch (err) {
      return fail(err)
    }
  })
}