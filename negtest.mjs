import { readFileSync } from 'node:fs'
import { layoutWiring } from './src/renderer/src/lib/wiringLayout.ts'

const projects = JSON.parse(readFileSync('C:/Users/Nashin/AppData/Roaming/blueprint-pc/data/projects.json','utf8'))
const spec = (Array.isArray(projects) ? projects : Object.values(projects))[0].spec

// Corrupt one connection so it names a pin the part does not have.
const broken = structuredClone(spec)
const conn = broken.connections[0]
conn.from.pin = 'NOT_A_REAL_PIN'
const before = conn.id

const layout = layoutWiring(broken.components, broken.connections)

console.log('connections:', broken.connections.length)
console.log('wires drawn:', layout.wires.length)
console.log('unresolved:', layout.unresolved.length)
console.log('details:', layout.unresolved)
const drawnStillHasIt = layout.wires.some(w => w.from.pin === 'NOT_A_REAL_PIN')
console.log('\nPASS bogus pin was NOT drawn (dropped and reported)' .replace('PASS', drawnStillHasIt ? 'FAIL' : 'PASS'))
console.log('PASS wire count dropped by exactly one' .replace('PASS', layout.wires.length === broken.connections.length - 1 ? 'PASS' : 'FAIL'))
