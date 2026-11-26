import type {
  AssemblyStep,
  Component,
  Connection,
  ConnectionKind,
  DesignSpec,
  Difficulty
} from '@shared/types'

/**
 * Turns whatever the model returned into a guaranteed-valid DesignSpec.
 *
 * Models are unreliable about ids, array bounds and enum values. We trust
 * nothing: every field is checked, broken connections are dropped rather than
 * propagated, and ids are assigned here so they stay stable across a reload.
 */

const KINDS: ConnectionKind[] = ['power', 'ground', 'signal', 'data']
const DIFFICULTIES: Difficulty[] = ['beginner', 'intermediate', 'advanced']

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => asString(v)).filter(Boolean)
}

function newId(prefix: string, index: number): string {
  return `${prefix}_${index}_${Math.random().toString(36).slice(2, 8)}`
}

interface RawComponent {
  name?: unknown
  partName?: unknown
  category?: unknown
  quantity?: unknown
  unitPrice?: unknown
  url?: unknown
  image?: unknown
  pins?: unknown
  notes?: unknown
}

interface RawConnection {
  from?: { componentIndex?: unknown; pin?: unknown }
  to?: { componentIndex?: unknown; pin?: unknown }
  kind?: unknown
  net?: unknown
  label?: unknown
}

interface RawStep {
  title?: unknown
  body?: unknown
  componentIds?: unknown
}

interface RawSpec {
  title?: unknown
  summary?: unknown
  difficulty?: unknown
  estimatedTime?: unknown
  components?: unknown
  connections?: unknown
  steps?: unknown
}

export function normaliseDesign(raw: unknown): DesignSpec {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Model returned something that was not a design object.')
  }
  const spec = raw as RawSpec

  const rawComponents: RawComponent[] = Array.isArray(spec.components) ? spec.components : []
  if (rawComponents.length === 0) {
    throw new Error('Model returned a design with no components.')
  }

  const components: Component[] = rawComponents.map((c, i) => ({
    id: newId('cmp', i),
    name: asString(c.name, `Component ${i + 1}`),
    partName: asString(c.partName) || undefined,
    category: asString(c.category, 'Other'),
    quantity: Math.max(1, Math.round(asNumber(c.quantity, 1))),
    unitPrice: c.unitPrice === undefined || c.unitPrice === null ? undefined : asNumber(c.unitPrice),
    url: asString(c.url) || undefined,
    // Kept even though models fabricate these often: the renderer falls back to
    // a local illustration when the URL does not load, so a bad value is harmless.
    image: asString(c.image) || undefined,
    pins: asStringArray(c.pins)
  }))

  const resolve = (index: unknown): string | null => {
    const i = asNumber(index, -1)
    if (!Number.isInteger(i) || i < 0 || i >= components.length) return null
    return components[i].id
  }

  const rawConnections: RawConnection[] = Array.isArray(spec.connections) ? spec.connections : []
  const connections: Connection[] = []
  rawConnections.forEach((c, i) => {
    if (typeof c !== 'object' || c === null) return
    const fromId = resolve(c.from?.componentIndex)
    const toId = resolve(c.to?.componentIndex)
    const fromPin = asString(c.from?.pin)
    const toPin = asString(c.to?.pin)
    // A connection without two resolvable endpoints is worse than no connection:
    // it draws a wire that goes nowhere.
    if (!fromId || !toId || !fromPin || !toPin) return
    if (fromId === toId) return

    const kind = KINDS.includes(c.kind as ConnectionKind) ? (c.kind as ConnectionKind) : 'signal'
    connections.push({
      id: newId('wire', i),
      from: { componentId: fromId, pin: fromPin },
      to: { componentId: toId, pin: toPin },
      kind,
      net: asString(c.net) || undefined,
      label: asString(c.label) || undefined
    })
  })

  const rawSteps: RawStep[] = Array.isArray(spec.steps) ? spec.steps : []
  const steps: AssemblyStep[] = rawSteps
    .map((s, i) => {
      const ids = Array.isArray(s?.componentIds) ? s.componentIds : []
      return {
        id: newId('step', i),
        order: i + 1,
        title: asString(s?.title, `Step ${i + 1}`),
        body: asString(s?.body),
        componentIds: ids
          .map((v) => resolve(v))
          .filter((v): v is string => v !== null)
      }
    })
    .filter((s) => s.title || s.body)

  const difficulty = DIFFICULTIES.includes(spec.difficulty as Difficulty)
    ? (spec.difficulty as Difficulty)
    : 'intermediate'

  return {
    title: asString(spec.title, 'Untitled design'),
    summary: asString(spec.summary),
    difficulty,
    estimatedTime: asString(spec.estimatedTime) || undefined,
    estimatedCost: estimateCost(components),
    components,
    connections,
    steps
  }
}

export function estimateCost(components: Component[]): number | undefined {
  const priced = components.filter((c) => typeof c.unitPrice === 'number' && c.unitPrice > 0)
  if (priced.length === 0) return undefined
  const total = priced.reduce((sum, c) => sum + (c.unitPrice as number) * c.quantity, 0)
  return Math.round(total * 100) / 100
}