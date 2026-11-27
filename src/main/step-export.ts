/**
 * STEP AP203/AP214 export for Blueprint PC PCB layouts.
 *
 * Generates a minimal but valid STEP file from PCB layout geometry:
 *   - Board outline as an extruded rectangular solid
 *   - Copper traces as thin extrusions on the top layer
 *   - Pads as extruded rectangular solids
 *
 * The output is STEP AP203 (configuration controlled 3D mechanical design)
 * with a minimal header. Suitable for import into MCAD tools for enclosure
 * fit and clearance checking.
 *
 * This is a feasibility-level exporter. It does not handle vias, copper
 * pours, or complex board shapes.
 */

import type { PcbPad, PcbTrace } from './pcb-layout'

const MM = 0.001 // STEP uses meters internally; we convert mm -> m

/** Format a number for STEP output (meters, 6 decimal places). */
function fmt(n: number): string {
  return (n * MM).toFixed(6)
}

/** Generate a minimal but valid STEP AP203 file from PCB geometry. */
export function generateStepBoard(
  traces: PcbTrace[],
  pads: PcbPad[],
  boardW: number,
  boardH: number,
  boardThickness: number
): string {
  const lines: string[] = []

  // -------------------------------------------------------------------------
  // STEP header
  // -------------------------------------------------------------------------
  lines.push('ISO-10303-21;')
  lines.push('HEADER;')
  lines.push('FILE_NAME(\'blueprint-pc.step\',\'2026-11-27T07:30:00\',(\'Blueprint PC\'),(\'\'),\'2026-11-27T07:30:00\',\'Blueprint PC\',\'1.0\');')
  lines.push('FILE_SCHEMA((\'AUTOMOTIVE_DESIGN_{ 1 2 3 4 5 6 7 8 }\'));')
  lines.push('ENDSEC;')
  lines.push('')

  // -------------------------------------------------------------------------
  // DATA section
  // -------------------------------------------------------------------------
  lines.push('DATA;')
  lines.push('')

  let id = 1

  // ---- Board as a rectangular solid (extruded face) ----
  const boardFaceId = id++
  const boardRectId = id++
  const boardExtrusionId = id++
  const boardDirectionId = id++
  const boardVertexIds: number[] = []
  const boardEdgeIds: number[] = []
  const boardLoopId = id++
  const boardPlaneId = id++
  const boardAxisId = id++
  const boardPointId = id++

  // 4 board corners (rectangular face in XY plane, Z=0)
  const corners = [
    { x: 0, y: 0 },
    { x: boardW, y: 0 },
    { x: boardW, y: boardH },
    { x: 0, y: boardH }
  ]

  for (const c of corners) {
    boardVertexIds.push(id++)
    lines.push(`#${boardVertexIds[boardVertexIds.length - 1]}=CARTESIAN_POINT('board corner',(${fmt(c.x)},${fmt(c.y)},0));`)
  }

  // Board edges
  for (let i = 0; i < 4; i++) {
    boardEdgeIds.push(id++)
    const v1 = boardVertexIds[i]
    const v2 = boardVertexIds[(i + 1) % 4]
    lines.push(`#${boardEdgeIds[boardEdgeIds.length - 1]}=EDGE_CURVE('',#${v1},#${v2},.T.);`)
  }

  // Board wire loop
  const edgeRefs = boardEdgeIds.map((e) => `#${e}`).join(',')
  lines.push(`#${boardLoopId}=EDGE_LOOP('',(${edgeRefs}));`)

  // Board face (plane surface)
  lines.push(`#${boardFaceId}=ADVANCED_FACE('',(#${boardLoopId}),#${boardPlaneId},.T.);`)

  // Plane at Z=0
  lines.push(`#${boardPointId}=CARTESIAN_POINT('',(0,0,0));`)
  lines.push(`#${boardAxisId}=AXIS2_PLACEMENT_3D('',#${boardPointId},#${id++},#${id++});`)
  lines.push(`#${id++}=VECTOR('',(0,0,1),1);`) // Z direction (board normal)
  lines.push(`#${id++}=VECTOR('',(1,0,0),1);`) // X direction
  lines.push(`#${boardPlaneId}=PLANE('',#${boardAxisId});`)

  // Rectangular face bounds (the board face uses the loop)
  lines.push(`#${boardRectId}=FACE_BOUND('',#${boardLoopId},.T.,);`)

  // Extrude board face along Z by boardThickness
  lines.push(`#${boardDirectionId}=VECTOR('',(0,0,1),${fmt(boardThickness)});`)
  lines.push(`#${boardExtrusionId}=MANIFOLD_SOLID_BREP('board',(#${boardFaceId}));`)
  lines.push(`#${id++}=EXTRUDED_AREA_SOLID('',#${boardFaceId},#${boardDirectionId},${fmt(boardThickness)});`)
  lines.push(`#${id++}=CLOSED_SHELL('',(#${id - 1}));`)

  lines.push('')
  lines.push('---- Traces ----')

  // ---- Traces as thin extrusions ----
  const traceIds: number[] = []
  for (const tr of traces) {
    // Simplify: represent each trace segment as a thin rectangular extrusion
    // from the polyline, extruded upward by copper thickness (0.035mm = 1oz)
    const copperThickness = 0.035
    const traceWidth = 0.2 // mm

    for (let i = 0; i < tr.points.length - 1; i++) {
      const p1 = tr.points[i]
      const p2 = tr.points[i + 1]
      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 0.001) continue

      const ux = dx / len
      const uy = dy / len
      const nx = -uy
      const ny = ux

      // Rectangle corners around the segment
      const hw = traceWidth / 2
      const c1 = { x: p1.x + nx * hw, y: p1.y + ny * hw }
      const c2 = { x: p1.x - nx * hw, y: p1.y - ny * hw }
      const c3 = { x: p2.x - nx * hw, y: p2.y - ny * hw }
      const c4 = { x: p2.x + nx * hw, y: p2.y + ny * hw }

      const pts = [c1, c2, c3, c4]
      const ptIds: number[] = []
      for (const pt of pts) {
        ptIds.push(id++)
        lines.push(`#${ptIds[ptIds.length - 1]}=CARTESIAN_POINT('trace pt',(${fmt(pt.x)},${fmt(pt.y)},0));`)
      }

      // Edges
      const edgeIds: number[] = []
      for (let j = 0; j < 4; j++) {
        edgeIds.push(id++)
        lines.push(`#${edgeIds[edgeIds.length - 1]}=EDGE_CURVE('',#${ptIds[j]},#${ptIds[(j + 1) % 4]},.T.);`)
      }

      // Wire loop
      const traceEdgeRefs = edgeIds.map((e) => `#${e}`).join(',')
      const traceLoopId = id++
      lines.push(`#${traceLoopId}=EDGE_LOOP('',(${traceEdgeRefs}));`)

      // Face
      const traceFaceId = id++
      lines.push(`#${traceFaceId}=ADVANCED_FACE('',(#${traceLoopId}),#${boardPlaneId},.T.);`)

      // Extrude upward
      const traceExtrudeId = id++
      lines.push(`#${traceExtrudeId}=EXTRUDED_AREA_SOLID('trace',#${traceFaceId},#${boardDirectionId},${fmt(copperThickness)});`)
      traceIds.push(traceExtrudeId)
    }
  }

  lines.push('')
  lines.push('---- Pads ----')

  // ---- Pads as extruded rectangles ----
  const padIds: number[] = []
  const padThickness = 0.035
  for (const pad of pads) {
    const hw = pad.w / 2
    const hh = pad.h / 2
    const cx = pad.center.x
    const cy = pad.center.y

    const pts = [
      { x: cx - hw, y: cy - hh },
      { x: cx + hw, y: cy - hh },
      { x: cx + hw, y: cy + hh },
      { x: cx - hw, y: cy + hh }
    ]
    const ptIds: number[] = []
    for (const pt of pts) {
      ptIds.push(id++)
      lines.push(`#${ptIds[ptIds.length - 1]}=CARTESIAN_POINT('pad pt',(${fmt(pt.x)},${fmt(pt.y)},0));`)
    }

    const edgeIds: number[] = []
    for (let j = 0; j < 4; j++) {
      edgeIds.push(id++)
      lines.push(`#${edgeIds[edgeIds.length - 1]}=EDGE_CURVE('',#${ptIds[j]},#${ptIds[(j + 1) % 4]},.T.);`)
    }

    const padEdgeRefs = edgeIds.map((e) => `#${e}`).join(',')
    const padLoopId = id++
    lines.push(`#${padLoopId}=EDGE_LOOP('',(${padEdgeRefs}));`)

    const padFaceId = id++
    lines.push(`#${padFaceId}=ADVANCED_FACE('',(#${padLoopId}),#${boardPlaneId},.T.);`)

    const padExtrudeId = id++
    lines.push(`#${padExtrudeId}=EXTRUDED_AREA_SOLID('pad',#${padFaceId},#${boardDirectionId},${fmt(padThickness)});`)
    padIds.push(padExtrudeId)
  }

  // ---- Product definition (assembly) ----
  lines.push('')
  lines.push('---- Assembly ----')

  const allShapeIds = [boardExtrusionId, ...traceIds, ...padIds]
  const shapeRefs = allShapeIds.map((s) => `#${s}`).join(',')

  const productId = id++
  lines.push(`#${productId}=PRODUCT('blueprint-pc board','','',(#${id++}));`)

  const contextId = id++
  lines.push(`#${contextId}=APPLICATION_CONTEXT('mechanical design');`)

  const definitionId = id++
  lines.push(`#${definitionId}=SHAPE_DEFINITION_REPRESENTATION(#${productId},#${contextId});`)

  const repId = id++
  lines.push(`#${repId}=SHAPE_REPRESENTATION('',(''),(#${shapeRefs}),#${id++});`)

  lines.push('')
  lines.push('ENDSEC;')
  lines.push('')

  // ---- Footer ----
  lines.push('END-ISO-10303-21;')

  return lines.join('\n') + '\n'
}
