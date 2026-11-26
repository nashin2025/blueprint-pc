import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  CadDiscoveryProgress,
  CataloguePart,
  CatalogueSummary,
  DesignSpec,
  GenerateRequest,
  InfoRequest,
  IpcResult,
  ModelDownloadProgress,
  ModelLookup,
  OfferResult,
  Project,
  SyncProgress
} from '@shared/types'

/**
 * The only surface the renderer gets. No ipcRenderer, no node, no fs - just
 * these named methods. Adding a channel here means adding it to the preload's
 * allowlist, which is the point: the renderer cannot reach anything not listed.
 */

const api = {
  listProjects: (includeArchived?: boolean): Promise<Project[]> =>
    ipcRenderer.invoke('projects:list', includeArchived ?? false),
  getProject: (id: string): Promise<Project | null> => ipcRenderer.invoke('projects:get', id),
  saveProject: (project: Project): Promise<Project> => ipcRenderer.invoke('projects:save', project),
  deleteProject: (id: string): Promise<boolean> => ipcRenderer.invoke('projects:delete', id),
  archiveProject: (id: string, archived: boolean): Promise<boolean> =>
    ipcRenderer.invoke('projects:archive', { id, archived }),
  purgeProject: (id: string): Promise<boolean> => ipcRenderer.invoke('projects:purge', id),
  duplicateProject: (id: string): Promise<Project> =>
    ipcRenderer.invoke('projects:duplicate', id),
  exportProject: (args: { id: string; outputPath: string }): Promise<string> =>
    ipcRenderer.invoke('projects:export', args),
  importProject: (zipPath: string): Promise<string> =>
    ipcRenderer.invoke('projects:import', zipPath),

  loadSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings: AppSettings): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:save', settings),

  generate: (req: GenerateRequest): Promise<IpcResult<DesignSpec>> =>
    ipcRenderer.invoke('design:generate', req),

  listNvidiaModels: (apiKey: string): Promise<IpcResult<string[]>> =>
    ipcRenderer.invoke('nvidia:models', apiKey),

  summarizeInfo: (req: InfoRequest): Promise<IpcResult<string>> =>
    ipcRenderer.invoke('info:summarize', req),

  generateProductImage: (req: InfoRequest): Promise<IpcResult<string>> =>
    ipcRenderer.invoke('info:image', req),

  loadImage: (filename: string): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke('images:load', filename),

  resolvePartImage: (args: {
    imageUrl?: string
    productUrl?: string
    query?: string
  }): Promise<IpcResult<string | null>> => ipcRenderer.invoke('partimage:resolve', args),

  getOffers: (partName: string, force?: boolean): Promise<IpcResult<OfferResult>> =>
    ipcRenderer.invoke('offers:get', partName, force),

  catalogue: {
    status: (): Promise<
      IpcResult<{ progress: SyncProgress; lastSyncAt: number | null; count: number }>
    > => ipcRenderer.invoke('catalogue:status'),
    search: (query: string, limit?: number): Promise<IpcResult<CatalogueSummary[]>> =>
      ipcRenderer.invoke('catalogue:search', { query, limit }),
    get: (slug: string): Promise<IpcResult<CataloguePart | null>> =>
      ipcRenderer.invoke('catalogue:get', slug),
    sync: (batch?: number): Promise<IpcResult<SyncProgress>> =>
      ipcRenderer.invoke('catalogue:sync', batch),
    refreshPart: (slug: string): Promise<IpcResult<{ slug: string; name: string; fetchedAt: number }>> =>
      ipcRenderer.invoke('catalogue:refresh-part', slug),
    staleParts: (maxAgeDays: number): Promise<IpcResult<Array<{ slug: string; name: string; fetchedAt: number }>>> =>
      ipcRenderer.invoke('catalogue:stale-parts', maxAgeDays),
    findModelUrl: (args: { productUrl: string; partName?: string }): Promise<IpcResult<string | null>> =>
      ipcRenderer.invoke('catalogue:find-model-url', args),
    cadDiscoveryStatus: (): Promise<IpcResult<CadDiscoveryProgress>> =>
      ipcRenderer.invoke('catalogue:cad-discovery-status'),
    runCadDiscovery: (batch?: number): Promise<IpcResult<CadDiscoveryProgress>> =>
      ipcRenderer.invoke('catalogue:run-cad-discovery', batch),
    lookupModel: (args: { name: string; partNumber?: string }): Promise<IpcResult<ModelLookup>> =>
      ipcRenderer.invoke('catalogue:lookup-model', args),
    downloadModelByUrl: (args: { modelUrl: string }): Promise<IpcResult<string | null>> =>
      ipcRenderer.invoke('catalogue:download-model-by-url', args),
    modelDownloadStatus: (): Promise<IpcResult<ModelDownloadProgress>> =>
      ipcRenderer.invoke('catalogue:model-download-status'),
    runModelDownload: (batch?: number): Promise<IpcResult<ModelDownloadProgress>> =>
      ipcRenderer.invoke('catalogue:run-model-download', batch),
    grabcad: {
      status: (): Promise<IpcResult<{ authenticated: boolean }>> =>
        ipcRenderer.invoke('catalogue:grabcad-status'),
      login: (args: { email: string; password: string }): Promise<IpcResult<{ cookie: string }>> =>
        ipcRenderer.invoke('catalogue:grabcad-login', args),
      logout: (): Promise<IpcResult<null>> =>
        ipcRenderer.invoke('catalogue:grabcad-logout'),
      search: (args: { query: string }): Promise<IpcResult<{ id: string; name: string; url: string }[]>> =>
        ipcRenderer.invoke('catalogue:grabcad-search', args),
      download: (args: { slug: string }): Promise<IpcResult<{ slug: string; archiveUrl: string; files: string[]; extractDir: string; localFile: string | null }>> =>
        ipcRenderer.invoke('catalogue:grabcad-download', args)
    }
  },

  showDataFolder: (): Promise<boolean> => ipcRenderer.invoke('app:showDataFolder')
}

export type Bridge = typeof api

contextBridge.exposeInMainWorld('api', api)