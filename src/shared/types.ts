/**
 * Shared types used by both the Electron main process and the React renderer.
 * This is the contract for a hardware design project: the shape the AI returns
 * and the shape we persist to disk.
 */

export type Difficulty = 'beginner' | 'intermediate' | 'advanced'

export type ConnectionKind = 'power' | 'ground' | 'signal' | 'data'

export interface PinRef {
  componentId: string
  pin: string
}

export interface Component {
  /** Stable local id, assigned by us (not the AI). */
  id: string
  name: string
  /** Catalogue part name when the AI matched a real purchasable part. */
  partName?: string
  category: string
  subcategory?: string
  quantity: number
  unitPrice?: number
  /** Currency for unitPrice, defaults to 'USD'. */
  unitPriceCurrency?: string
  url?: string
  /** Direct URL to a 3D model file (.stl, .obj, .gltf, .glb), auto-discovered from
   *  the product page or pasted by the user. Persisted with the project. */
  modelUrl?: string
  /** Local filesystem path to a downloaded copy of the model file. When present,
   *  Three.js loads from disk (file://) instead of fetching the remote URL. */
  modelFilePath?: string
  image?: string
  datasheet?: string
  /** Reference designator, e.g. "R1", "C2", "U1". Assigned when added to a project. */
  designator?: string
  /** Id of the footprint (land pattern) this component uses on the PCB. */
  footprintId?: string
  pins: string[]
  notes?: string
}

/** One solder pad in a component footprint (land pattern). All values in mm. */
export interface FootprintPad {
  id: string
  /** Pad centre X relative to the footprint origin (body centre). */
  x: number
  /** Pad centre Y relative to the footprint origin (body centre). */
  y: number
  /** Pad width, mm. */
  w: number
  /** Pad height, mm. */
  h: number
  shape: 'rect' | 'round' | 'oval'
}

/** A component footprint / land pattern, with pad array and body outline. */
export interface Footprint {
  id: string
  name: string
  description?: string
  pads: FootprintPad[]
  outlineW: number
  outlineH: number
  createdAt: number
}

/** Kind of land pattern to generate. */
export type FootprintKind = 'sop' | 'dip' | 'qfn' | 'smd-resistor' | 'smd-capacitor' | 'custom'

/** Parameters for generating a land pattern. */
export interface LandPatternParams {
  type: FootprintKind
  /** Number of pins/pads. Even for SOP/DIP, multiple of 4 for QFN. */
  pinCount?: number
  /** Centre-to-centre pitch between adjacent pads, mm. */
  pitch?: number
  /** Body width, mm. */
  bodyWidth?: number
  /** Body height, mm. */
  bodyHeight?: number
  /** Pad width, mm (extent sticking out from the body edge). */
  padWidth?: number
  /** Pad length, mm (extent running along the body edge). */
  padLength?: number
  /** Clearance from the body edge to the inner edge of the pad, mm. */
  padToBodyClearance?: number
  /** Optional centre thermal pad for QFN. */
  centerPad?: { w: number; h: number }
  /** Explicit pad list for the 'custom' type. */
  customPads?: Array<{ x: number; y: number; w: number; h: number }>
}

export interface Connection {
  id: string
  from: PinRef
  to: PinRef
  kind: ConnectionKind
  /** Net name, e.g. "5V", "GND", "SDA". Used for rail inference and labels. */
  net?: string
  label?: string
  /** Optional sheet this connection lives on (multi-sheet designs). */
  sheetId?: string
}

/** A connection point on a sheet that can link to a port on another sheet. */
export interface SheetPort {
  id: string
  sheetId: string
  name: string
  x: number
  y: number
  direction: 'input' | 'output'
}

/** One sheet in a multi-sheet schematic. Groups connections and ports. */
export interface Sheet {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  connectionIds: string[]
  portIds: string[]
}

export interface AssemblyStep {
  id: string
  order: number
  title: string
  body: string
  /** Components this step touches, for highlighting. */
  componentIds: string[]
}

export interface BomItem {
  componentId: string
  name: string
  partName?: string
  category: string
  quantity: number
  unitPrice?: number
  url?: string
}

export interface DesignSpec {
  title: string
  summary: string
  difficulty: Difficulty
  /** Rough time estimate, free text, e.g. "a weekend". */
  estimatedTime?: string
  /** Rough cost estimate in USD, derived from the BOM when prices are known. */
  estimatedCost?: number
  components: Component[]
  connections: Connection[]
  steps: AssemblyStep[]
  /** Filename inside the app's image directory, set when an AI product render exists. */
  imageFile?: string
  /** Longer, page-style description of the finished product. */
  infoSummary?: string
  /** Sheets in a multi-sheet design. Each sheet groups connections and ports. */
  sheets?: Sheet[]
  /** Sheet-to-sheet port connectors. */
  ports?: SheetPort[]
  /** Component footprints (land patterns) available to this design. */
  footprints?: Footprint[]
}

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
}

export interface DesignVersion {
  id: string
  label: string
  createdAt: number
  spec: DesignSpec
  /** The chat turn that produced this version, when applicable. */
  prompt?: string
}

export interface Project {
  id: string
  createdAt: number
  updatedAt: number
  archived: boolean
  spec: DesignSpec
  chat: ChatMessage[]
  versions: DesignVersion[]
}

export interface AppSettings {
  /** 'gemini' | 'openai' | 'nvidia' */
  provider: AIProviderId
  geminiApiKey: string
  geminiModel: string
  openaiApiKey: string
  openaiModel: string
  nvidiaApiKey: string
  nvidiaModel: string
  /** Model used for the product render on the Info tab. */
  imageModel: string
  /** Off by default: image generation is slow and provider-dependent. */
  enableImages: boolean
}

export type AIProviderId = 'gemini' | 'openai' | 'nvidia'

/** Payload the renderer sends when asking the main process to generate. */
export interface GenerateRequest {
  prompt: string
  provider: AIProviderId
  apiKey: string
  model: string
  /** Existing design to refine, when this is a chat turn rather than a fresh build. */
  currentSpec?: DesignSpec
}

/** Payload for the Info tab: a description and a product render of a design. */
export interface InfoRequest {
  spec: DesignSpec
  provider: AIProviderId
  apiKey: string
  model: string
}

// ---------------------------------------------------------------------------
// Local parts catalogue
// ---------------------------------------------------------------------------

export interface CataloguePin {
  type: string | null
  label: string
  voltage: string | null
  function: string | null
  required: boolean
  connectsTo: string | null
}

export interface CataloguePart {
  slug: string
  name: string
  brand: string | null
  partNumber: string | null
  description: string | null
  category: string | null
  priceText: string | null
  priceValue: number | null
  priceCurrency: string | null
  url: string | null
  image: string | null
  lastmod: string | null
  fetchedAt: number
  pinout: CataloguePin[]
}

/** A search result: enough to choose a part without loading all its detail. */
export interface CatalogueSummary {
  slug: string
  name: string
  brand: string | null
  category: string | null
  priceText: string | null
  hasDescription: boolean
  pinCount: number
  /** When this part was last fetched from Schematik, for staleness UI. */
  fetchedAt: number
}

export interface SyncProgress {
  total: number
  known: number
  toFetch: number
  done: number
  failed: number
  running: boolean
  message: string
}

export interface CadDiscoveryProgress {
  total: number
  known: number
  toDiscover: number
  done: number
  found: number
  failed: number
  blocked: number
  running: boolean
  message: string
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

export interface ModelLookup {
  modelUrl: string | null
  modelFilePath: string | null
}

/** The raw shape we ask the model for. We assign ids ourselves afterwards. */
export interface GeneratedSpec {
  title: string
  summary: string
  difficulty: Difficulty
  estimatedTime?: string
  components: Array<Omit<Component, 'id'>>
  connections: Array<{
    from: { componentIndex: number; pin: string }
    to: { componentIndex: number; pin: string }
    kind: ConnectionKind
    net?: string
    label?: string
  }>
  steps: Array<Omit<AssemblyStep, 'id' | 'order'>>
}

export interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: string
}
/** One purchasable offer found for a part, from a specific retailer. */
export interface StoreOffer {
  store: string
  name: string
  price: number
  currency: string
  url: string
  inStock: boolean
  /** Present when the listing exposed a product photo. */
  imageUrl?: string
}

/** Result of a retailer price comparison for one part. */
export interface OfferResult {
  offers: StoreOffer[]
  /** False when only loose (approximate) matches were found. */
  strict: boolean
  /** The search term actually used, useful when debugging a bad lookup. */
  searchTerm: string
  /** Unix ms when the offers were last fetched from retailer pages. Used for
   *  staleness warnings in the UI (prices older than 7 days are flagged). */
  fetchedAt: number
}

/** An item in the shopping cart. */
export interface CartItem {
  id: string
  componentId: string
  componentName: string
  componentPartName: string | null
  quantity: number
  retailerUrl: string | null
  addedAt: number
  unitPrice: number | null
  unitPriceCurrency: string
  /** Supplier lead time in days, set by the user when adding a part to cart. */
  leadTimeDays: number | null
}

/** A DRC violation found during design rule checking. */
export interface DrcViolation {
  id: string
  severity: 'error' | 'warning' | 'info'
  category: string
  message: string
  componentId?: string
  componentName?: string
  pinName?: string
  designator?: string
}

/** Summary of DRC results. */
export interface DrcSummary {
  total: number
  errors: number
  warnings: number
  infos: number
  clean: boolean
}

/** Design rule check parameters for PCB layout clearance. All values in mm. */
export interface PcbDesignRules {
  /** Minimum trace width (mm). */
  traceWidth: number
  /** Minimum clearance between two traces on the same layer (mm). */
  traceClearance: number
  /** Minimum clearance from a trace to a pad (mm). */
  padToTraceClearance: number
  /** Minimum clearance from a trace to a via (mm). */
  viaToTraceClearance: number
  /** Minimum annular ring around a via (mm). */
  minAnnularRing: number
}

/** Default PCB design rules (generic 2-layer, 6mil process). */
export const DEFAULT_PCB_RULES: PcbDesignRules = {
  traceWidth: 0.2,      // 0.2mm ≈ 7.9mil
  traceClearance: 0.2,  // 0.2mm ≈ 7.9mil
  padToTraceClearance: 0.2,
  viaToTraceClearance: 0.2,
  minAnnularRing: 0.1
}

// ---------------------------------------------------------------------------
// Real-time collaboration
// ---------------------------------------------------------------------------

export interface CursorPosition {
  x: number
  y: number
  /** Optional sheet the cursor is on (multi-sheet designs). */
  sheetId?: string
}

export interface CollabUser {
  id: string
  displayName: string
  /** Hex color used to render this user's cursor and presence badge. */
  color: string
  cursor: CursorPosition | null
  lastSeen: number
}

export type CollabOperationType =
  | 'component.added'
  | 'component.moved'
  | 'component.updated'
  | 'component.removed'
  | 'connection.added'
  | 'connection.removed'
  | 'sheet.added'
  | 'sheet.renamed'
  | 'sheet.deleted'

export interface CollabOperation {
  id: string
  type: CollabOperationType
  projectId: string
  /** User who originated the operation. */
  userId: string
  timestamp: number
  /** Operation-specific payload. */
  payload: Record<string, unknown>
}

export type ClientToServerMessage =
  | { type: 'join'; projectId: string; userId: string; displayName: string }
  | { type: 'leave'; projectId: string; userId: string }
  | { type: 'cursor.move'; projectId: string; userId: string; x: number; y: number; sheetId?: string }
  | { type: 'operation'; operation: CollabOperation }

export type ServerToClientMessage =
  | { type: 'presence'; users: CollabUser[] }
  | { type: 'cursor'; userId: string; x: number; y: number; sheetId?: string }
  | { type: 'operation'; operation: CollabOperation }
  | { type: 'error'; message: string }
  | { type: 'joined'; projectId: string; userId: string }
