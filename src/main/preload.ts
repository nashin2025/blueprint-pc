import { contextBridge, ipcRenderer } from 'electron'
import type { CartItem, Component } from '@shared/types'
import type {
  AppSettings,
  CadDiscoveryProgress,
  CataloguePart,
  CatalogueSummary,
  Connection,
  DesignSpec,
  DesignVersion,
  DielectricStackup,
  DrcViolation,
  Footprint,
  GenerateRequest,
  HierarchicalBlock,
  InfoRequest,
  IpcResult,
  ModelDownloadProgress,
  ModelLookup,
  OfferResult,
  Project,
  Sheet,
  SheetPort,
  SiTraceResult,
  SyncProgress,
  CrosstalkResult,
  ThermalResult,
  LibraryHealthReport,
  Variant,
  BomAlternative,
  BomLineItem,
  Eco,
  KeepInZone,
  KeepOutZone,
  Enclosure
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

  projectsExportSpec: (projectId: string): Promise<IpcResult<{ spec: string }>> =>
    ipcRenderer.invoke('projects:export-spec', projectId),

  projectsImportSpec: (args: { spec: string }): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke('projects:import-spec', args),

  projectsExportJson: (projectId: string): Promise<IpcResult<{ json: string }>> =>
    ipcRenderer.invoke('projects:export-json', projectId),

  projectsImportJson: (args: { json: string }): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke('projects:import-json', args),

  projectsReadFile: (filePath: string): Promise<IpcResult<{ content: string }>> =>
    ipcRenderer.invoke('projects:read-file', filePath),

  pcbExportGerber: (projectId: string): Promise<IpcResult<{ files: Record<string, string>; unrouted: any[]; boardW: number; boardH: number }>> =>
    ipcRenderer.invoke('pcb:export-gerber', projectId),

  pcbPickPlace: (args: { projectId: string }): Promise<IpcResult<{ csv: string }>> =>
    ipcRenderer.invoke('pcb:pick-place', args),

  pcbDrcRealtime: (args: {
    trace: { net: string; from: { componentId: string; pinName: string }; to: { componentId: string; pinName: string }; points: Array<{ x: number; y: number }> }
    existingTraces: Array<{ net: string; from: { componentId: string; pinName: string }; to: { componentId: string; pinName: string }; points: Array<{ x: number; y: number }> }>
    pads: Array<{ componentId: string; pinName: string; center: { x: number; y: number }; w: number; h: number }>
    rules?: { traceWidth: number; traceClearance: number; padToTraceClearance: number; viaToTraceClearance: number; minAnnularRing: number }
  }): Promise<IpcResult<{ violations: Array<{ id: string; severity: string; category: string; message: string; net?: string; location?: { x: number; y: number } }> }>> =>
    ipcRenderer.invoke('pcb:drc-realtime', args),

  pcbExportStep: (projectId: string): Promise<IpcResult<{ step: string; boardW: number; boardH: number; boardThickness: number }>> =>
    ipcRenderer.invoke('pcb:export-step', projectId),

  pcbExportIpc2581: (projectId: string): Promise<IpcResult<{ xml: string }>> =>
    ipcRenderer.invoke('pcb:export-ipc2581', projectId),

  pcbRoutePushShove: (projectId: string): Promise<IpcResult<unknown>> =>
    ipcRenderer.invoke('pcb:route-push-shove', projectId),

  pcbRouteDifferentialPair: (args: {
    projectId: string
    pNet: string
    nNet: string
    separationMm: number
    targetLengthMm?: number
    fromPin: { componentId: string; pinName: string }
    toPin: { componentId: string; pinName: string }
  }): Promise<IpcResult<unknown>> =>
    ipcRenderer.invoke('pcb:route-differential-pair', args),

  mechCheckClearance: (args: { projectId: string; clearance: number }): Promise<IpcResult<{
    componentClearance: Array<{ componentId1: string; componentId2: string; distance: number; clearance: number; violation: boolean }>
    edgeClearance: Array<{ componentId: string; distance: number; clearance: number; violation: boolean }>
    clearance: number
  }>> => ipcRenderer.invoke('mech:clearance-check', args),

  mechSaveZones: (args: {
    projectId: string
    keepInZones: KeepInZone[]
    keepOutZones: KeepOutZone[]
    enclosure: Enclosure | null
  }): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke('mech:save-zones', args),
  mechGetZones: (projectId: string): Promise<IpcResult<{
    keepInZones: KeepInZone[]
    keepOutZones: KeepOutZone[]
    enclosure: Enclosure | null
  }>> => ipcRenderer.invoke('mech:get-zones', { projectId }),
  mechEnclosureCollision: (projectId: string): Promise<IpcResult<{
    collisions: Array<{ componentId: string; distance: number }>
  }>> => ipcRenderer.invoke('mech:enclosure-collision', { projectId }),

  pcbCheckClearance: (args: { projectId: string; clearance: number }): Promise<
    IpcResult<{
      violations: Array<{
        componentId1: string
        componentId2: string
        name1: string
        name2: string
        distance: number
        clearance: number
      }>
      clearance: number
    }>
  > => ipcRenderer.invoke('pcb:clearance-check', args),

  pcbMeasureDistance: (args: { projectId: string; compId1: string; compId2: string }): Promise<
    IpcResult<{ componentId1: string; componentId2: string; distance: number }>
  > => ipcRenderer.invoke('pcb:measure-distance', args),

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

  showDataFolder: (): Promise<boolean> => ipcRenderer.invoke('app:showDataFolder'),
  openFilePicker: (): Promise<{ canceled: boolean; filePath?: string }> =>
    ipcRenderer.invoke('app:openFilePicker'),

  // Cart
  cartGetOrCreate: (projectId: string): Promise<IpcResult<{ id: string; createdAt: number; updatedAt: number }>> =>
    ipcRenderer.invoke('cart:getOrCreate', projectId),
  cartAdd: (args: { cartId: string; componentId: string; quantity?: number; retailerUrl?: string }): Promise<IpcResult<void>> =>
    ipcRenderer.invoke('cart:add', args),
  cartRemove: (args: { cartId: string; componentId: string }): Promise<IpcResult<{ removed: boolean }>> =>
    ipcRenderer.invoke('cart:remove', args),
  cartList: (cartId: string): Promise<IpcResult<CartItem[]>> =>
    ipcRenderer.invoke('cart:list', cartId),
  cartClear: (cartId: string): Promise<IpcResult<void>> =>
    ipcRenderer.invoke('cart:clear', cartId),
  cartExport: (cartId: string): Promise<IpcResult<string>> =>
    ipcRenderer.invoke('cart:export', cartId),

  // DRC
  designRunDrc: (projectId: string): Promise<IpcResult<{ violations: DrcViolation[]; summary: { total: number; errors: number; warnings: number; infos: number; clean: boolean } }>> =>
    ipcRenderer.invoke('design:run-drc', projectId),

  // Design versions
  designSaveVersion: (args: { projectId: string; label: string; prompt?: string }): Promise<IpcResult<{ id: string; createdAt: number }>> =>
    ipcRenderer.invoke('design:save-version', args),
  designListVersions: (projectId: string): Promise<IpcResult<DesignVersion[]>> =>
    ipcRenderer.invoke('design:list-versions', projectId),
  designRestoreVersion: (args: { projectId: string; versionId: string }): Promise<IpcResult<Project>> =>
    ipcRenderer.invoke('design:restore-version', args),
  designDiffVersions: (args: { projectId: string; versionId1: string; versionId2: string }): Promise<IpcResult<{ diff: any; v1: DesignVersion; v2: DesignVersion }>> =>
    ipcRenderer.invoke('design:diff-versions', args),

  designExportNetlist: (projectId: string): Promise<IpcResult<{ netlist: string }>> =>
    ipcRenderer.invoke('design:export-netlist', projectId),

  // Sheets
  sheetsAddSheet: (projectId: string, name: string): Promise<IpcResult<{ project: Project; sheet: Sheet }>> =>
    ipcRenderer.invoke('sheets:add-sheet', { projectId, name }),
  sheetsRenameSheet: (projectId: string, sheetId: string, name: string): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke('sheets:rename-sheet', { projectId, sheetId, name }),
  sheetsDeleteSheet: (projectId: string, sheetId: string): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke('sheets:delete-sheet', { projectId, sheetId }),
  sheetsAddPort: (args: {
    projectId: string
    sheetId: string
    name: string
    direction: 'input' | 'output'
  }): Promise<IpcResult<{ project: Project; port: SheetPort }>> =>
    ipcRenderer.invoke('sheets:add-port', args),
  sheetsConnectPort: (args: {
    projectId: string
    portId1: string
    portId2: string
  }): Promise<IpcResult<{ project: Project; connection: Connection }>> =>
    ipcRenderer.invoke('sheets:connect-port', args),

  // Hierarchical design
  hierarchicalCreateBlock: (args: {
    projectId: string
    block: HierarchicalBlock
  }): Promise<IpcResult<{ project: Project; block: HierarchicalBlock }>> =>
    ipcRenderer.invoke('hierarchical:create-block', args),
  hierarchicalSaveBlock: (args: {
    projectId: string
    block: HierarchicalBlock
  }): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke('hierarchical:save-block', args),
  hierarchicalDeleteBlock: (args: {
    projectId: string
    blockId: string
  }): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke('hierarchical:delete-block', args),
  hierarchicalExpandBlock: (args: {
    projectId: string
    componentId: string
  }): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke('hierarchical:expand-block', args),
  hierarchicalGetBlock: (args: {
    projectId: string
    blockId: string
  }): Promise<IpcResult<{ block: HierarchicalBlock }>> =>
    ipcRenderer.invoke('hierarchical:get-block', args),
  hierarchicalFlatten: (projectId: string): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke('hierarchical:flatten', projectId),

  // Annotation / ECO
  annotationBuildLinks: (args: {
    projectId: string
    placementDesignators: Array<{ placementId: string; designator: string }>
  }): Promise<IpcResult<{ links: Array<{
    componentId: string
    designator: string
    placementId: string | null
    footprintId: string | null
    schematicNet: string | null
    pcbNet: string | null
  }> }>> =>
    ipcRenderer.invoke('annotation:build-links', args),
  annotationFindDivergences: (args: {
    links: Array<{
      componentId: string
      designator: string
      placementId: string | null
      footprintId: string | null
      schematicNet: string | null
      pcbNet: string | null
    }>
    pcbFootprints: Array<{ placementId: string; footprintId: string }>
    pcbNets: Array<{ placementId: string; net: string }>
  }): Promise<IpcResult<{ divergences: Array<{
    type: string
    componentId: string
    designator: string
    message: string
    severity: string
  }> }>> =>
    ipcRenderer.invoke('annotation:find-divergences', args),
  annotationGenerateEco: (args: {
    divergences: Array<{
      type: string
      componentId: string
      designator: string
      message: string
      severity: string
    }>
  }): Promise<IpcResult<{ eco: { id: string; createdAt: number; actions: Array<{
    type: string
    designator: string
    newValue: string | null
    oldValue: string | null
  }>; divergences: Array<{ type: string; componentId: string; designator: string; message: string; severity: string }>; autoResolvable: boolean } }>> =>
    ipcRenderer.invoke('annotation:generate-eco', args),
  annotationBackward: (args: {
    pcbPlacements: Array<{
      componentId: string
      designator: string
      footprintId: string | null
      net: string | null
    }>
    projectId: string
  }): Promise<IpcResult<{ divergences: Array<{ type: string; componentId: string; designator: string; message: string; severity: string }> }>> =>
    ipcRenderer.invoke('annotation:backward', args),

  // Variants / alternate BOM
  variantsCreate: (args: {
    id: string
    name: string
    description: string | null
    baseVariantId: string | null
    active: boolean
  }): Promise<IpcResult<{ variant: Variant }>> =>
    ipcRenderer.invoke('variants:create', args),
  variantsAddOverride: (args: {
    variant: Variant
    designator: string
    partNumber: string | null
    footprintId: string | null
    unitPrice: number | null
    notes: string | null
  }): Promise<IpcResult<{ variant: Variant }>> =>
    ipcRenderer.invoke('variants:add-override', args),
  variantsRemoveOverride: (args: {
    variant: Variant
    designator: string
  }): Promise<IpcResult<{ variant: Variant }>> =>
    ipcRenderer.invoke('variants:remove-override', args),
  variantsGenerateBom: (args: {
    components: Component[]
    variant: Variant
    alternates: BomAlternative[]
  }): Promise<IpcResult<{ bom: BomLineItem[] }>> =>
    ipcRenderer.invoke('variants:generate-bom', args),
  variantsCompareBoms: (args: {
    bomA: BomLineItem[]
    bomB: BomLineItem[]
  }): Promise<IpcResult<{ diffs: Array<{
    designator: string
    field: string
    valueA: string | null
    valueB: string | null
  }> }>> =>
    ipcRenderer.invoke('variants:compare-boms', args),

  // Footprints
  footprintsAdd: (args: { projectId: string; footprint: Footprint }): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke('footprints:add', args),
  footprintsUpdate: (args: { projectId: string; footprint: Footprint }): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke('footprints:update', args),
  footprintsDelete: (args: { projectId: string; footprintId: string }): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke('footprints:delete', args),
  footprintsGenerateLandPattern: (args: { kind: string; params: Record<string, number> }): Promise<IpcResult<{ footprint: Footprint }>> =>
    ipcRenderer.invoke('footprints:generate-land-pattern', args),

  // Signal integrity
  siAnalyseTrace: (args: {
    traceWidthMm: number
    traceLengthMm: number
    stackup: DielectricStackup
    targetImpedanceOhms?: number
    aggressorTrace?: {
      widthMm: number
      separationMm: number
      heightMm: number
      lengthMm: number
      er: number
      riseTimeNs: number
    }
  }): Promise<IpcResult<{ result: SiTraceResult }>> =>
    ipcRenderer.invoke('si:analyse-trace', args),
  siEstimateCrosstalk: (args: {
    widthMm: number
    separationMm: number
    heightMm: number
    lengthMm: number
    er: number
    riseTimeNs: number
  }): Promise<IpcResult<{ result: CrosstalkResult }>> =>
    ipcRenderer.invoke('si:estimate-crosstalk', args),
  siReflectionCoefficient: (args: { z1Ohms: number; z2Ohms: number }): Promise<IpcResult<{ gamma: number }>> =>
    ipcRenderer.invoke('si:reflection-coefficient', args),
  siPropagationDelay: (args: { effectiveEr: number; lengthMm: number }): Promise<IpcResult<{ delayNs: number }>> =>
    ipcRenderer.invoke('si:propagation-delay', args),

  // Thermal
  thermalAnalyseComponent: (args: {
    ambientC: number
    powerW: number
    tJMaxC: number
    packageType: string
  }): Promise<IpcResult<{ result: ThermalResult }>> =>
    ipcRenderer.invoke('thermal:analyse-component', args),
  thermalPowerFromVI: (args: { voltageV: number; currentA: number }): Promise<IpcResult<{ powerW: number }>> =>
    ipcRenderer.invoke('thermal:power-from-vi', args),
  thermalPowerFromIR: (args: { currentA: number; resistanceOhm: number }): Promise<IpcResult<{ powerW: number }>> =>
    ipcRenderer.invoke('thermal:power-from-ir', args),
  thermalBoardTemperature: (args: {
    ambientC: number
    totalPowerW: number
    boardRjaCPerW: number
  }): Promise<IpcResult<{ boardTemperatureC: number; temperatureRiseC: number }>> =>
    ipcRenderer.invoke('thermal:board-temperature', args),

  // Library management
  libraryHealthReport: (): Promise<IpcResult<{ report: LibraryHealthReport }>> =>
    ipcRenderer.invoke('library:health-report'),
  libraryUpdateLifecycle: (args: {
    slug: string
    lifecycle: 'active' | 'preview' | 'nrnd' | 'obsolete'
  }): Promise<IpcResult<{ slug: string; lifecycle: string }>> =>
    ipcRenderer.invoke('library:update-lifecycle', args),

  // Project import/export (.bpjson)
  pcbExportProjectJson: (projectId: string): Promise<IpcResult<{ json: string }>> =>
    ipcRenderer.invoke('projects:export-json', projectId),
  pcbSaveProjectJson: (args: { projectId: string; outputPath: string }): Promise<IpcResult<{ outputPath: string }>> =>
    ipcRenderer.invoke('projects:save-json', args),
  pcbImportProjectJson: (args: { json: string }): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke('projects:import-json', args),

  // ECO (Engineering Change Order)
  ecoApply: (args: { projectId: string; eco: Eco }): Promise<IpcResult<{ project: Project }>> =>
    ipcRenderer.invoke('eco:apply', args),

  // Real-time collaboration
  collab: {
    start: (port?: number): Promise<IpcResult<{ port: number }>> =>
      ipcRenderer.invoke('collaboration:start', port),
    stop: (): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('collaboration:stop'),
    status: (): Promise<IpcResult<{ running: boolean; port: number | null; clientCount: number }>> =>
      ipcRenderer.invoke('collaboration:status')
  },

  // Offline-first sync
  sync: {
    status: (): Promise<IpcResult<{ online: boolean; pendingEdits: number }>> =>
      ipcRenderer.invoke('sync:status'),
    flush: (): Promise<IpcResult<{ flushed: number }>> =>
      ipcRenderer.invoke('sync:flush')
  }
}

export type Bridge = typeof api

contextBridge.exposeInMainWorld('api', api)