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
  pins: string[]
  notes?: string
}

export interface Connection {
  id: string
  from: PinRef
  to: PinRef
  kind: ConnectionKind
  /** Net name, e.g. "5V", "GND", "SDA". Used for rail inference and labels. */
  net?: string
  label?: string
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
}
