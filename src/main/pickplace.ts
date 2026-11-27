/**
 * Pick-and-place / centroid file export for Blueprint PC.
 *
 * Generates a centroid (pick-and-place) file from PCB placements and pads.
 * Centroid files are consumed by SMT assembly machines to place components
 * on the board. Output is CSV with one row per component placement.
 *
 * Coordinates are in mm. Rotation is in degrees, clockwise when viewed from
 * the top side. Side is always 'top' in this feasibility spike (single-sided
 * placement). Pads are accepted for API parity with the routing/DRC flow but
 * are not needed for centroid generation: one row per placement, not per pad.
 */

import type { PcbPad, PcbPlacement } from './pcb-layout'

/** One row of a centroid / pick-and-place file. */
export interface CentroidPart {
  designator: string
  x: number
  y: number
  rotationDeg: number
  side: 'top' | 'bottom'
  footprint: string
}

/**
 * Map component placements to centroid parts.
 *
 * Each placement becomes one centroid row: the component name is used as the
 * designator, the placement centre as X/Y, the placement rotation, side 'top',
 * and the footprint falls back to the placement name (a PcbPlacement carries no
 * separate footprintId, so the name is the best available package hint).
 */
export function generatePickPlace(placements: PcbPlacement[], pads: PcbPad[]): CentroidPart[] {
  // Pads are accepted for API parity but unused here: one centroid row per
  // placement, not per pad. The pads argument keeps the signature aligned
  // with the routing/DRC flow that produces placements + pads together.
  void pads

  const parts: CentroidPart[] = []
  for (const p of placements) {
    parts.push({
      designator: p.name,
      x: p.center.x,
      y: p.center.y,
      rotationDeg: p.rotationDeg,
      side: 'top',
      footprint: p.name,
    })
  }
  return parts
}

/** Escape a single CSV field, wrapping in quotes when it contains a comma,
 *  quote, or newline. Embedded quotes are doubled per RFC 4180. */
function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** Format a number for CSV output: fixed two decimal places (mm precision). */
function fmtCsv(n: number): string {
  return n.toFixed(2)
}

/** Convert centroid parts to CSV text with header:
 *  Designator,X(mm),Y(mm),Rotation(deg),Side,Footprint */
export function centroidToCsv(parts: CentroidPart[]): string {
  const lines: string[] = []
  lines.push('Designator,X(mm),Y(mm),Rotation(deg),Side,Footprint')
  for (const part of parts) {
    lines.push([
      escapeCsvField(part.designator),
      fmtCsv(part.x),
      fmtCsv(part.y),
      fmtCsv(part.rotationDeg),
      part.side,
      escapeCsvField(part.footprint),
    ].join(','))
  }
  return lines.join('\n') + '\n'
}
