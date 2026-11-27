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
  /** When set, this component is an instance of a hierarchical block rather than
   *  a plain part. Its pins correspond to the block's port names. */
  hierarchicalBlockId?: string
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

/** Maps an external block port name to an internal component pin reference. */
export interface PortMapping {
  componentId: string
  pin: string
}

/** One port on a hierarchical block. Maps an external-facing port name to an
 *  internal pin name inside the block's sub-circuit. */
export interface HierarchicalBlockPort {
  id: string
  name: string
  type: 'input' | 'output'
  /** The component id inside the block's internal spec that this port connects to. */
  componentId: string
  /** The pin name inside the block's internal spec that this port connects to. */
  pinName: string
}

/** A reusable sub-circuit that can be placed as a component in a parent design.
 *  The block carries its own internal DesignSpec and a set of ports that define
 *  how it connects to the outside world. */
export interface HierarchicalBlock {
  id: string
  name: string
  description?: string
  spec: DesignSpec
  ports: HierarchicalBlockPort[]
  thumbnailUrl?: string
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

/** An alternate part for a component (substitute). */
export interface BomAlternative {
  /** Reference designator this alternate applies to. */
  designator: string
  /** Alternate part number. */
  partNumber: string
  /** Alternate manufacturer/brand. */
  manufacturer: string | null
  /** Alternate footprint (if different from primary). */
  footprintId: string | null
  /** Reason for the alternate (e.g. 'obsolescence', 'cost', 'region'). */
  reason: string | null
  /** Unit price of the alternate (if known). */
  unitPrice: number | null
  /** Currency of the alternate price. */
  unitPriceCurrency: string
  /** Lead time in days. */
  leadTimeDays: number | null
  /** URL to the alternate part page. */
  url: string | null
}

/** A design variant: a named set of component overrides applied to a base design. */
export interface Variant {
  id: string
  name: string
  description: string | null
  /** Base variant this variant is derived from (null for the base variant). */
  baseVariantId: string | null
  /** Component overrides: designator -> override values. */
  componentOverrides: Array<{
    designator: string
    partNumber: string | null
    footprintId: string | null
    unitPrice: number | null
    notes: string | null
  }>
  /** Whether this variant is active (used for BOM generation). */
  active: boolean
}

/** A BOM line item for a specific variant. */
export interface BomLineItem {
  designator: string
  partNumber: string | null
  manufacturer: string | null
  footprintId: string | null
  quantity: number
  unitPrice: number | null
  unitPriceCurrency: string
  extendedPrice: number | null
  source: 'primary' | 'alternate' | 'override'
  alternateReason: string | null
  leadTimeDays: number | null
  url: string | null
}

/** One link between a schematic component and its PCB placement. */
export interface AnnotationLink {
  /** Schematic component ID. */
  componentId: string
  /** Reference designator (e.g. "C1", "R1"). */
  designator: string
  /** PCB placement ID (if placed). Null if not yet placed on PCB. */
  placementId: string | null
  /** PCB footprint (if assigned). Null if not yet assigned. */
  footprintId: string | null
  /** Net this component's pins connect to (from schematic). */
  schematicNet: string | null
  /** Net this component's pins connect to (from PCB). Null if not routed. */
  pcbNet: string | null
}

/** One divergence between schematic and PCB. */
export interface AnnotationDivergence {
  type:
    | 'component_added'
    | 'component_removed'
    | 'footprint_changed'
    | 'net_changed'
    | 'unplaced'
    | 'unrouted'
  componentId: string
  designator: string
  message: string
  severity: 'error' | 'warning'
}

/** One ECO (Engineering Change Order) action. */
export interface EcoAction {
  type:
    | 'add_component'
    | 'remove_component'
    | 'change_footprint'
    | 'change_net'
    | 'place_component'
  designator: string
  newValue: string | null
  oldValue: string | null
}

/** Complete ECO: a set of actions to bring PCB into sync with schematic. */
export interface Eco {
  id: string
  createdAt: number
  actions: EcoAction[]
  divergences: AnnotationDivergence[]
  autoResolvable: boolean
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
  /** Reusable sub-circuits defined within this design. Each block can be placed
   *  as a component instance in the parent design and drilled into for editing. */
  hierarchicalBlocks?: HierarchicalBlock[]
  /** PCB design rules used for this design (trace width, clearance, etc.). */
  designRules?: PcbDesignRules
  /** Keep-in zones: components must be placed inside these rectangles. */
  keepInZones?: KeepInZone[]
  /** Keep-out zones: components must not overlap these rectangles. */
  keepOutZones?: KeepOutZone[]
  /** 3D enclosure box for collision checking. */
  enclosure?: Enclosure
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
  /** Part lifecycle status. 'obsolete' parts should not be used in new designs. */
  lifecycle?: 'active' | 'preview' | 'nrnd' | 'obsolete'
  /** Alternate supplier part numbers for cross-reference. */
  suppliers?: Array<{ name: string; partNumber: string | null; url: string | null }>
  /** Suggested alternate part slugs when this part is unavailable. */
  substitutes?: string[]
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
// Mechanical keep-in / keep-out zones and enclosure
// ---------------------------------------------------------------------------

/** A keep-in zone: components must be placed inside this rectangle (mm). */
export interface KeepInZone {
  id: string
  name: string
  /** Zone centre X (mm). */
  x: number
  /** Zone centre Y (mm). */
  y: number
  /** Zone width (mm). */
  w: number
  /** Zone height (mm). */
  h: number
  /** PCB layer this zone applies to (e.g. 'top', 'bottom'). */
  layer: string
}

/** A keep-out zone: components must not overlap this rectangle (mm). */
export interface KeepOutZone {
  id: string
  name: string
  /** Zone centre X (mm). */
  x: number
  /** Zone centre Y (mm). */
  y: number
  /** Zone width (mm). */
  w: number
  /** Zone height (mm). */
  h: number
  /** PCB layer this zone applies to (e.g. 'top', 'bottom'). */
  layer: string
}

/** A 3D enclosure box for collision checking (mm). */
export interface Enclosure {
  id: string
  name: string
  /** Enclosure centre X (mm). */
  x: number
  /** Enclosure centre Y (mm). */
  y: number
  /** Enclosure centre Z (mm). */
  z: number
  /** Enclosure width (mm). */
  w: number
  /** Enclosure height (mm). */
  h: number
  /** Enclosure depth (mm). */
  d: number
}

// ---------------------------------------------------------------------------
// Signal integrity analysis
// ---------------------------------------------------------------------------

/** Dielectric material stackup for a PCB layer. */
export interface DielectricStackup {
  /** Relative permittivity (dielectric constant) of the substrate. */
  er: number
  /** Substrate thickness (mm). */
  thicknessMm: number
  /** Copper thickness (oz, converted to mm internally: 1oz ≈ 0.035mm). */
  copperOz: number
  /** Loss tangent (dielectric loss factor). */
  lossTangent?: number
}

/** Microstrip trace geometry (trace on outer layer, referenced to plane below). */
export interface MicrostripTrace {
  /** Trace width (mm). */
  widthMm: number
  /** Trace thickness (oz). */
  copperOz: number
  /** Substrate height above the reference plane (mm). */
  heightMm: number
  /** Dielectric relative permittivity. */
  er: number
}

/** Result of a microstrip impedance calculation. */
export interface ImpedanceResult {
  /** Characteristic impedance in ohms. */
  z0Ohms: number
  /** Effective dielectric constant. */
  effectiveEr: number
  /** Propagation delay per unit length (ns/mm). */
  delayNsPerMm: number
}

/** Two parallel microstrip traces for crosstalk analysis. */
export interface CrosstalkPair {
  /** Width of each trace (mm). */
  widthMm: number
  /** Edge-to-edge separation between traces (mm). */
  separationMm: number
  /** Height above reference plane (mm). */
  heightMm: number
  /** Trace length (mm). */
  lengthMm: number
  /** Dielectric relative permittivity. */
  er: number
  /** Rise time of the aggressor signal (ns). */
  riseTimeNs: number
}

/** Result of crosstalk analysis. */
export interface CrosstalkResult {
  /** Near-end crosstalk voltage as fraction of aggressor voltage. */
  nextFraction: number
  /** Far-end crosstalk voltage as fraction of aggressor voltage. */
  fextFraction: number
  /** Coupling coefficient (0 to 1). */
  couplingCoefficient: number
}

/** Signal integrity analysis request for one trace. */
export interface SiTraceAnalysis {
  projectId: string
  traceWidthMm: number
  traceLengthMm: number
  stackup: DielectricStackup
  targetImpedanceOhms?: number
}

/** Signal integrity analysis result for one trace. */
export interface SiTraceResult {
  traceWidthMm: number
  traceLengthMm: number
  impedance: ImpedanceResult
  crosstalk?: CrosstalkResult
  withinTolerance: boolean
  tolerancePercent: number
}

// ---------------------------------------------------------------------------
// Thermal analysis
// ---------------------------------------------------------------------------

/** Thermal analysis request for a component. */
export interface ComponentThermal {
  /** Ambient temperature in Celsius. */
  ambientC: number
  /** Power dissipation in Watts. */
  powerW: number
  /** Maximum junction temperature in Celsius (from datasheet). */
  tJMaxC: number
  /** Package type for thermal resistance lookup (e.g. 'sop-8', 'qfn-20', 'to-220'). */
  packageType: string
}

/** Thermal analysis result for a component. */
export interface ThermalResult {
  /** Estimated junction temperature in Celsius. */
  junctionTemperatureC: number
  /** Maximum allowable power dissipation in Watts. */
  maxAllowablePowerW: number
  /** Derating factor: actual power / max power (0 to 1+). */
  deratingFactor: number
  /** Junction-to-ambient thermal resistance in C/W. */
  rjaCPerW: number
  /** Status: 'ok', 'warning', or 'critical'. */
  status: 'ok' | 'warning' | 'critical'
  /** True when junction temperature is within limits. */
  withinLimits: boolean
}

/** Board-level thermal estimate request. */
export interface BoardThermal {
  /** Ambient temperature in Celsius. */
  ambientC: number
  /** Total board power dissipation in Watts. */
  totalPowerW: number
  /** Board thermal resistance in C/W. */
  boardRjaCPerW: number
}

/** Board-level thermal estimate result. */
export interface BoardThermalResult {
  /** Estimated board temperature in Celsius. */
  boardTemperatureC: number
  /** Temperature rise above ambient in Celsius. */
  temperatureRiseC: number
}

// ---------------------------------------------------------------------------
// Library management
// ---------------------------------------------------------------------------

/** Library health report: summary of part lifecycle status across the catalogue. */
export interface LibraryHealthReport {
  /** Total number of parts in the catalogue. */
  totalParts: number
  /** Parts by lifecycle status. */
  byLifecycle: Record<'active' | 'preview' | 'nrnd' | 'obsolete', number>
  /** Parts with no lifecycle status set. */
  unclassified: number
  /** Parts with substitute suggestions. */
  withSubstitutes: number
  /** Parts with supplier cross-references. */
  withSuppliers: number
  /** Obsolete parts that have substitutes. */
  obsoleteWithSubstitutes: number
}

/** Request to update a part's lifecycle status. */
export interface PartLifecycleUpdate {
  slug: string
  lifecycle: 'active' | 'preview' | 'nrnd' | 'obsolete'
}

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
