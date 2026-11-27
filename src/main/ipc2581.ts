/**
 * IPC-2581 manufacturing output generator for Blueprint PC.
 *
 * Generates a minimal but valid IPC-2581 XML manufacturing exchange file
 * from a PCB layout. IPC-2581 is an open standard for conveying PCB design
 * data to manufacturers (fabrication + assembly), replacing Gerber + Excellon
 * + BOM + centroid files with a single XML document.
 *
 * This is a feasibility-level exporter. It includes:
 *   - Header (creation info, software, design)
 *   - Part list (components with reference designators, footprints)
 *   - Netlist (connections between pins)
 *   - Layer stackup (copper, solder mask, silkscreen)
 *   - Manufacturing attributes (board thickness, copper weight)
 *
 * It does not include geometric layer data (traces, pads, vias) — those
 * are still provided by Gerber/Excellon output. Future versions can add
 * step-mesh geometry for complete IPC-2581 compliance.
 */

import type { PcbPad, PcbPlacement, PcbTrace, PcbVia } from './pcb-layout'

const MM = 0.001 // IPC-2581 uses meters; convert mm -> m

/** Format a number for IPC-2581 XML (meters, 6 decimal places). */
function fmt(n: number): string {
  return (n * MM).toFixed(6)
}

/** Escape XML special characters. */
function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Generate an IPC-2581 XML document from PCB layout data. */
export function generateIpc2581(
  projectName: string,
  placements: PcbPlacement[],
  traces: PcbTrace[],
  pads: PcbPad[],
  vias: PcbVia[],
  boardW: number,
  boardH: number,
  boardThicknessMm: number
): string {
  void pads // Accepted for API parity; part list uses placements instead
  void vias // Accepted for API parity; drill data not yet included
  const lines: string[] = []

  // -------------------------------------------------------------------------
  // XML declaration
  // -------------------------------------------------------------------------
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('')

  // -------------------------------------------------------------------------
  // IPC-2581 root element
  // -------------------------------------------------------------------------
  lines.push('<IPC2581>')
  lines.push('  <Header>')
  lines.push(`    <CreationDate>${new Date().toISOString()}</CreationDate>`)
  lines.push(`    <Software name="Blueprint PC" version="1.0"/>`)
  lines.push(`    <Design name="${xmlEscape(projectName)}" revision="1.0"/>`)
  lines.push('    <Units>MM</Units>')
  lines.push('  </Header>')
  lines.push('')

  // -------------------------------------------------------------------------
  // Design information
  // -------------------------------------------------------------------------
  lines.push('  <DesignInformation>')
  lines.push(`    <BoardName>${xmlEscape(projectName)}</BoardName>`)
  lines.push(`    <BoardThickness>${fmt(boardThicknessMm)}</BoardThickness>`)
  lines.push(`    <BoardWidth>${fmt(boardW)}</BoardWidth>`)
  lines.push(`    <BoardHeight>${fmt(boardH)}</BoardHeight>`)
  lines.push(`    <CopperWeight>1oz</CopperWeight>`)
  lines.push(`    <LayerCount>2</LayerCount>`)
  lines.push('  </DesignInformation>')
  lines.push('')

  // -------------------------------------------------------------------------
  // Part list (components)
  // -------------------------------------------------------------------------
  lines.push('  <PartList>')
  lines.push(`    <PartCount>${placements.length}</PartCount>`)
  for (const p of placements) {
    lines.push('    <Part>')
    lines.push(`      <ReferenceDesignator>${xmlEscape(p.name)}</ReferenceDesignator>`)
    lines.push(`      <PartName>${xmlEscape(p.componentId)}</PartName>`)
    lines.push(`      <Footprint>${xmlEscape(p.componentId)}</Footprint>`)
    lines.push(`      <X>${fmt(p.center.x)}</X>`)
    lines.push(`      <Y>${fmt(p.center.y)}</Y>`)
    lines.push(`      <Rotation>${p.rotationDeg}</Rotation>`)
    lines.push(`      <Side>Top</Side>`)
    lines.push('    </Part>')
  }
  lines.push('  </PartList>')
  lines.push('')

  // -------------------------------------------------------------------------
  // Netlist
  // -------------------------------------------------------------------------
  const nets = new Map<string, Set<string>>()
  for (const tr of traces) {
    const netName = tr.net ?? 'NET_1'
    if (!nets.has(netName)) nets.set(netName, new Set())
    nets.get(netName)!.add(`${tr.from.componentId}:${tr.from.pinName}`)
    nets.get(netName)!.add(`${tr.to.componentId}:${tr.to.pinName}`)
  }

  lines.push('  <Netlist>')
  lines.push(`    <NetCount>${nets.size}</NetCount>`)
  for (const [netName, pins] of nets) {
    lines.push(`    <Net name="${xmlEscape(netName)}">`)
    for (const pin of [...pins].sort()) {
      lines.push(`      <Pin>${xmlEscape(pin)}</Pin>`)
    }
    lines.push('    </Net>')
  }
  lines.push('  </Netlist>')
  lines.push('')

  // -------------------------------------------------------------------------
  // Layer stackup
  // -------------------------------------------------------------------------
  lines.push('  <LayerStackup>')
  lines.push('    <Layer id="1" name="Top Copper" type="Copper" thickness="0.035mm"/>')
  lines.push('    <Layer id="2" name="Top Solder Mask" type="SolderMask"/>')
  lines.push('    <Layer id="3" name="Top Silkscreen" type="Silkscreen"/>')
  lines.push('  </LayerStackup>')
  lines.push('')

  // -------------------------------------------------------------------------
  // Manufacturing attributes
  // -------------------------------------------------------------------------
  lines.push('  <ManufacturingAttributes>')
  lines.push('    <SurfaceFinish>ENIG</SurfaceFinish>')
  lines.push('    <MinTraceWidth>0.2mm</MinTraceWidth>')
  lines.push('    <MinTraceClearance>0.2mm</MinTraceClearance>')
  lines.push('    <MinDrillSize>0.5mm</MinDrillSize>')
  lines.push('    <RoHS>Compliant</RoHS>')
  lines.push('  </ManufacturingAttributes>')
  lines.push('')

  lines.push('</IPC2581>')
  lines.push('')

  return lines.join('\n')
}
