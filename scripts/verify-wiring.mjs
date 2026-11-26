/**
 * Checks that every drawn wire actually terminates on a real pin dot.
 *
 * A wiring diagram that looks connected but is not is worse than one with a gap,
 * so this asserts the geometry rather than trusting it.
 *
 * Usage: node scripts/verify-wiring.mjs <path-to-projects.json>
 */

import { readFileSync } from 'node:fs'
import { layoutWiring } from '../src/renderer/src/lib/wiringLayout.ts'

const file = process.argv[2]
const projects = JSON.parse(readFileSync(file, 'utf8'))
const list = Array.isArray(projects) ? projects : Object.values(projects)
const spec = list[0].spec

const layout = layoutWiring(spec.components, spec.connections)

// "M x1 y1 C ... x2 y2" - first pair is the start, last pair is the end.
function endpoints(d) {
  const n = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
  if (n.length < 8) return null
  return { start: { x: n[0], y: n[1] }, end: { x: n[n.length - 2], y: n[n.length - 1] } }
}

function isPinDot(node, point) {
  return node.pins.some(
    (p) =>
      (Math.abs(p.x - point.x) < 0.01 && Math.abs(p.y - point.y) < 0.01) ||
      (Math.abs(p.rightX - point.x) < 0.01 && Math.abs(p.y - point.y) < 0.01)
  )
}

let failures = 0
const byId = new Map(layout.nodes.map((n) => [n.component.id, n]))

console.log(`components: ${layout.nodes.length}`)
console.log(`connections in spec: ${spec.connections.length}`)
console.log(`wires drawn: ${layout.wires.length}`)
console.log(`wires that could not be drawn: ${layout.unresolved.length}`)

for (const w of layout.wires) {
  const ep = endpoints(w.d)
  if (!ep) {
    console.log(`  FAIL unparseable path for ${w.from.pin} -> ${w.to.pin}`)
    failures++
    continue
  }

  const from = byId.get(w.from.nodeId)
  const to = byId.get(w.to.nodeId)

  const startOk = from && isPinDot(from, ep.start)
  const endOk = to && isPinDot(to, ep.end)

  if (!startOk) {
    console.log(`  FAIL start of ${w.from.pin} is not on a pin dot (${ep.start.x}, ${ep.start.y})`)
    failures++
  }
  if (!endOk) {
    console.log(`  FAIL end of ${w.to.pin} is not on a pin dot (${ep.end.x}, ${ep.end.y})`)
    failures++
  }
}

if (failures === 0) {
  console.log('\nPASS every wire starts and ends on a real pin dot')
} else {
  console.log(`\n${failures} endpoint problem(s)`)
  process.exit(1)
}