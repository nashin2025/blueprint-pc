/**
 * Land pattern (component footprint) generator.
 *
 * Pure, dependency-free TypeScript. It takes pad/body parameters and returns a
 * complete Footprint. All dimensions are in millimetres and the origin sits at
 * the centre of the part body. No Electron, no DOM, no IPC - trivial to unit
 * test from the self-check script.
 */

export type FootprintShape = 'rect' | 'round' | 'oval'

export interface FootprintPad {
  id: string
  x: number
  y: number
  w: number
  h: number
  shape: FootprintShape
}

export interface Footprint {
  id: string
  name: string
  description?: string
  pads: FootprintPad[]
  outlineW: number
  outlineH: number
  createdAt: number
}

export type FootprintKind =
  | 'sop'
  | 'dip'
  | 'qfn'
  | 'smd-resistor'
  | 'smd-capacitor'
  | 'custom'

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

function newFootprintId(): string {
  return `fp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function pad(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  shape: FootprintShape = 'rect'
): FootprintPad {
  return { id, x, y, w, h, shape }
}

/**
 * Generate a standard land pattern from a family and parameters.
 *
 * Pad coordinates are relative to the body centre, with Y positive toward the
 * top of the body. For two-sided families (SOP/DIP) pads sit on the left and
 * right edges; for QFN pads sit on all four edges.
 */
export function generateLandPattern(params: LandPatternParams): Footprint {
  const now = Date.now()
  const { type } = params

  const pinCount = params.pinCount ?? 0
  const pitch = params.pitch ?? 0
  const bodyW = params.bodyWidth ?? 0
  const bodyH = params.bodyHeight ?? 0
  const padW = params.padWidth ?? 0.6
  const padL = params.padLength ?? 1.0
  const clearance = params.padToBodyClearance ?? 0

  const pads: FootprintPad[] = []
  let name = ''
  let description = ''
  let outlineW = bodyW
  let outlineH = bodyH

  if (type === 'custom') {
    const custom = params.customPads ?? []
    if (custom.length === 0) {
      throw new Error('custom footprint requires at least one custom pad')
    }
    custom.forEach((c: { x: number; y: number; w: number; h: number }, i: number) => {
      pads.push(pad(`p${i + 1}`, c.x, c.y, c.w, c.h, 'rect'))
    })
    name = 'Custom footprint'
    description = `Custom land pattern with ${custom.length} pad(s).`

    // Outline wraps every pad with a small margin.
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of pads) {
      minX = Math.min(minX, p.x - p.w / 2)
      minY = Math.min(minY, p.y - p.h / 2)
      maxX = Math.max(maxX, p.x + p.w / 2)
      maxY = Math.max(maxY, p.y + p.h / 2)
    }
    const margin = 0.5
    outlineW = maxX - minX + 2 * margin
    outlineH = maxY - minY + 2 * margin
  } else if (type === 'smd-resistor' || type === 'smd-capacitor') {
    // 0603-style two-pad part: one pad on each short side of the body.
    const xL = -bodyW / 2 - clearance - padW / 2
    const xR = bodyW / 2 + clearance + padW / 2
    pads.push(pad('p1', xL, 0, padW, padL, 'rect'))
    pads.push(pad('p2', xR, 0, padW, padL, 'rect'))
    name = type === 'smd-resistor' ? '0603 resistor' : '0603 capacitor'
    description = `Two-pad SMD ${name} land pattern, ${bodyW}x${bodyH}mm body.`
  } else if (type === 'sop' || type === 'dip') {
    if (pinCount < 2) throw new Error(`${type} requires at least 2 pins`)
    if (pinCount % 2 !== 0) throw new Error(`${type} requires an even pin count`)
    if (pitch <= 0) throw new Error(`${type} requires a positive pitch`)
    if (bodyW <= 0 || bodyH <= 0) throw new Error(`${type} requires positive body dimensions`)

    const perSide = pinCount / 2
    const span = (perSide - 1) * pitch
    const startY = -span / 2
    const sideOffset = bodyW / 2 + clearance + padW / 2
    for (let i = 0; i < perSide; i++) {
      const y = startY + i * pitch
      pads.push(pad(`p${i + 1}`, -sideOffset, y, padW, padL, 'rect')) // left edge
      pads.push(pad(`p${perSide + i + 1}`, sideOffset, y, padW, padL, 'rect')) // right edge
    }
    const prefix = type === 'sop' ? 'SOP' : 'DIP'
    name = `${prefix}${pinCount}`
    description = `${pinCount}-pin ${type.toUpperCase()} land pattern, ${bodyW}x${bodyH}mm body, ${pitch}mm pitch.`
  } else if (type === 'qfn') {
    if (pinCount < 4) throw new Error('QFN requires at least 4 pins')
    if (pinCount % 4 !== 0) throw new Error('QFN requires a pin count divisible by 4')
    if (pitch <= 0) throw new Error('QFN requires a positive pitch')
    if (bodyW <= 0 || bodyH <= 0) throw new Error('QFN requires positive body dimensions')

    const perSide = pinCount / 4
    const span = (perSide - 1) * pitch
    const start = -span / 2
    const sideOffsetX = bodyW / 2 + clearance + padW / 2
    const sideOffsetY = bodyH / 2 + clearance + padW / 2

    // Top edge: pads run along X, stick out toward negative Y.
    for (let i = 0; i < perSide; i++) {
      const x = start + i * pitch
      pads.push(pad(`p${i + 1}`, x, -sideOffsetY, padL, padW, 'rect'))
    }
    // Bottom edge: pads run along X, stick out toward positive Y.
    for (let i = 0; i < perSide; i++) {
      const x = start + i * pitch
      pads.push(pad(`p${perSide + i + 1}`, x, sideOffsetY, padL, padW, 'rect'))
    }
    // Left edge: pads run along Y, stick out toward negative X.
    for (let i = 0; i < perSide; i++) {
      const y = start + i * pitch
      pads.push(pad(`p${perSide * 2 + i + 1}`, -sideOffsetX, y, padW, padL, 'rect'))
    }
    // Right edge: pads run along Y, stick out toward positive X.
    for (let i = 0; i < perSide; i++) {
      const y = start + i * pitch
      pads.push(pad(`p${perSide * 3 + i + 1}`, sideOffsetX, y, padW, padL, 'rect'))
    }

    name = `QFN${pinCount}`
    description = `${pinCount}-pin QFN land pattern, ${bodyW}x${bodyH}mm body, ${pitch}mm pitch.`
    if (params.centerPad) {
      pads.push(pad('p-thermal', 0, 0, params.centerPad.w, params.centerPad.h, 'rect'))
      description += ` with centre thermal pad ${params.centerPad.w}x${params.centerPad.h}mm.`
    }
  }

  return {
    id: newFootprintId(),
    name,
    description,
    pads,
    outlineW,
    outlineH,
    createdAt: now
  }
}
