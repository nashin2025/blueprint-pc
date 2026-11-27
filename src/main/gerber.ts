/**
 * Gerber X2 + Excellon manufacturing output generator for Blueprint PC.
 *
 * Generates fabrication files from a PCB layout result:
 *   - GTL: Top copper layer (traces + pads)
 *   - GTS: Top solder mask (negative of pads)
 *   - GTO: Top silkscreen (component outlines)
 *   - Drill (Excellon): Via and pad holes
 *
 * All coordinates are in mm, absolute mode.
 *
 * This is a feasibility-level generator suitable for prototyping and
 * low-volume production. It does not handle copper pours, thermal reliefs,
 * or complex aperture macros.
 */

import type { PcbPad, PcbPlacement, PcbTrace, PcbVia } from './pcb-layout'

const MM = 0.01 // Gerber coordinate precision: 0.01mm

/** Format a number for Gerber output (2 decimal places, mm). */
function fmt(n: number): string {
  return (Math.round(n / MM) * MM).toFixed(2).replace(/\.00$/, '')
}

/** Format a number for Excellon output (2 decimal places, mm). */
function fmtDrill(n: number): string {
  return n.toFixed(2)
}

/** Generate Gerber X2 aperture definitions. */
function apertureDefinitions(): string[] {
  return [
    '%FSLAX20Y20*%', // Format: Leading zeros off, 2.2 mm
    '%MOMM*%',       // Metric units
    '%ADD10C,0.20*%', // Aperture 10: Circle 0.20mm (via)
    '%ADD11R,0.60X0.40*%', // Aperture 11: Rectangle 0.60x0.40mm (pad)
    '%ADD12R,1.00X0.60*%', // Aperture 12: Rectangle 1.00x0.60mm (pad)
    '%ADD13R,1.60X1.10*%', // Aperture 13: Rectangle 1.60x1.10mm (pad)
    '%ADD14R,2.00X1.20*%', // Aperture 14: Rectangle 2.00x1.20mm (pad)
    '%ADD15C,0.50*%', // Aperture 15: Circle 0.50mm (via)
  ]
}

/** Generate trace (line) commands for a polyline. */
function traceToGerber(points: { x: number; y: number }[]): string[] {
  const lines: string[] = []
  lines.push(`G01X${fmt(points[0].x)}Y${fmt(points[0].y)}D02*%`) // Move to start
  for (let i = 1; i < points.length; i++) {
    lines.push(`G01X${fmt(points[i].x)}Y${fmt(points[i].y)}D01*%`) // Line to next point
  }
  lines.push(
    `G01X${fmt(points[points.length - 1].x)}Y${fmt(points[points.length - 1].y)}D02*%`
  ) // End
  return lines
}

/** Generate pad flash commands. */
function padToGerber(pad: PcbPad): string[] {
  return [`G01X${fmt(pad.center.x)}Y${fmt(pad.center.y)}D03*%`] // Flash at pad center
}

/** Generate Gerber X2 for top copper layer (GTL). */
function generateGTL(traces: PcbTrace[], pads: PcbPad[]): string[] {
  const lines: string[] = []
  lines.push('%GTL*%') // Top copper layer
  lines.push(...apertureDefinitions())

  // Traces
  for (const tr of traces) {
    lines.push(...traceToGerber(tr.points))
  }

  // Pads
  for (const pad of pads) {
    lines.push(`%ADD11R,${fmt(pad.w)}X${fmt(pad.h)}*%`)
    lines.push(...padToGerber(pad))
  }

  lines.push('M02*%') // End of file
  return lines
}

/** Generate Gerber X2 for top solder mask (GTS). */
function generateGTS(pads: PcbPad[]): string[] {
  const lines: string[] = []
  lines.push('%GTS*%') // Top solder mask
  lines.push('%FSLAX20Y20*%')
  lines.push('%MOMM*%')
  lines.push('%LPD*%')
  lines.push('%LPC*%')

  // Solder mask is negative of pads: larger openings around pads
  for (const pad of pads) {
    const maskW = pad.w + 0.1 // 0.1mm mask expansion
    const maskH = pad.h + 0.1
    lines.push(`%ADD21R,${fmt(maskW)}X${fmt(maskH)}*%`)
    lines.push(`G01X${fmt(pad.center.x)}Y${fmt(pad.center.y)}D03*%`)
  }

  lines.push('M02*%')
  return lines
}

/** Generate Gerber X2 for top silkscreen (GTO). */
function generateGTO(placements: PcbPlacement[]): string[] {
  const lines: string[] = []
  lines.push('%GTO*%') // Top silkscreen
  lines.push('%FSLAX20Y20*%')
  lines.push('%MOMM*%')
  lines.push('%LPD*%')
  lines.push('%LPC*%')
  lines.push('%ADD31R,0.10X0.10*%') // Thin line for outlines

  for (const placement of placements) {
    const w = placement.w
    const h = placement.h
    const cx = placement.center.x
    const cy = placement.center.y
    const rot = (placement.rotationDeg * Math.PI) / 180
    const c = Math.cos(rot)
    const s = Math.sin(rot)

    // Four corners of the component rectangle, rotated
    const corners = [
      { x: cx + c * (-w / 2) - s * (-h / 2), y: cy + s * (-w / 2) + c * (-h / 2) },
      { x: cx + c * (w / 2) - s * (-h / 2), y: cy + s * (w / 2) + c * (-h / 2) },
      { x: cx + c * (w / 2) - s * (h / 2), y: cy + s * (w / 2) + c * (h / 2) },
      { x: cx + c * (-w / 2) - s * (h / 2), y: cy + s * (-w / 2) + c * (h / 2) },
    ]

    // Draw rectangle outline
    lines.push(`G01X${fmt(corners[0].x)}Y${fmt(corners[0].y)}D02*%`)
    for (let i = 1; i < corners.length; i++) {
      lines.push(`G01X${fmt(corners[i].x)}Y${fmt(corners[i].y)}D01*%`)
    }
    lines.push(`G01X${fmt(corners[0].x)}Y${fmt(corners[0].y)}D01*%`) // Close
  }

  lines.push('M02*%')
  return lines
}

/** Generate Excellon drill file. */
function generateExcellon(vias: PcbVia[], pads: PcbPad[]): string[] {
  const lines: string[] = []
  lines.push('M48*') // Program start
  lines.push('%;Header')
  lines.push(';Board Thickness: 1.60mm')
  lines.push('%;Drill File')
  lines.push('METRIC,METRIC') // Metric units
  lines.push('T01C0.50') // Tool 1: 0.50mm drill (via)
  lines.push('T02C0.80') // Tool 2: 0.80mm drill (pad hole)

  // Via holes (tool 1)
  if (vias.length > 0) {
    lines.push('T01') // Select tool 1
    for (const via of vias) {
      lines.push(`X${fmtDrill(via.x)}Y${fmtDrill(via.y)}`) // Drill at via position
    }
  }

  // Pad holes (tool 2)
  if (pads.length > 0) {
    lines.push('T02') // Select tool 2
    for (const pad of pads) {
      lines.push(`X${fmtDrill(pad.center.x)}Y${fmtDrill(pad.center.y)}`)
    }
  }

  lines.push('M30') // Program end
  return lines
}

/** Generate all Gerber files for a PCB layout.
 *
 * Returns an object with file names as keys and file contents as values:
 *   - 'top_copper.gtl'
 *   - 'top_solder_mask.gts'
 *   - 'top_silkscreen.gto'
 *   - 'drill.txt' (Excellon)
 */
export function generateGerberFiles(
  placements: PcbPlacement[],
  traces: PcbTrace[],
  pads: PcbPad[],
  vias: PcbVia[]
): Record<string, string> {
  const gtl = generateGTL(traces, pads).join('\n') + '\n'
  const gts = generateGTS(pads).join('\n') + '\n'
  const gto = generateGTO(placements).join('\n') + '\n'
  const drill = generateExcellon(vias, pads).join('\n') + '\n'

  return {
    'top_copper.gtl': gtl,
    'top_solder_mask.gts': gts,
    'top_silkscreen.gto': gto,
    'drill.txt': drill,
  }
}
