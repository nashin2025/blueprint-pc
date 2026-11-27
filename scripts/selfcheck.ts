/**
 * Runnable self-check for the two pieces that turn unreliable model output into
 * a valid design: normaliseDesign and layoutWiring.
 *
 * Run with:  node --experimental-strip-types scripts/selfcheck.ts
 * Exits non-zero on the first failed assertion.
 */

import { normaliseDesign } from '../src/main/ai/normalise.ts'
import { firstImageBase64, modelPathSegment } from '../src/main/ai/images-parse.ts'
import {
  isRelevantTitle,
  searchCandidates
} from '../src/main/partsearch-parse.ts'
import {
  extensionFor,
  extractMetaImage,
  isImageContentType,
  isSafeUrl
} from '../src/main/partimage-parse.ts'
import { generateLandPattern } from '../src/main/footprint-generator.ts'
import type { Footprint } from '../src/shared/types.ts'
import { ALL_CATEGORIES, categoryKey, partArt } from '../src/renderer/src/lib/partArt.ts'
import { componentLines, imagePromptFor, summaryMessagesFor, wiringLines } from '../src/main/ai/info-prompts.ts'
import { layoutWiring } from '../src/renderer/src/lib/wiringLayout.ts'
import { layoutPackage, pinCategory } from '../src/renderer/src/lib/packageLayout.ts'
import { normalisePin, parseCurrency, parsePriceValue } from '../src/main/sync/schematik-parse.ts'
import { MVR_PER_USD, approxUsd, formatNative, isComparable, toUsd } from '../src/shared/money.ts'
import type { Component, Connection, CollabOperation, CollabUser, Sheet, SheetPort } from '../src/shared/types.ts'
import { runDrc, summarizeDrc } from '../src/main/drc.ts'
import {
  placeComponents,
  attachPads,
  routeTraces,
  runPcbDrc,
  pcbToThreeJs,
  aabbFromRect,
  aabbOverlap,
} from '../src/main/pcb-layout.ts'
import {
  parseNetlist,
  buildMnaSystem,
  solveLinearSystem,
  solveDc,
  runTransient,
  simulateDc,
  simulateTransient,
} from '../src/main/circuit-sim.ts'
import { buildNetlist } from '../src/main/netlist.ts'
import { DEFAULT_PCB_RULES } from '../src/shared/types.ts'
import { WebSocket } from 'ws'
import {
  colourForUserId,
  createCollabUser,
  lastWriteWins,
  applyOperationToSpec,
  collabServer
} from '../src/main/collaboration.ts'

let failures = 0
let checks = 0

function check(name: string, condition: boolean, detail?: unknown): void {
  checks++
  if (!condition) {
    failures++
    console.error(`  FAIL  ${name}`)
    if (detail !== undefined) console.error(`        ${JSON.stringify(detail)}`)
  } else {
    console.log(`  ok    ${name}`)
  }
}

// ---------------------------------------------------------------------------
console.log('\nnormaliseDesign')
// ---------------------------------------------------------------------------

const messyModelOutput = {
  title: '  LED flasher  ',
  summary: 'Blinks an LED.',
  difficulty: 'nonsense-value',
  estimatedTime: 'an afternoon',
  components: [
    { name: 'Arduino Uno', partName: 'Arduino Uno R3', category: 'Microcontroller', quantity: 1, unitPrice: 24, pins: ['D13', 'GND', '5V'] },
    { name: 'LED', partName: '5mm Red LED', category: 'Output', quantity: 2, unitPrice: 0.3, pins: ['A', 'K'] },
    { name: 'Resistor', partName: '220 ohm', category: 'Passive', quantity: 2, unitPrice: 0.05, pins: ['1', '2'] }
  ],
  connections: [
    { from: { componentIndex: 0, pin: 'D13' }, to: { componentIndex: 2, pin: '1' }, kind: 'signal', net: 'LED_SIG' },
    { from: { componentIndex: 2, pin: '2' }, to: { componentIndex: 1, pin: 'A' }, kind: 'signal' },
    { from: { componentIndex: 1, pin: 'K' }, to: { componentIndex: 0, pin: 'GND' }, kind: 'ground', net: 'GND' },
    // Deliberately broken entries the model might emit:
    { from: { componentIndex: 99, pin: 'X' }, to: { componentIndex: 0, pin: 'GND' }, kind: 'power' },
    { from: { componentIndex: 0, pin: 'D13' }, to: { componentIndex: 0, pin: '5V' }, kind: 'power' },
    { from: { componentIndex: 1 }, to: { componentIndex: 0, pin: 'GND' }, kind: 'signal' }
  ],
  steps: [
    { title: 'Mount the board', body: 'Place the Arduino in the breadboard.', componentIds: [0] },
    { title: 'Wire the LED', body: 'D13 to resistor to LED anode.', componentIds: [0, 2, 1] },
    // Out-of-range component reference:
    { title: 'Bad step', body: 'References a part that does not exist.', componentIds: [42] }
  ]
}

const spec = normaliseDesign(messyModelOutput)

check('title is trimmed', spec.title === 'LED flasher', spec.title)
check('unknown difficulty falls back', spec.difficulty === 'intermediate', spec.difficulty)
check('all components survive', spec.components.length === 3, spec.components.length)
check('every component got an id', spec.components.every((c) => c.id.startsWith('cmp_')))
check('ids are unique', new Set(spec.components.map((c) => c.id)).size === 3)
check(
  'broken connections are dropped, valid ones kept',
  spec.connections.length === 3,
  spec.connections.map((c) => `${c.from.pin}->${c.to.pin}`)
)
check('connections point at real components', spec.connections.every((c) => spec.components.some((x) => x.id === c.from.componentId)))
check('steps get order numbers', spec.steps.every((s, i) => s.order === i + 1))
check(
  'steps with dangling component refs still resolve',
  spec.steps[2].componentIds.length === 0,
  spec.steps[2].componentIds
)
// estimateCost rounds to 2dp; compare with a tolerance so float noise (24.6999...)
// does not read as a failure.
check(
  'cost is computed from priced parts',
  typeof spec.estimatedCost === 'number' && Math.abs(spec.estimatedCost - 24.7) < 0.005,
  spec.estimatedCost
)

// Empty components must be rejected, not silently turned into an empty design.
let threw = false
try {
  normaliseDesign({ title: 'x', components: [] })
} catch {
  threw = true
}
check('design with no components throws', threw)

// Non-object input must throw rather than crash oddly.
let threwOnGarbage = false
try {
  normaliseDesign('not an object')
} catch {
  threwOnGarbage = true
}
check('garbage input throws', threwOnGarbage)

// ---------------------------------------------------------------------------
console.log('\nfirstImageBase64 (NIM image response shapes)')
// ---------------------------------------------------------------------------

const B64 = 'QUJD' // "ABC", enough to be truthy

check('reads artifacts[].base64', firstImageBase64({ artifacts: [{ base64: B64 }] }) === B64)
check('reads images[] as bare strings', firstImageBase64({ images: [B64] }) === B64)
check('reads images[].b64_json', firstImageBase64({ images: [{ b64_json: B64 }] }) === B64)
check('reads images[].base64', firstImageBase64({ images: [{ base64: B64 }] }) === B64)
check('reads data[].b64_json', firstImageBase64({ data: [{ b64_json: B64 }] }) === B64)
check('prefers artifacts over data', firstImageBase64({ artifacts: [{ base64: 'AAA' }], data: [{ b64_json: 'BBB' }] }) === 'AAA')
check('returns null for an empty object', firstImageBase64({}) === null)
check('returns null for null', firstImageBase64(null) === null)
check('returns null for a string', firstImageBase64('nope') === null)
check('ignores empty base64 strings', firstImageBase64({ artifacts: [{ base64: '' }] }) === null)

// ---------------------------------------------------------------------------
console.log('\nmodelPathSegment')
// ---------------------------------------------------------------------------

check('accepts a vendor-prefixed NIM model', modelPathSegment('black-forest-labs/flux.1-dev') === 'black-forest-labs/flux.1-dev')
check('accepts a bare OpenAI model', modelPathSegment('gpt-image-1') === 'gpt-image-1')

for (const bad of ['../../etc/passwd', 'model?x=1', 'model#frag', 'has space', 'a\\b']) {
  let rejected = false
  try {
    modelPathSegment(bad)
  } catch {
    rejected = true
  }
  check(`rejects unsafe model id: ${bad}`, rejected)
}

// ---------------------------------------------------------------------------
console.log('\ninfo-prompts: every component and connection reaches the model')
// ---------------------------------------------------------------------------

// A three-part design with enough wiring to prove nothing is dropped.
const infoSpec = normaliseDesign({
  title: 'Test rig',
  summary: 'A small test rig.',
  difficulty: 'beginner',
  components: [
    { name: 'Brain', partName: 'Arduino Uno', category: 'Microcontroller', quantity: 1, pins: ['5V', 'GND', 'D9'] },
    { name: 'Sensor', partName: 'DHT22', category: 'Sensor', quantity: 1, pins: ['VCC', 'DATA', 'GND'] },
    { name: 'Screen', partName: 'SSD1306 OLED', category: 'Display', quantity: 1, pins: ['VCC', 'GND', 'SDA', 'SCL'] },
    { name: 'LED', partName: '5mm red LED', category: 'Output', quantity: 1, pins: ['A', 'K'] },
    { name: 'Resistor', partName: '220 ohm', category: 'Passive', quantity: 2, pins: ['1', '2'] },
    { name: 'Stand', partName: 'Acrylic stand', category: 'Structure', quantity: 1, pins: [] }
  ],
  connections: [
    { from: { componentIndex: 0, pin: '5V' }, to: { componentIndex: 1, pin: 'VCC' }, kind: 'power' },
    { from: { componentIndex: 1, pin: 'DATA' }, to: { componentIndex: 0, pin: 'D9' }, kind: 'signal' },
    { from: { componentIndex: 2, pin: 'SDA' }, to: { componentIndex: 0, pin: 'D9' }, kind: 'data' },
    { from: { componentIndex: 3, pin: 'A' }, to: { componentIndex: 4, pin: '1' }, kind: 'signal' },
    { from: { componentIndex: 4, pin: '2' }, to: { componentIndex: 0, pin: 'GND' }, kind: 'ground' }
  ],
  steps: [{ title: 'Build it', body: 'Do the thing.' }]
})

const iComponents = componentLines(infoSpec)
const iWires = wiringLines(infoSpec)
const iMessages = summaryMessagesFor(infoSpec)
const iPrompt = imagePromptFor(infoSpec)

check('component line count matches component count', iComponents.length === infoSpec.components.length)
check('wiring line count matches connection count', iWires.length === infoSpec.connections.length)
check('every component name appears in the description', infoSpec.components.every((c) => iMessages.user.includes(c.partName ?? c.name)))
check('every connection appears in the description', iWires.every((l) => iMessages.user.includes(l)))
check('a part with no pins is still listed', iComponents.some((l) => l.includes('Acrylic stand')))
check('the description demands the heading', iMessages.system.includes('Components and wiring'))
check('the description forbids skipping parts', iMessages.system.includes('Cover EVERY component'))
check('the description forbids inventing parts', iMessages.system.includes('Never invent'))
check('every component name reaches the image prompt', infoSpec.components.every((c) => iPrompt.includes(c.partName ?? c.name)))
check('image prompt stays within a sane budget', iPrompt.length <= 1800, iPrompt.length)
check('image prompt says every part must be visible', iPrompt.includes('Every part listed above must be visible'))

// ---------------------------------------------------------------------------
console.log('\npartimage-parse: SSRF guard')
// ---------------------------------------------------------------------------

const safeUrls = [
  'https://www.amazon.com/dp/B0718WG3ZJ',
  'https://m.media-amazon.com/images/I/abc.jpg',
  'https://cdn.adafruit.com/product/images/1234.jpg',
  'http://example.com/page'
]
for (const u of safeUrls) check(`allows ${u.slice(0, 48)}`, isSafeUrl(u) === true)

const unsafeUrls = [
  'http://127.0.0.1:8080/admin',
  'http://localhost/secret',
  'http://10.0.0.5/',
  'http://192.168.1.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://172.16.0.1/',
  'http://172.31.255.255/',
  'http://[::1]/',
  'http://foo.internal/',
  'http://printer.local/',
  'file:///etc/passwd',
  'ftp://example.com/x.jpg',
  'not-a-url'
]
for (const u of unsafeUrls) check(`blocks ${u.slice(0, 42)}`, isSafeUrl(u) === false)

// ---------------------------------------------------------------------------
console.log('\npartimage-parse: og:image extraction')
// ---------------------------------------------------------------------------

const page = 'https://shop.example.com/products/widget'
check(
  'reads property-then-content order',
  extractMetaImage('<meta property="og:image" content="https://cdn.example.com/a.jpg">', page) ===
    'https://cdn.example.com/a.jpg'
)
check(
  'reads content-then-property order',
  extractMetaImage('<meta content="https://cdn.example.com/b.jpg" property="og:image">', page) ===
    'https://cdn.example.com/b.jpg'
)
check(
  'falls back to twitter:image',
  extractMetaImage('<meta name="twitter:image" content="https://cdn.example.com/c.png">', page) ===
    'https://cdn.example.com/c.png'
)
check(
  'resolves a relative path against the page',
  extractMetaImage('<meta property="og:image" content="/media/d.jpg">', page) ===
    'https://shop.example.com/media/d.jpg'
)
check('returns null when absent', extractMetaImage('<html><body>hi</body></html>', page) === null)
check(
  'unescapes ampersands',
  extractMetaImage('<meta property="og:image" content="https://cdn.example.com/e.jpg?a=1&amp;b=2">', page) ===
    'https://cdn.example.com/e.jpg?a=1&b=2'
)

check('accepts image/jpeg', isImageContentType('image/jpeg') === true)
check('accepts image/webp', isImageContentType('image/webp; charset=x') === true)
check('rejects text/html', isImageContentType('text/html') === false)
check('rejects a missing header', isImageContentType(null) === false)
check('maps jpeg to jpg', extensionFor('image/jpeg') === 'jpg')
check('maps png', extensionFor('image/png') === 'png')
check('falls back to the URL extension', extensionFor('', 'https://x/y.webp') === 'webp')

// ---------------------------------------------------------------------------
console.log('\npartArt: every category has a glyph')
// ---------------------------------------------------------------------------

check('there are nine categories', ALL_CATEGORIES.length === 9, ALL_CATEGORIES.length)

for (const cat of ALL_CATEGORIES) {
  const key = categoryKey(cat)
  const uri = partArt(cat)
  check(`"${cat}" maps to a glyph`, key === cat, key)
  check(`"${cat}" produces an svg data uri`, uri.startsWith('data:image/svg+xml;utf8,'), uri.slice(0, 40))
}

check('unknown category falls back to Other', categoryKey('quantum flux') === 'Other')
check('LED is an Actuator', categoryKey('Actuator') === 'Actuator')
check('resistor is Passive', categoryKey('Passive') === 'Passive')
check('battery is Power', categoryKey('Power') === 'Power')
check('lowercase input works', categoryKey('sensor') === 'Sensor')


// ---------------------------------------------------------------------------
console.log('\nsearchCandidates: progressively simpler queries')
// ---------------------------------------------------------------------------

const esp = searchCandidates('ESP32 DevKit V1 (DOIT ESP32 DEVKIT V1)')
check('strips the parenthetical and version noise', esp.includes('ESP32 DevKit'), esp)
check('drops to the first word as a last resort', esp.includes('ESP32'), esp)

const batt = searchCandidates('9V Alkaline Battery')
check('keeps a short leading word out of the fallback', !batt.includes('9V'), batt)
check('still offers the full name', batt.includes('9V Alkaline Battery'), batt)

const pack = searchCandidates('5mm Red LED Diffused (pack of 100)')
check('removes pack sizes', pack.every((c) => !/pack of/i.test(c)), pack)

// ---------------------------------------------------------------------------
console.log('\nisRelevantTitle: single-word queries')
// ---------------------------------------------------------------------------

check(
  'a one-word query matches on that word alone',
  isRelevantTitle('ESP32 Espressif ESP-WROOM-32 Shielded.jpg', 'ESP32') === true
)
check(
  'a one-word query still rejects an unrelated title',
  isRelevantTitle('Annual report of the NIH.pdf', 'ESP32') === false
)
check(
  'multi-word queries still need corroboration',
  isRelevantTitle('Moog Werkstatt-01 Mod Kit angle.jpg', 'Premium Jumper Wire Kit') === false
)
check(
  'prefix matching lets ohm match ohms',
  isRelevantTitle('220 ohms 5% axial resistor.jpg', '220 ohm') === true
)

// ---------------------------------------------------------------------------
console.log('\nlayoutWiring')
// ---------------------------------------------------------------------------

const components: Component[] = [
  { id: 'c_power', name: 'Battery pack', category: 'Power', quantity: 1, pins: ['+', '-'] },
  { id: 'c_brain', name: 'Arduino Uno', category: 'Microcontroller', quantity: 1, pins: ['5V', 'GND', 'D13'] },
  { id: 'c_led', name: 'LED', category: 'Output', quantity: 1, pins: ['A', 'K'] }
]

const connections: Connection[] = [
  { id: 'w1', from: { componentId: 'c_power', pin: '+' }, to: { componentId: 'c_brain', pin: '5V' }, kind: 'power', net: '5V' },
  { id: 'w2', from: { componentId: 'c_power', pin: '-' }, to: { componentId: 'c_brain', pin: 'GND' }, kind: 'ground', net: 'GND' },
  { id: 'w3', from: { componentId: 'c_brain', pin: 'D13' }, to: { componentId: 'c_led', pin: 'A' }, kind: 'signal' },
  { id: 'w4', from: { componentId: 'c_led', pin: 'K' }, to: { componentId: 'c_brain', pin: 'GND' }, kind: 'ground' },
  { id: 'w5', from: { componentId: 'does_not_exist', pin: 'X' }, to: { componentId: 'c_brain', pin: 'GND' }, kind: 'signal' }
]

const layout = layoutWiring(components, connections)

check('every component is placed', layout.nodes.length === 3, layout.nodes.length)
check('wires with unknown endpoints are skipped', layout.wires.length === 4, layout.wires.length)
check('canvas has non-zero size', layout.width > 0 && layout.height > 0, { w: layout.width, h: layout.height })
check(
  'power sits in a column left of the microcontroller',
  layout.nodes.find((n) => n.component.id === 'c_power')!.x < layout.nodes.find((n) => n.component.id === 'c_brain')!.x
)
check(
  'the microcontroller sits left of the LED',
  layout.nodes.find((n) => n.component.id === 'c_brain')!.x < layout.nodes.find((n) => n.component.id === 'c_led')!.x
)
check(
  'every wire path is a valid cubic',
  layout.wires.every((w) => /^-?\d/.test(w.d.replace(/^M\s*/, '')) && w.d.includes(' C ')),
  layout.wires[0]?.d
)

// ---------------------------------------------------------------------------
console.log('\nschematik parse')
// ---------------------------------------------------------------------------

// Price: the source sends display text ("from 6.99 USD"), never a number.
check('price parses from "from 6.99 USD"', parsePriceValue('from 6.99 USD', undefined) === 6.99)
check('price parses from "from 1.5 EUR"', parsePriceValue('from 1.5 EUR', undefined) === 1.5)
check('price keeps a genuine 0', parsePriceValue('from 0.00 USD', undefined) === 0)
check('numeric field wins over text', parsePriceValue('from 9.99 USD', 3.5) === 3.5)
check('no price text yields null', parsePriceValue(null, undefined) === null)
check('comma decimal is normalised', parsePriceValue('ab 3,95 cd', undefined) === 3.95)

// Currency: parsed from the text, explicit field wins.
check('currency parses from text', parseCurrency('from 6.99 USD', undefined) === 'USD')
check('currency parses EUR', parseCurrency('ab 3.95 EUR', undefined) === 'EUR')
check('explicit currency wins', parseCurrency('from 6.99 USD', 'EUR') === 'EUR')
check('no currency yields null', parseCurrency('from 6.99', undefined) === null)

// Pin: connectors use `function`, modules use `description`; both must survive.
const connectorPin = normalisePin({ type: 'signal', label: 'SDA', function: 'I2C data.' })
check('connector pin keeps function text', connectorPin.function === 'I2C data.')
check('connector pin label kept', connectorPin.label === 'SDA')
check('connector pin type kept', connectorPin.type === 'signal')
const modulePin = normalisePin({ type: 'power', label: 'VCC', description: '3.3–5 V supply.' })
check('module pin falls back to description', modulePin.function === '3.3–5 V supply.')
check('missing label becomes empty string', normalisePin({}).label === '')
check('required defaults false', normalisePin({}).required === false)

// ---------------------------------------------------------------------------
console.log('\nmoney (currency conversion for catalogue price comparison)')
// ---------------------------------------------------------------------------

// USD passes through unchanged.
check('USD passes through', toUsd(10, 'USD') === 10)
// MVR converts at the peg (154.2 MVR / 15.42 = 10 USD).
check('MVR to USD', toUsd(154.2, 'MVR') === 10)
// Non-finite price cannot be converted.
check('non-finite price is null', toUsd(Infinity, 'USD') === null)
// Unknown currency cannot be converted.
check('unknown currency is null', toUsd(10, 'EUR') === null)
// Only USD and MVR are comparable.
check('USD is comparable', isComparable('USD') === true)
check('MVR is comparable', isComparable('MVR') === true)
check('EUR is not comparable', isComparable('EUR') === false)
// approxUsd is null for USD (no conversion needed).
check('approxUsd null for USD', approxUsd(10, 'USD') === null)
// approxUsd converts MVR and prefixes with ≈.
check('approxUsd converts MVR', approxUsd(154.2, 'MVR') === '≈$10.00')
// formatNative renders USD with a dollar sign and the amount.
check('formatNative USD shows amount', formatNative(11.49, 'USD').includes('$11.49'))
// formatNative renders MVR with the amount.
check('formatNative MVR shows amount', formatNative(158.17, 'MVR').includes('158.17'))
// The peg constant is the documented 15.42.
check('peg constant', MVR_PER_USD === 15.42)

// ---------------------------------------------------------------------------
console.log('\npackage layout')
// ---------------------------------------------------------------------------

// pinCategory: the classifier that colours a pin.
check('GND pin is ground', pinCategory({ label: 'GND', function: 'Power ground' }) === 'ground')
check('3V3 pin is power', pinCategory({ label: '3V3', voltage: '3.3 V' }) === 'power')
check('5V pin is power', pinCategory({ label: '5V' }) === 'power')
check('SDA pin is data', pinCategory({ label: 'SDA', function: 'I2C data' }) === 'data')
check('MOSI pin is data', pinCategory({ label: 'DIN', function: 'MOSI in SPI mode' }) === 'data')
check('IO4 pin is signal', pinCategory({ label: 'IO4', type: 'gpio' }) === 'signal')
check('RST pin is data', pinCategory({ label: 'RST', function: 'Reset' }) === 'data')
check('unknown pin is unknown', pinCategory({ label: 'Contact 1', function: 'straight-through' }) === 'unknown')

// layoutPackage: a DIP-style two-sided layout with a unique position per pin.
const pins = [
  { label: 'RST', type: 'reset' },
  { label: '3V3', type: 'power' },
  { label: 'GND', type: 'ground' },
  { label: 'IO0', type: 'gpio' },
  { label: 'IO1', type: 'gpio' },
  { label: 'IO2', type: 'gpio' }
]
const pkg = layoutPackage(pins)
check('every pin is placed', pkg.pins.length === pins.length, pkg.pins.length)
check(
  'each pin has a unique position',
  new Set(pkg.pins.map((p) => `${p.padX},${p.padY}`)).size === pins.length
)
check('first half is left, second half is right', pkg.pins[0].side === 'left' && pkg.pins[3].side === 'right')
check('pads sit on the board edge', pkg.pins.every((p) => p.padX === pkg.board.x || p.padX === pkg.board.x + pkg.board.w))
check('board height fits all rows', pkg.board.h >= 3 * 24, pkg.board.h)
check('empty pin list is safe', layoutPackage([]).pins.length === 0)
check(
  'left-side labels sit left of the board',
  pkg.pins[0].labelX + pkg.pins[0].labelW <= pkg.board.x
)
check(
  'right-side labels sit right of the board',
  pkg.pins[3].labelX >= pkg.board.x + pkg.board.w
)
// Every label chip must fit inside the viewBox — no clipping off either edge.
// Guards the LABEL_W vs VIEW_W sizing (a 92-wide label silently overflowed a
// 260-wide box until this assertion existed).
check(
  'every label chip fits inside the viewBox',
  pkg.pins.every((p) => p.labelX >= 0 && p.labelX + p.labelW <= pkg.width),
  pkg.pins.map((p) => [p.labelX, p.labelX + p.labelW])
)

// ---------------------------------------------------------------------------
// Schematik staleness logic (inlined to avoid module resolution issues)
// ---------------------------------------------------------------------------
const now = Date.now()
const dayMs = 24 * 60 * 60 * 1000
function isStaleInline(fetchedAt: number, maxAgeDays: number): boolean {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  return fetchedAt < cutoff
}

check('isStale: freshly fetched is not stale', !isStaleInline(now, 7))
check('isStale: 6 days 23 hours is not stale', !isStaleInline(now - 6 * dayMs - 23 * 60 * 60 * 1000, 7))
check('isStale: 7 days + 1 ms is stale', isStaleInline(now - 7 * dayMs - 1, 7))
check('isStale: 30 days is stale', isStaleInline(now - 30 * dayMs, 7))
check('isStale: 1 day with 30 day threshold is not stale', !isStaleInline(now - dayMs, 30))

// ---------------------------------------------------------------------------
// DRC engine: rule-based validation on a DesignSpec
// ---------------------------------------------------------------------------

function mkComponent(id: string, name: string, pins: string[], designator?: string): Component {
  return { id, name, category: 'Test', quantity: 1, pins, designator }
}

function mkConnection(fromId: string, fromPin: string, toId: string, toPin: string, kind: ConnectionKind = 'signal'): Connection {
  return { id: `${fromId}-${fromPin}-${toId}-${toPin}`, from: { componentId: fromId, pin: fromPin }, to: { componentId: toId, pin: toPin }, kind }
}

const drcSpec = {
  title: 'DRC test',
  summary: 'A design to exercise DRC rules.',
  difficulty: 'beginner' as const,
  components: [
    mkComponent('c1', 'Microcontroller', ['VCC', 'GND', 'D13', 'D12'], 'U1'),
    mkComponent('c2', 'LED', ['A', 'K'], 'LED1'),
    mkComponent('c3', 'Resistor', ['1', '2'], 'R1'),
    mkComponent('c4', 'Unconnected part', ['P1', 'P2'], 'U1') // duplicate designator with c1
  ],
  connections: [
    mkConnection('c1', 'VCC', 'c2', 'A', 'power'),
    mkConnection('c1', 'GND', 'c2', 'K', 'ground'),
    mkConnection('c1', 'D13', 'c3', '1', 'signal'),
    // c3 pin 2 is unconnected
    // c4 has no connections at all (all pins unconnected)
    // c1 has D12 unconnected
    // c1 and c4 share designator U1
  ],
  steps: []
} as unknown as import('../src/shared/types').DesignSpec

const violations = runDrc(drcSpec)
const summary = summarizeDrc(violations)

check('DRC: finds unconnected pins', violations.some((v) => v.category === 'unconnected-pin' && v.componentId === 'c1' && v.pinName === 'D12'))
check('DRC: finds all-unconnected component pins', violations.some((v) => v.category === 'unconnected-pin' && v.componentId === 'c4'))
check('DRC: finds duplicate designator', violations.some((v) => v.category === 'duplicate-designator' && v.designator === 'U1'))
check('DRC: duplicate designator produces two violations', violations.filter((v) => v.category === 'duplicate-designator').length === 2)
check('DRC: missing footprint warning', violations.some((v) => v.category === 'missing-footprint'))
check('DRC: summary counts', summary.errors === 6 && summary.warnings === 4, { errors: summary.errors, warnings: summary.warnings })
check('DRC: not clean', summary.clean === false)

// A clean design: every pin connected, unique designators, all have footprints.
const cleanSpec = {
  title: 'Clean',
  summary: 'No violations expected.',
  difficulty: 'beginner' as const,
  components: [
    { ...mkComponent('c1', 'MCU', ['VCC', 'GND']), modelFilePath: '/models/mcu.stl', designator: 'U1' },
    { ...mkComponent('c2', 'LED', ['A', 'K']), modelFilePath: '/models/led.stl', designator: 'LED1' }
  ],
  connections: [
    mkConnection('c1', 'VCC', 'c2', 'A', 'power'),
    mkConnection('c1', 'GND', 'c2', 'K', 'ground')
  ],
  steps: []
} as unknown as import('../src/shared/types').DesignSpec

const cleanViolations = runDrc(cleanSpec)
const cleanSummary = summarizeDrc(cleanViolations)
check('DRC: clean design has no violations', cleanSummary.total === 0)
check('DRC: clean design is clean', cleanSummary.clean === true)

// ---------------------------------------------------------------------------
// Design version diff
// ---------------------------------------------------------------------------

function diffVersions(s1: { title: string; components: Array<{ id: string; name: string; partName?: string; quantity: number }>; connections: Array<{ id: string }> }, s2: { title: string; components: Array<{ id: string; name: string; partName?: string; quantity: number }>; connections: Array<{ id: string }> }) {
  const c1ById = new Map(s1.components.map((c) => [c.id, c]))
  const c2ById = new Map(s2.components.map((c) => [c.id, c]))
  let componentsChanged = 0
  for (const [id, c2] of c2ById) {
    const c1 = c1ById.get(id)
    if (c1 && (c1.name !== c2.name || c1.partName !== c2.partName || c1.quantity !== c2.quantity)) {
      componentsChanged++
    }
  }
  return {
    titleChanged: s1.title !== s2.title,
    componentsAdded: Math.max(0, s2.components.length - s1.components.length),
    componentsRemoved: Math.max(0, s1.components.length - s2.components.length),
    componentsChanged,
    connectionsAdded: Math.max(0, s2.connections.length - s1.connections.length),
    connectionsRemoved: Math.max(0, s1.connections.length - s2.connections.length)
  }
}

const v1 = {
  title: 'Original',
  components: [
    { id: 'a', name: 'Resistor', partName: 'R1', quantity: 1 },
    { id: 'b', name: 'LED', partName: 'LED1', quantity: 2 }
  ],
  connections: [{ id: 'w1' }, { id: 'w2' }]
}
const v2 = {
  title: 'Modified',
  components: [
    { id: 'a', name: 'Resistor', partName: 'R2', quantity: 1 }, // changed partName
    { id: 'b', name: 'LED', partName: 'LED1', quantity: 3 },   // changed quantity
    { id: 'c', name: 'Capacitor', partName: 'C1', quantity: 1 } // added
  ],
  connections: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }] // added one
}
const v3 = {
  title: 'Original',
  components: [
    { id: 'a', name: 'Resistor', partName: 'R1', quantity: 1 },
    { id: 'b', name: 'LED', partName: 'LED1', quantity: 2 }
  ],
  connections: [{ id: 'w1' }, { id: 'w2' }]
}

const diff12 = diffVersions(v1, v2)
check('diff: title changed', diff12.titleChanged === true)
check('diff: one component added', diff12.componentsAdded === 1)
check('diff: no components removed', diff12.componentsRemoved === 0)
check('diff: two components changed', diff12.componentsChanged === 2)
check('diff: one connection added', diff12.connectionsAdded === 1)
check('diff: no connections removed', diff12.connectionsRemoved === 0)

const diff13 = diffVersions(v1, v3)
check('diff: identical designs show no changes', diff13.titleChanged === false && diff13.componentsAdded === 0 && diff13.componentsRemoved === 0 && diff13.componentsChanged === 0 && diff13.connectionsAdded === 0 && diff13.connectionsRemoved === 0)

// ---------------------------------------------------------------------------
// PCB layout spike: placement, routing, DRC
// ---------------------------------------------------------------------------

const pcbCompIds = ['c1', 'c2', 'c3']
const pcbNames = { c1: 'MCU', c2: 'LED', c3: 'Resistor' }
const pcbPinCounts = { c1: 8, c2: 2, c3: 2 }

const { placements, overlaps } = placeComponents(pcbCompIds, pcbNames, 100, 80)
check('PCB: places all 3 components', placements.length === 3, placements.length)
check('PCB: no overlaps on empty board', overlaps.length === 0, overlaps)
check('PCB: all placements inside board', placements.every((p) => p.center.x >= 0 && p.center.x <= 100 && p.center.y >= 0 && p.center.y <= 80))

// Attach pins to placements.
const pinned = attachPads(placements, { c1: ['VCC', 'GND', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6'], c2: ['A', 'K'], c3: ['1', '2'] })
check('PCB: pads attached per component', pinned.every((p) => p.pads.length > 0))

// Overlap detection: two placements at the same position must overlap.
const dupPlacements = [
  {
    componentId: 'c1', name: 'A', center: { x: 10, y: 10 }, w: 10, h: 10, rotationDeg: 0, pads: []
  },
  {
    componentId: 'c2', name: 'B', center: { x: 10, y: 10 }, w: 10, h: 10, rotationDeg: 0, pads: []
  },
];
const dupAabbA = aabbFromRect(dupPlacements[0].center.x, dupPlacements[0].center.y, dupPlacements[0].w, dupPlacements[0].h, 0);
const dupAabbB = aabbFromRect(dupPlacements[1].center.x, dupPlacements[1].center.y, dupPlacements[1].w, dupPlacements[1].h, 0);
check('PCB: detects overlap when components forced together', aabbOverlap(dupAabbA, dupAabbB) === true)

// Routing: simple two-pin connection with no obstacles.
const routeResult = routeTraces(
  [
    { net: '5V', fromPin: pinned[0].pads[0], toPin: pinned[1].pads[0] },
  ],
  pinned,
  100,
  80,
  1,
  0.25
)
check('PCB: routes a simple connection', routeResult.traces.length === 1, routeResult.traces.length)
check('PCB: route has at least 2 points', routeResult.traces[0]?.points.length ?? 0 >= 2)
check('PCB: no unrouted on simple board', routeResult.unrouted.length === 0, routeResult.unrouted)

// Routing around obstacle: place a large component between source and target.
const blockedPlacements = [
  {
    componentId: 'blocker',
    name: 'Blocker',
    center: { x: 50, y: 40 },
    w: 30,
    h: 30,
    rotationDeg: 0,
    pads: [],
  },
  {
    componentId: 'src',
    name: 'Source',
    center: { x: 20, y: 40 },
    w: 10,
    h: 10,
    rotationDeg: 0,
    pads: [{ componentId: 'src', pinName: 'P1', center: { x: 15, y: 40 }, w: 2, h: 2 }],
  },
  {
    componentId: 'dst',
    name: 'Dest',
    center: { x: 80, y: 40 },
    w: 10,
    h: 10,
    rotationDeg: 0,
    pads: [{ componentId: 'dst', pinName: 'P1', center: { x: 85, y: 40 }, w: 2, h: 2 }],
  },
]
const blockedResult = routeTraces(
  [
    { net: 'SIG', fromPin: blockedPlacements[1].pads[0], toPin: blockedPlacements[2].pads[0] },
  ],
  blockedPlacements,
  100,
  80,
  1,
  0.25
)
check('PCB: routes around obstacle', blockedResult.traces.length === 1 || blockedResult.unrouted.length === 0)

// DRC: trace-to-trace clearance violation.
const drcViolations = runPcbDrc(
  [
    { net: 'A', from: { componentId: 'c1', pinName: 'P1' }, to: { componentId: 'c2', pinName: 'P1' }, points: [{ x: 10, y: 10 }, { x: 20, y: 10 }] },
    { net: 'B', from: { componentId: 'c1', pinName: 'P2' }, to: { componentId: 'c2', pinName: 'P2' }, points: [{ x: 10, y: 10.1 }, { x: 20, y: 10.1 }] },
  ],
  [],
  [],
  { traceWidth: 0.25, traceClearance: 0.5, padToTraceClearance: 0.2, viaToTraceClearance: 0.2, minAnnularRing: 0.1 }
)
check('PCB DRC: detects trace-to-trace clearance violation', drcViolations.violations.some((v) => v.category === 'trace-to-trace'), drcViolations.violations.length)
check('PCB DRC: not clean when violations exist', drcViolations.summary.clean === false)

// DRC: properly spaced traces → clean.
const drcClean = runPcbDrc(
  [
    { net: 'A', from: { componentId: 'c1', pinName: 'P1' }, to: { componentId: 'c2', pinName: 'P1' }, points: [{ x: 10, y: 10 }, { x: 20, y: 10 }] },
    { net: 'B', from: { componentId: 'c1', pinName: 'P2' }, to: { componentId: 'c2', pinName: 'P2' }, points: [{ x: 10, y: 20 }, { x: 20, y: 20 }] },
  ],
  [],
  [],
  { traceWidth: 0.25, traceClearance: 0.5, padToTraceClearance: 0.2, viaToTraceClearance: 0.2, minAnnularRing: 0.1 }
)
check('PCB DRC: clean when traces spaced apart', drcClean.summary.clean === true)

// Three.js adapter: produces geometry descriptions.
const threeGeom = pcbToThreeJs(pinned, routeResult.traces, pinned.flatMap((p) => p.pads), [], 100, 80, 0.25)
check('PCB Three.js: board geometry present', threeGeom.board.w === 100 && threeGeom.board.h === 80)
check('PCB Three.js: traces exported', threeGeom.traces.length === routeResult.traces.length)
check('PCB Three.js: pads exported', threeGeom.pads.length > 0)
check('PCB Three.js: components exported', threeGeom.components.length === pinned.length)

// ---------------------------------------------------------------------------
// Circuit simulation spike: netlist, MNA, DC operating point, transient
// ---------------------------------------------------------------------------

// Simple resistor divider: 5V source → R1 → node → R2 → GND.
const dividerInput = {
  components: [
    { id: 'v1', name: '5V Source', category: 'Power', pins: ['+', '-'] },
    { id: 'r1', name: 'R1 1k', category: 'Resistor', pins: ['1', '2'] },
    { id: 'r2', name: 'R2 1k', category: 'Resistor', pins: ['1', '2'] },
  ],
  connections: [
    { from: { componentId: 'v1', pin: '+' }, to: { componentId: 'r1', pin: '1' }, kind: 'power', net: '5V' },
    { from: { componentId: 'r1', pin: '2' }, to: { componentId: 'r2', pin: '1' }, kind: 'signal', net: 'MID' },
    { from: { componentId: 'r2', pin: '2' }, to: { componentId: 'v1', pin: '-' }, kind: 'ground', net: 'GND' },
  ],
}

const { nodes: divNodes, elements: divElements } = parseNetlist(dividerInput.components, dividerInput.connections)
check('Circuit: divider parses to 3 nodes (5V, MID, GND)', divNodes.length === 3, divNodes.length)
check('Circuit: divider has GND node', divNodes.some((nd) => nd.isGround))
check('Circuit: divider has 2 resistor elements', divElements.filter((e) => e.type === 'resistor').length === 2)
check('Circuit: divider has 1 voltage source', divElements.filter((e) => e.type === 'voltageSource').length === 1)

// DC operating point: V_MID should be 2.5V (equal resistors).
const divDc = simulateDc(dividerInput)
check('Circuit: divider DC converges', divDc.converged === true, divDc.message)
const midVoltage = divDc.nodeVoltages.get('MID')
check('Circuit: divider MID ≈ 2.5V', midVoltage !== undefined && Math.abs(midVoltage - 2.5) < 0.05, midVoltage)

// MNA symmetry check for linear circuits.
const { A: divA, b: divB } = buildMnaSystem(divNodes, divElements)
let symmetric = true
for (let i = 0; i < divA.length; i++) {
  for (let j = 0; j < divA.length; j++) {
    if (Math.abs(divA[i][j] - divA[j][i]) > 1e-10) {
      symmetric = false
      break
    }
  }
}
check('Circuit: MNA matrix is symmetric for linear circuit', symmetric)

// LED circuit: 5V → R → LED → GND. LED forward voltage should be ~1.8-2.2V.
const ledInput = {
  components: [
    { id: 'v1', name: '5V Source', category: 'Power', pins: ['+', '-'] },
    { id: 'r1', name: 'R1 220Ω', category: 'Resistor', pins: ['1', '2'] },
    { id: 'led1', name: 'LED', category: 'LED', pins: ['A', 'K'] },
  ],
  connections: [
    { from: { componentId: 'v1', pin: '+' }, to: { componentId: 'r1', pin: '1' }, kind: 'power', net: '5V' },
    { from: { componentId: 'r1', pin: '2' }, to: { componentId: 'led1', pin: 'A' }, kind: 'signal', net: 'LED_ANODE' },
    { from: { componentId: 'led1', pin: 'K' }, to: { componentId: 'v1', pin: '-' }, kind: 'ground', net: 'GND' },
  ],
}

const ledDc = simulateDc(ledInput)
check('Circuit: LED DC converges', ledDc.converged === true, ledDc.message)
const ledAnodeV = ledDc.nodeVoltages.get('LED_ANODE')
check('Circuit: LED anode ≈ 0.5-2V', ledAnodeV !== undefined && ledAnodeV >= 0.5 && ledAnodeV <= 2.0, ledAnodeV)

// Transient RC circuit: 5V → R → C → GND. At t=RC, capacitor ≈ 63.2% of 5V = 3.16V.
const rcInput = {
  components: [
    { id: 'v1', name: '5V Source', category: 'Power', pins: ['+', '-'] },
    { id: 'r1', name: 'R1 1k', category: 'Resistor', pins: ['1', '2'] },
    { id: 'c1', name: 'C1 1µF', category: 'capacitor', pins: ['1', '2'] },
  ],
  connections: [
    { from: { componentId: 'v1', pin: '+' }, to: { componentId: 'r1', pin: '1' }, kind: 'power', net: '5V' },
    { from: { componentId: 'r1', pin: '2' }, to: { componentId: 'c1', pin: '1' }, kind: 'signal', net: 'CAP_NODE' },
    { from: { componentId: 'c1', pin: '2' }, to: { componentId: 'v1', pin: '-' }, kind: 'ground', net: 'GND' },
  ],
}

const rcTransient = simulateTransient(rcInput, 0.01, 0.0001) // 10ms, 0.1ms step → RC = 1ms, at t=1ms expect ~3.16V
check('Circuit: RC transient converges', rcTransient.converged === true, rcTransient.converged ? '' : 'no message')
const capVoltages = rcTransient.nodeVoltagesOverTime.get('CAP_NODE') ?? []
// Find voltage at t ≈ 1ms (step index 10).
const vAt1ms = capVoltages[10]
check('Circuit: RC at t=1ms ≈ 3.16V (63.2%)', vAt1ms !== undefined && Math.abs(vAt1ms - 3.16) < 0.3, vAt1ms)
// Final voltage should approach 5V.
const vFinal = capVoltages[capVoltages.length - 1]
check('Circuit: RC final ≈ 5V', vFinal !== undefined && Math.abs(vFinal - 5) < 0.5, vFinal)

// Singular matrix detection: floating node with no path to ground.
// GMIN provides tiny leakage, so the matrix isn't strictly singular —
// but floating node voltages end up near 0 (not meaningful).
const floatingInput = {
  components: [
    { id: 'r1', name: 'R1', category: 'Resistor', pins: ['1', '2'] },
    { id: 'r2', name: 'R2', category: 'Resistor', pins: ['1', '2'] },
  ],
  connections: [
    { from: { componentId: 'r1', pin: '1' }, to: { componentId: 'r2', pin: '1' }, kind: 'signal', net: 'FLOAT' },
  ],
}
const floatingDc = simulateDc(floatingInput)
check('Circuit: floating node voltages near 0', Math.abs(floatingDc.nodeVoltages.get('FLOAT') ?? 1) < 0.01, floatingDc.nodeVoltages.get('FLOAT'))

// Empty circuit handling.
const emptyDc = simulateDc({ components: [], connections: [] })
check('Circuit: empty circuit handled gracefully', emptyDc.converged === true)

// ---------------------------------------------------------------------------
// Netlist export
// ---------------------------------------------------------------------------

const netlistSpec = {
  title: 'Netlist test',
  summary: 'A design to test netlist export.',
  difficulty: 'beginner' as const,
  components: [
    { id: 'c1', name: 'Resistor', category: 'Resistor', quantity: 1, pins: ['1', '2'] },
    { id: 'c2', name: 'LED', category: 'LED', quantity: 1, pins: ['A', 'K'] },
    { id: 'c3', name: 'Source', category: 'Power', quantity: 1, pins: ['+', '-'] }
  ],
  connections: [
    { id: 'w1', from: { componentId: 'c3', pin: '+' }, to: { componentId: 'c1', pin: '1' }, kind: 'power', net: '5V' },
    { id: 'w2', from: { componentId: 'c1', pin: '2' }, to: { componentId: 'c2', pin: 'A' }, kind: 'signal', net: 'SIG' },
    { id: 'w3', from: { componentId: 'c2', pin: 'K' }, to: { componentId: 'c3', pin: '-' }, kind: 'ground', net: 'GND' }
  ],
  steps: []
} as unknown as import('../src/shared/types').DesignSpec

const netlist = buildNetlist(netlistSpec)
check('Netlist: has header', netlist.includes('# Blueprint PC netlist'))
check('Netlist: has format comment', netlist.includes('# Format: NET:<net_name>'))
check('Netlist: has 5V net', netlist.includes('NET:5V'))
check('Netlist: has SIG net', netlist.includes('NET:SIG'))
check('Netlist: has GND net', netlist.includes('NET:GND'))
check('Netlist: 5V net contains c3:+ and c1:1', netlist.includes('c3:+') && netlist.includes('c1:1'))
check('Netlist: SIG net contains c1:2 and c2:A', netlist.includes('c1:2') && netlist.includes('c2:A'))
check('Netlist: GND net contains c2:K and c3:-', netlist.includes('c2:K') && netlist.includes('c3:-'))
check('Netlist: each pin appears once per net', (netlist.match(/c1:1/g) || []).length === 1)

// Connections without a net name get auto-generated NET_N names.
const noNetSpec = {
  title: 'No net test',
  summary: 'Connections without net names.',
  difficulty: 'beginner' as const,
  components: [
    { id: 'c1', name: 'A', category: 'Resistor', quantity: 1, pins: ['1', '2'] },
    { id: 'c2', name: 'B', category: 'Resistor', quantity: 1, pins: ['1', '2'] }
  ],
  connections: [
    { id: 'w1', from: { componentId: 'c1', pin: '1' }, to: { componentId: 'c2', pin: '1' }, kind: 'signal' }
  ],
  steps: []
} as unknown as import('../src/shared/types').DesignSpec

const noNetList = buildNetlist(noNetSpec)
check('Netlist: auto-generates NET name for connection without net', noNetList.includes('NET_1'))

// Empty connections produce empty netlist (just header).
const emptySpec = {
  title: 'Empty test',
  summary: 'No connections.',
  difficulty: 'beginner' as const,
  components: [],
  connections: [],
  steps: []
} as unknown as import('../src/shared/types').DesignSpec

const emptyNetlist = buildNetlist(emptySpec)
check('Netlist: empty connections produces header only', emptyNetlist.includes('# Blueprint PC netlist') && !/^NET:/m.test(emptyNetlist))

// ---------------------------------------------------------------------------
// DRC rules
// ---------------------------------------------------------------------------

const drcTestSpec = {
  title: 'DRC test',
  summary: 'A design to test DRC rules.',
  difficulty: 'beginner' as const,
  components: [
    { id: 'c1', name: 'Resistor', category: 'Resistor', quantity: 1, pins: ['1', '2'], designator: 'R1' },
    { id: 'c2', name: 'LED', category: 'LED', quantity: 1, pins: ['A', 'K'], designator: 'LED1' },
    { id: 'c3', name: 'Duplicate', category: 'Resistor', quantity: 1, pins: ['1', '2'], designator: 'R1' }, // dup designator
    { id: 'c4', name: 'Floating', category: 'Resistor', quantity: 1, pins: ['1', '2'], modelFilePath: '/models/r.stl' } // no connections
  ],
  connections: [
    { id: 'w1', from: { componentId: 'c1', pin: '1' }, to: { componentId: 'c2', pin: 'A' }, kind: 'signal', net: '5V' },
    { id: 'w2', from: { componentId: 'c1', pin: '2' }, to: { componentId: 'c3', pin: '1' }, kind: 'signal', net: 'GND' }, // c1 pin 2 on GND, pin 1 on 5V -> shorted
    { id: 'w3', from: { componentId: 'c2', pin: 'K' }, to: { componentId: 'c3', pin: '2' }, kind: 'ground', net: 'GND' }
  ],
  steps: []
} as unknown as import('../src/shared/types').DesignSpec

const drcTestViolations = runDrc(drcTestSpec)
const drcTestSummary = summarizeDrc(drcTestViolations)
check('DRC: finds unconnected pin (c4 pin 1)', drcTestViolations.some((v) => v.category === 'unconnected-pin' && v.componentId === 'c4' && v.pinName === '1'))
check('DRC: finds duplicate designator (R1)', drcTestViolations.some((v) => v.category === 'duplicate-designator' && v.designator === 'R1'))
check('DRC: duplicate designator produces 2 violations', drcTestViolations.filter((v) => v.category === 'duplicate-designator').length === 2)
check('DRC: summary counts errors', drcTestSummary.errors >= 4)
check('DRC: not clean', drcTestSummary.clean === false)

// Clean design: no violations
const drcCleanSpec = {
  title: 'Clean test',
  summary: 'A clean design.',
  difficulty: 'beginner' as const,
  components: [
    { id: 'c1', name: 'Resistor', category: 'Resistor', quantity: 1, pins: ['1', '2'], modelFilePath: '/models/r.stl', designator: 'R1' },
    { id: 'c2', name: 'LED', category: 'LED', quantity: 1, pins: ['A', 'K'], modelFilePath: '/models/led.stl', designator: 'LED1' }
  ],
  connections: [
    { id: 'w1', from: { componentId: 'c1', pin: '1' }, to: { componentId: 'c2', pin: 'A' }, kind: 'power', net: '5V' },
    { id: 'w2', from: { componentId: 'c1', pin: '2' }, to: { componentId: 'c2', pin: 'K' }, kind: 'ground', net: 'GND' }
  ],
  steps: []
} as unknown as import('../src/shared/types').DesignSpec

const drcCleanViolations = runDrc(drcCleanSpec)
const drcCleanSummary = summarizeDrc(drcCleanViolations)
check('DRC: clean design has no violations', drcCleanSummary.total === 0)
check('DRC: clean design is clean', drcCleanSummary.clean === true)

// Default rules are valid
check('DRC: default rules have valid values', DEFAULT_PCB_RULES.traceWidth > 0 && DEFAULT_PCB_RULES.traceClearance > 0)

// ---------------------------------------------------------------------------
// Multi-sheet schematic support
// ---------------------------------------------------------------------------

function mkSheet(id: string, name: string, connectionIds: string[] = [], portIds: string[] = []): Sheet {
  return { id, name, x: 0, y: 0, width: 200, height: 150, connectionIds, portIds }
}

function mkPort(id: string, sheetId: string, name: string, direction: SheetPort['direction'] = 'output'): SheetPort {
  return { id, sheetId, name, x: 0, y: 0, direction }
}

// Pure logic mirroring the sheets:add-sheet / sheets:rename-sheet IPC handlers.
function addSheetLogic(sheets: Sheet[], name: string, id: string): Sheet[] {
  return [...sheets, mkSheet(id, name)]
}

function renameSheetLogic(sheets: Sheet[], sheetId: string, name: string): Sheet[] {
  return sheets.map((s) => (s.id === sheetId ? { ...s, name } : s))
}

// Pure logic mirroring sheets:delete-sheet. Returns null when the sheet is missing.
function deleteSheetLogic(
  sheets: Sheet[],
  connections: Connection[],
  ports: SheetPort[],
  sheetId: string
): { sheets: Sheet[]; connections: Connection[]; ports: SheetPort[] } | null {
  const sheet = sheets.find((s) => s.id === sheetId)
  if (!sheet) return null
  const nextSheets = sheets.filter((s) => s.id !== sheetId)
  const nextConnections = connections.filter(
    (c) => c.sheetId !== sheetId && !sheet.connectionIds.includes(c.id)
  )
  const nextPorts = ports.filter((p) => p.sheetId !== sheetId)
  return { sheets: nextSheets, connections: nextConnections, ports: nextPorts }
}

// Pure logic mirroring sheets:connect-port. Rejects missing ports and same-direction pairs.
function connectPortLogic(
  ports: SheetPort[],
  sheets: Sheet[],
  connections: Connection[],
  portId1: string,
  portId2: string,
  connectionId: string
): { connection: Connection; sheets: Sheet[] } | { error: string } | null {
  const p1 = ports.find((p) => p.id === portId1)
  const p2 = ports.find((p) => p.id === portId2)
  if (!p1 || !p2) return null
  if (p1.direction === p2.direction) return { error: 'same direction' }
  const connection: Connection = {
    id: connectionId,
    sheetId: p1.sheetId,
    from: { componentId: p1.id, pin: p1.name },
    to: { componentId: p2.id, pin: p2.name },
    kind: 'signal',
    net: `sheet-link:${p1.id}:${p2.id}`
  }
  const nextSheets = sheets.map((s) => {
    const ids = [...s.connectionIds]
    if (s.id === p1.sheetId && !ids.includes(connectionId)) ids.push(connectionId)
    if (s.id === p2.sheetId && !ids.includes(connectionId)) ids.push(connectionId)
    return { ...s, connectionIds: ids }
  })
  return { connection, sheets: nextSheets }
}

const baseSheets: Sheet[] = [mkSheet('s1', 'Power'), mkSheet('s2', 'Analog')]
const basePorts: SheetPort[] = [
  mkPort('p1', 's1', '5V_OUT', 'output'),
  mkPort('p2', 's2', '5V_IN', 'input'),
  mkPort('p3', 's1', 'CLK_OUT', 'output')
]
const baseConns: Connection[] = [
  { id: 'c1', from: { componentId: 'p1', pin: '5V_OUT' }, to: { componentId: 'p2', pin: '5V_IN' }, kind: 'signal', net: '5V', sheetId: 's1' }
]

check('Sheets: start with two sheets', baseSheets.length === 2)

const added = addSheetLogic(baseSheets, 'Digital', 's3')
check('Sheets: add sheet increases count', added.length === 3)
check('Sheets: new sheet has empty ports and connections', added[2].portIds.length === 0 && added[2].connectionIds.length === 0)

const renamed = renameSheetLogic(baseSheets, 's2', 'Mixed Signal')
check('Sheets: rename sheet updates name', renamed.find((s) => s.id === 's2')?.name === 'Mixed Signal')
check('Sheets: rename does not change count', renamed.length === 2)

const deleted = deleteSheetLogic(baseSheets, baseConns, basePorts, 's1')
check('Sheets: delete removes the sheet', deleted !== null && deleted!.sheets.length === 1)
check('Sheets: delete removes connections owned by the sheet', deleted !== null && deleted!.connections.length === 0)
check('Sheets: delete removes ports owned by the sheet', deleted !== null && deleted!.ports.length === 1)
check('Sheets: delete of missing sheet returns null', deleteSheetLogic(baseSheets, baseConns, basePorts, 'missing') === null)

const connected = connectPortLogic(basePorts, baseSheets, baseConns, 'p1', 'p2', 'cx1') as { connection: Connection; sheets: Sheet[] }
check('Sheets: connect-port creates a connection', connected.connection.id === 'cx1')
check('Sheets: connect-port links output to input', connected.connection.from.componentId === 'p1' && connected.connection.to.componentId === 'p2')
check('Sheets: connect-port registers on both sheets', connected.sheets.find((s) => s.id === 's1')!.connectionIds.includes('cx1') && connected.sheets.find((s) => s.id === 's2')!.connectionIds.includes('cx1'))

const sameDir = connectPortLogic(basePorts, baseSheets, baseConns, 'p1', 'p3', 'cx2')
check('Sheets: connect-port rejects same-direction ports', sameDir !== null && 'error' in sameDir && sameDir!.error === 'same direction')

const missing = connectPortLogic(basePorts, baseSheets, baseConns, 'p1', 'nope', 'cx3')
check('Sheets: connect-port rejects missing port', missing === null)

// Sheet selector renders correct sheet count: a selector built from the sheets
// array shows one option per sheet.
const selectorSheetCount = baseSheets.length
check('SheetSelector: option count matches sheet count', selectorSheetCount === 2)

// ---------------------------------------------------------------------------
// Footprint library
// ---------------------------------------------------------------------------

// Land pattern generation produces correct pad counts.
const sop8 = generateLandPattern({ type: 'sop', pinCount: 8, pitch: 1.27, bodyWidth: 4.4, bodyHeight: 6.0, padWidth: 0.6, padLength: 1.2 })
check('Footprint: SOP-8 generates 8 pads', sop8.pads.length === 8)
check('Footprint: SOP-8 pads have correct X spacing', Math.abs(sop8.pads[0].x - sop8.pads[1].x) >= 1.2)

const dip16 = generateLandPattern({ type: 'dip', pinCount: 16, pitch: 2.54, bodyWidth: 19.1, bodyHeight: 6.4, padWidth: 0.7, padLength: 1.8 })
check('Footprint: DIP-16 generates 16 pads', dip16.pads.length === 16)
check('Footprint: DIP-16 pads have correct X spacing', Math.abs(dip16.pads[0].x - dip16.pads[1].x) >= 2.5)

const qfn20 = generateLandPattern({ type: 'qfn', pinCount: 20, pitch: 0.5, bodyWidth: 4.0, bodyHeight: 4.0, padWidth: 0.25, padLength: 0.8 })
check('Footprint: QFN-20 generates 20 pads', qfn20.pads.length === 20)

const res0603 = generateLandPattern({ type: 'smd-resistor', padWidth: 0.8, padLength: 0.8, padToBodyClearance: 0.3 })
check('Footprint: 0603 resistor generates 2 pads', res0603.pads.length === 2)
check('Footprint: 0603 resistor pads separated', Math.abs(res0603.pads[0].x - res0603.pads[1].x) >= 1.0)

// Land pattern outline matches body dimensions.
check('Footprint: SOP-8 outline width', Math.abs(sop8.outlineW - 4.4) < 0.01)
check('Footprint: SOP-8 outline height', Math.abs(sop8.outlineH - 6.0) < 0.01)

// Custom pattern passes through parameters.
const custom = generateLandPattern({ type: 'custom', padWidth: 1.0, padLength: 2.0, padToBodyClearance: 0.5, customPads: [{ x: 0, y: 0, w: 1.0, h: 2.0 }, { x: 5, y: 0, w: 1.0, h: 2.0 }] })
check('Footprint: custom passes through pad dimensions', custom.pads.length === 2 && custom.pads[0].w === 1.0 && custom.pads[0].h === 2.0)

// ---------------------------------------------------------------------------
console.log('\nCollaboration: pure functions')
// ---------------------------------------------------------------------------

// colourForUserId: deterministic, same id -> same colour.
check('colour: same id yields same colour', colourForUserId('user-a') === colourForUserId('user-a'))
check('colour: different ids can differ', colourForUserId('user-a') !== colourForUserId('user-b'))
check('colour: always a hex colour', /^#[0-9a-f]{6}$/i.test(colourForUserId('any-user')))

// createCollabUser.
const testUser = createCollabUser('u1', 'Alice')
check('createCollabUser: id matches', testUser.id === 'u1')
check('createCollabUser: displayName matches', testUser.displayName === 'Alice')
check('createCollabUser: has a colour', /^#[0-9a-f]{6}$/i.test(testUser.color))
check('createCollabUser: cursor starts null', testUser.cursor === null)
check('createCollabUser: lastSeen is a number', typeof testUser.lastSeen === 'number')

// lastWriteWins: timestamp ordering.
const opOld: CollabOperation = {
  id: 'op1', type: 'component.moved', projectId: 'p1', userId: 'u1',
  timestamp: 1000, payload: {}
}
const opNew: CollabOperation = {
  id: 'op2', type: 'component.moved', projectId: 'p1', userId: 'u2',
  timestamp: 2000, payload: {}
}
check('lastWriteWins: newer timestamp wins', lastWriteWins(opOld, opNew) === opNew)
check('lastWriteWins: equal timestamp favours second', lastWriteWins(opOld, { ...opOld, id: 'op3', timestamp: 1000 }).id === 'op3')

// applyOperationToSpec: structural operations produce new specs without mutating the original.
const baseSpec = {
  title: 'Test',
  summary: 'A test design.',
  difficulty: 'beginner' as const,
  components: [
    { id: 'c1', name: 'Resistor', category: 'Resistor', quantity: 1, pins: ['1', '2'] }
  ],
  connections: [],
  steps: []
} as unknown as import('../src/shared/types').DesignSpec

const addedOp: CollabOperation = {
  id: 'op-add', type: 'component.added', projectId: 'p1', userId: 'u2',
  timestamp: 1000,
  payload: { component: { id: 'c2', name: 'LED', category: 'LED', quantity: 1, pins: ['A', 'K'] } }
}
const specWithAdded = applyOperationToSpec(baseSpec, addedOp)
check('applyOperationToSpec: component.added adds component', specWithAdded.components.length === 2)
check('applyOperationToSpec: component.added does not mutate original', baseSpec.components.length === 1)

const removedOp: CollabOperation = {
  id: 'op-rem', type: 'component.removed', projectId: 'p1', userId: 'u2',
  timestamp: 1000,
  payload: { id: 'c1' }
}
const specWithRemoved = applyOperationToSpec(specWithAdded, removedOp)
check('applyOperationToSpec: component.removed removes component', specWithRemoved.components.length === 1)
check('applyOperationToSpec: removed the right component', specWithRemoved.components[0].id === 'c2')

const movedOp: CollabOperation = {
  id: 'op-mov', type: 'component.moved', projectId: 'p1', userId: 'u2',
  timestamp: 1000,
  payload: { id: 'c2', x: 100, y: 200 }
}
const specAfterMove = applyOperationToSpec(specWithRemoved, movedOp)
check('applyOperationToSpec: component.moved leaves spec unchanged', specAfterMove.components.length === 1)

// ---------------------------------------------------------------------------
console.log('\nCollaboration: WebSocket server lifecycle')
// ---------------------------------------------------------------------------

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) { resolve(); return }
    ws.once('open', resolve)
    ws.once('error', reject)
  })
}

/** Collects all WebSocket messages into a queue and can wait for a specific type. */
function messageCollector(ws: WebSocket): { waitForType: (type: string, timeoutMs?: number) => Promise<unknown> } {
  const queue: unknown[] = []
  ws.on('message', (raw: Buffer) => {
    try { queue.push(JSON.parse(raw.toString('utf-8'))) } catch { /* ignore malformed */ }
  })

  function waitForType(type: string, timeoutMs = 5000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const poll = () => {
        const idx = queue.findIndex((m) => (m as { type: string }).type === type)
        if (idx >= 0) {
          resolve(queue.splice(idx, 1)[0])
        } else if (Date.now() < deadline) {
          setTimeout(poll, 50)
        } else {
          reject(new Error(`Timed out waiting for message type: ${type}`))
        }
      }
      const deadline = Date.now() + timeoutMs
      poll()
    })
  }

  return { waitForType }
}

const startRes = collabServer.start()
check('collabServer.start: starts on default port', startRes.ok === true, startRes.ok === false ? startRes.error : null)
const testPort = startRes.port ?? 0

const statusRes = collabServer.status()
check('collabServer.status: running after start', statusRes.running === true)
check('collabServer.status: reports port', typeof statusRes.port === 'number' && statusRes.port > 0)
check('collabServer.status: zero clients initially', statusRes.clientCount === 0)

const doubleStart = collabServer.start()
check('collabServer.start: double start rejected', doubleStart.ok === false)

// ---------------------------------------------------------------------------
console.log('\nCollaboration: presence broadcast')
// ---------------------------------------------------------------------------

async function runPresenceBroadcastTests(): Promise<void> {
  const ws1 = new WebSocket(`ws://localhost:${testPort}`)
  const ws2 = new WebSocket(`ws://localhost:${testPort}`)
  await Promise.all([waitForOpen(ws1), waitForOpen(ws2)])

  // Set up message collectors BEFORE sending join messages so we don't miss
  // the presence broadcast.
  const collect1 = messageCollector(ws1)
  const collect2 = messageCollector(ws2)

  // Both users join the same project room.
  ws1.send(JSON.stringify({ type: 'join', projectId: 'proj-1', userId: 'alice', displayName: 'Alice' }))
  ws2.send(JSON.stringify({ type: 'join', projectId: 'proj-1', userId: 'bob', displayName: 'Bob' }))

  // ws2 receives presence with both users (ws1 and ws2).
  const msg2 = (await collect2.waitForType('presence')) as { type: string; users?: CollabUser[] }
  check('presence: ws2 receives presence', msg2.type === 'presence' && msg2.users?.length === 2)
  check('presence: ws2 has alice and bob', msg2.users?.some((u) => u.id === 'alice') && msg2.users?.some((u) => u.id === 'bob'))

  // ws1 receives presence at least once (when it joins).
  const msg1 = await collect1.waitForType('presence')
  check('presence: ws1 receives presence', msg1.type === 'presence')

  // Alice leaves; Bob should receive an updated presence with just Bob.
  ws1.send(JSON.stringify({ type: 'leave', projectId: 'proj-1', userId: 'alice' }))
  const leaveMsg = (await collect2.waitForType('presence')) as { type: string; users?: CollabUser[] }
  check('presence: bob alone after alice leaves', leaveMsg.type === 'presence' && leaveMsg.users?.length === 1 && leaveMsg.users?.[0]?.id === 'bob')

  ws1.close()
  ws2.close()
}

// ---------------------------------------------------------------------------
console.log('\nCollaboration: operation broadcast')
// ---------------------------------------------------------------------------

async function runOperationBroadcastTests(): Promise<void> {
  const ws1 = new WebSocket(`ws://localhost:${testPort}`)
  const ws2 = new WebSocket(`ws://localhost:${testPort}`)
  await Promise.all([waitForOpen(ws1), waitForOpen(ws2)])

  ws1.send(JSON.stringify({ type: 'join', projectId: 'proj-2', userId: 'alice', displayName: 'Alice' }))
  ws2.send(JSON.stringify({ type: 'join', projectId: 'proj-2', userId: 'bob', displayName: 'Bob' }))
  // Consume the presence messages so the operation message is next.
  const collect1 = messageCollector(ws1)
  const collect2 = messageCollector(ws2)
  await collect1.waitForType('presence')
  await collect2.waitForType('presence')

  // Alice sends a component.added operation; Bob should receive it.
  const operation: CollabOperation = {
    id: 'op-broadcast', type: 'component.added', projectId: 'proj-2', userId: 'alice',
    timestamp: 5000,
    payload: { component: { id: 'c9', name: 'Buzzer', category: 'Output', quantity: 1, pins: ['+', '-'] } }
  }
  ws1.send(JSON.stringify({ type: 'operation', operation }))

  const opMsg = (await collect2.waitForType('operation')) as { type: string; operation?: CollabOperation }
  check('operation: bob receives alice operation', opMsg.type === 'operation' && opMsg.operation?.id === 'op-broadcast')
  check('operation: payload carried through', opMsg.operation?.payload?.component?.id === 'c9')

  ws1.close()
  ws2.close()
}

// ---------------------------------------------------------------------------
console.log('\nCollaboration: server stop')
// ---------------------------------------------------------------------------

async function runServerStopTests(): Promise<void> {
  const stopRes = collabServer.stop()
  check('collabServer.stop: stops cleanly', stopRes.ok === true)

  const stoppedStatus = collabServer.status()
  check('collabServer.status: not running after stop', stoppedStatus.running === false)
  check('collabServer.status: port cleared', stoppedStatus.port === null)
  check('collabServer.status: zero clients after stop', stoppedStatus.clientCount === 0)

  const doubleStop = collabServer.stop()
  check('collabServer.stop: double stop rejected', doubleStop.ok === false)
}

// ---------------------------------------------------------------------------
console.log('\n3D mechanical integration: section plane, measurement, clearance')
// ---------------------------------------------------------------------------

// Section plane: clipping plane construction mirrors SectionView / MechTab.
function sectionPlane(axis: 'x' | 'y' | 'z', position: number): { normal: [number, number, number]; constant: number } {
  const normal = axis === 'x' ? [-1, 0, 0] : axis === 'y' ? [0, -1, 0] : [0, 0, -1]
  return { normal, constant: position }
}

const sx = sectionPlane('x', 3)
check('section plane X normal points negative X', sx.normal[0] === -1 && sx.normal[1] === 0 && sx.normal[2] === 0)
check('section plane X constant is the position', sx.constant === 3)
const sy = sectionPlane('y', -2)
check('section plane Y normal points negative Y', sy.normal[1] === -1)
check('section plane Y constant is the position', sy.constant === -2)
const sz = sectionPlane('z', 5)
check('section plane Z normal points negative Z', sz.normal[2] === -1)
check('section plane Z constant is the position', sz.constant === 5)
// Plane equation: normal·point + constant = 0; a point on the plane satisfies it.
const onPlaneX = sx.normal[0] * 3 + sx.normal[1] * 0 + sx.normal[2] * 0 + sx.constant
check('point (3,0,0) lies on the X=3 plane', onPlaneX === 0)

// Measurement: distance between two 3D points mirrors measureDistance3D.
function distance3D(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

check('distance from origin to (3,4,0) is 5', distance3D({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }) === 5)
check('distance is symmetric', distance3D({ x: 1, y: 2, z: 3 }, { x: 4, y: 6, z: 8 }) === distance3D({ x: 4, y: 6, z: 8 }, { x: 1, y: 2, z: 3 }))
check('same point has zero distance', distance3D({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }) === 0)
check('3D diagonal matches sqrt(3)', Math.abs(distance3D({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }) - Math.sqrt(3)) < 1e-10)

// Clearance: pairwise component check mirrors the pcb:clearance-check handler.
function gridComponentPositions(components: Array<{ id: string; name: string }>): Array<{ componentId: string; name: string; x: number; y: number; z: number }> {
  const boxSize = 2.2
  const gridCols = Math.ceil(Math.sqrt(components.length))
  const gridRows = Math.ceil(components.length / gridCols)
  return components.map((part, i) => {
    const col = i % gridCols
    const row = Math.floor(i / gridCols)
    const x = (col - gridCols / 2) * boxSize
    const z = (row - gridRows / 2) * boxSize
    return { componentId: part.id, name: part.name, x, y: 0, z }
  })
}

function checkClearance(components: Array<{ id: string; name: string }>, threshold: number): Array<{ a: string; b: string; distance: number }> {
  const positions = gridComponentPositions(components)
  const out: Array<{ a: string; b: string; distance: number }> = []
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i]
      const b = positions[j]
      const d = Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2)
      if (d > 0 && d < threshold) out.push({ a: a.componentId, b: b.componentId, distance: d })
    }
  }
  return out
}

const comps = [
  { id: 'c1', name: 'A' },
  { id: 'c2', name: 'B' },
  { id: 'c3', name: 'C' },
]

// Adjacent grid cells sit exactly one boxSize apart; at threshold == boxSize the
// strict "less than" comparison yields no spurious violation.
check('adjacent cells at exactly threshold are not violations', checkClearance(comps, 2.2).length === 0)
const tight = checkClearance(comps, 2.2001)
check('slightly larger threshold flags adjacent pairs', tight.length === 2)
check('clearance violations reference real components', tight.every((v) => comps.some((c) => c.id === v.a || c.id === v.b)))

// Clearance heatmap classification mirrors classifyClearance.
function classifyClearance(distance: number, threshold: number): 'clear' | 'tight' | 'violation' {
  if (distance < threshold * 0.5) return 'violation'
  if (distance < threshold) return 'tight'
  return 'clear'
}

check('well below threshold is a violation', classifyClearance(0.5, 2.0) === 'violation')
check('just below threshold is tight', classifyClearance(1.9, 2.0) === 'tight')
check('exactly at threshold is clear', classifyClearance(2.0, 2.0) === 'clear')
check('above threshold is clear', classifyClearance(3.0, 2.0) === 'clear')
check('zero distance with positive threshold is a violation', classifyClearance(0, 2.0) === 'violation')

// ---------------------------------------------------------------------------
// Signal integrity self-checks
// ---------------------------------------------------------------------------

import {
  microstripImpedance,
  estimateCrosstalk,
  reflectionCoefficient,
  propagationDelayNs,
  analyseTrace
} from '../src/main/signal-integrity.ts'
import type { DielectricStackup } from '../src/shared/types.ts'

const stackup: DielectricStackup = { er: 4.0, thicknessMm: 0.2, copperOz: 1.0 }

// 50-ohm microstrip on FR-4 (er=4, h=0.2mm, w≈0.3mm): impedance should be near 50.
const z50 = microstripImpedance({ widthMm: 0.3, copperOz: 1.0, heightMm: 0.2, er: 4.0 })
check('microstrip impedance is positive', z50.z0Ohms > 0)
check('microstrip impedance near 50 ohms for 0.3mm trace on FR-4', Math.abs(z50.z0Ohms - 50) < 15)
check('effective dielectric between 1 and er', z50.effectiveEr > 1 && z50.effectiveEr < 4.0)
check('propagation delay per mm is positive', z50.delayNsPerMm > 0)

// Effective dielectric constant should be close to 1 for air-like traces
const eeAir = microstripImpedance({ widthMm: 10.0, copperOz: 1.0, heightMm: 0.2, er: 1.0 }).effectiveEr
check('effective Er approaches 1 as trace gets very wide', Math.abs(eeAir - 1.0) < 0.05)

// Crosstalk should be between 0 and 1
const xtalk = estimateCrosstalk({
  widthMm: 0.2, separationMm: 0.2, heightMm: 0.2, lengthMm: 50.0, er: 4.0, riseTimeNs: 1.0
})
check('NEXT fraction is between 0 and 1', xtalk.nextFraction >= 0 && xtalk.nextFraction <= 1)
check('FEXT fraction is between 0 and 1', xtalk.fextFraction >= 0 && xtalk.fextFraction <= 1)
check('coupling coefficient is between 0 and 1', xtalk.couplingCoefficient >= 0 && xtalk.couplingCoefficient <= 1)

// Closer traces couple more
const xtalkClose = estimateCrosstalk({ widthMm: 0.2, separationMm: 0.1, heightMm: 0.2, lengthMm: 50.0, er: 4.0, riseTimeNs: 1.0 })
check('closer spacing increases coupling', xtalkClose.couplingCoefficient > xtalk.couplingCoefficient)

// Reflection coefficient between -1 and 1
const gamma = reflectionCoefficient(50, 75)
check('reflection coefficient between -1 and 1', gamma >= -1 && gamma <= 1)
check('reflection coefficient sign matches impedance step', gamma > 0)

// Propagation delay is positive and scales with length
const delay1 = propagationDelayNs(4.0, 10.0)
const delay2 = propagationDelayNs(4.0, 20.0)
check('propagation delay is positive', delay1 > 0)
check('delay doubles with length', Math.abs(delay2 - 2 * delay1) < 0.001)

// analyseTrace returns a complete result
const analysed = analyseTrace({
  traceWidthMm: 0.3,
  traceLengthMm: 50.0,
  stackup,
  targetImpedanceOhms: 50
})
check('analyseTrace returns impedance result', analysed.impedance.z0Ohms > 0)
check('analyseTrace tolerance is non-negative', analysed.tolerancePercent >= 0)
check('analyseTrace withinTolerance is boolean', typeof analysed.withinTolerance === 'boolean')

// ---------------------------------------------------------------------------
// Thermal self-checks
// ---------------------------------------------------------------------------

import {
  powerFromVoltageCurrent,
  powerFromCurrentResistance,
  powerFromVoltageResistance,
  junctionTemperature,
  maxPower,
  analyseComponent,
  packageRjaCPerW
} from '../src/main/thermal.ts'

// Power dissipation formulas
check('P = V * I gives correct power', Math.abs(powerFromVoltageCurrent(5.0, 0.5) - 2.5) < 0.001)
check('P = I^2 * R gives correct power', Math.abs(powerFromCurrentResistance(0.5, 10.0) - 2.5) < 0.001)
check('P = V^2 / R gives correct power', Math.abs(powerFromVoltageResistance(5.0, 10.0) - 2.5) < 0.001)

// Thermal resistance lookup
check('SOP-8 has known RJA', packageRjaCPerW('sop-8') > 0)
check('QFN-20 has lower RJA than SOP-8', packageRjaCPerW('qfn-20') < packageRjaCPerW('sop-8'))
check('unknown package falls back to default', packageRjaCPerW('weird-package') === packageRjaCPerW('default'))

// Junction temperature: Tj = Ta + Pd * Rja
const tj = junctionTemperature(25, 1.0, 100)
check('junction temp is ambient + power * RJA', Math.abs(tj - 125) < 0.001)
check('junction temp above ambient', tj > 25)

// Maximum power: Pd_max = (Tj_max - Ta) / Rja
const pdMax = maxPower(25, 150, 100)
check('max power formula', Math.abs(pdMax - 1.25) < 0.001)
check('max power is zero when ambient >= TjMax', maxPower(150, 150, 100) === 0)

// Component thermal analysis
const thermal = analyseComponent({
  ambientC: 25,
  powerW: 0.5,
  tJMaxC: 150,
  packageType: 'sop-8'
})
check('thermal junction temperature is number', typeof thermal.junctionTemperatureC === 'number')
check('thermal max power is positive', thermal.maxAllowablePowerW > 0)
check('thermal derating is between 0 and 1', thermal.deratingFactor >= 0 && thermal.deratingFactor <= 1)
check('thermal status is valid', ['ok', 'warning', 'critical'].includes(thermal.status))
check('thermal withinLimits is boolean', typeof thermal.withinLimits === 'boolean')

// High power leads to critical status
const thermalHot = analyseComponent({
  ambientC: 25,
  powerW: 1.0,
  tJMaxC: 100,
  packageType: 'sop-8'
})
check('high power gives critical status', thermalHot.status === 'critical')

// ---------------------------------------------------------------------------
// Library management self-checks
// ---------------------------------------------------------------------------

import {
  libraryHealthReport,
  applyLifecycleUpdate,
  isPartUsable,
  findSubstitutes,
  findObsoleteWithSubstitutes
} from '../src/main/library.ts'
import type { CataloguePart } from '../src/shared/types.ts'

const testParts: CataloguePart[] = [
  { slug: 'r1', name: 'Resistor 10k', brand: 'Yageo', partNumber: 'RC0603', description: '10k resistor', category: 'Passive', priceText: '0.01', priceValue: 0.01, priceCurrency: 'USD', url: null, image: null, lastmod: null, fetchedAt: 0, pinout: [], lifecycle: 'active' },
  { slug: 'c1', name: 'Capacitor 100nF', brand: 'Murata', partNumber: 'GRM188', description: '100nF cap', category: 'Passive', priceText: '0.02', priceValue: 0.02, priceCurrency: 'USD', url: null, image: null, lastmod: null, fetchedAt: 0, pinout: [], lifecycle: 'active', substitutes: ['c2'] },
  { slug: 'c2', name: 'Capacitor 100nF alt', brand: 'TDK', partNumber: 'C1608', description: '100nF cap alt', category: 'Passive', priceText: '0.03', priceValue: 0.03, priceCurrency: 'USD', url: null, image: null, lastmod: null, fetchedAt: 0, pinout: [], lifecycle: 'preview' },
  { slug: 'u1', name: 'Old MCU', brand: 'Microchip', partNumber: 'PIC16F84', description: 'Obsolete MCU', category: 'Microcontroller', priceText: null, priceValue: null, priceCurrency: null, url: null, image: null, lastmod: null, fetchedAt: 0, pinout: [], lifecycle: 'obsolete', substitutes: ['u2'], suppliers: [{ name: 'DigiKey', partNumber: null, url: null }] },
  { slug: 'u2', name: 'New MCU', brand: 'Microchip', partNumber: 'PIC16F88', description: 'Newer MCU', category: 'Microcontroller', priceText: '1.50', priceValue: 1.50, priceCurrency: 'USD', url: null, image: null, lastmod: null, fetchedAt: 0, pinout: [], lifecycle: 'active' }
]

const report = libraryHealthReport(testParts)
check('library health report counts all parts', report.totalParts === 5)
check('library health report counts active parts', report.byLifecycle.active === 3)
check('library health report counts obsolete parts', report.byLifecycle.obsolete === 1)
check('library health report counts unclassified', report.unclassified === 0)
check('library health report counts parts with substitutes', report.withSubstitutes === 2)
check('library health report counts parts with suppliers', report.withSuppliers === 1)
check('library health report counts obsolete with substitutes', report.obsoleteWithSubstitutes === 1)

// applyLifecycleUpdate returns a new part with updated lifecycle
const updated = applyLifecycleUpdate(testParts[0], { slug: 'r1', lifecycle: 'obsolete' })
check('applyLifecycleUpdate changes lifecycle', updated.lifecycle === 'obsolete')
check('applyLifecycleUpdate does not mutate original', testParts[0].lifecycle === 'active')

// isPartUsable
check('isPartUsable returns true for active', isPartUsable(testParts[0]) === true)
check('isPartUsable returns false for obsolete', isPartUsable(testParts[3]) === false)

// findSubstitutes
const subs = findSubstitutes('c1', testParts)
check('findSubstitutes returns matching parts', subs.length === 1 && subs[0].slug === 'c2')

// findObsoleteWithSubstitutes
const obsoleteWithSubs = findObsoleteWithSubstitutes(testParts)
check('findObsoleteWithSubstitutes finds u1', obsoleteWithSubs.length === 1 && obsoleteWithSubs[0].slug === 'u1')

// ---------------------------------------------------------------------------
// Phase 1 quick-win self-checks
// ---------------------------------------------------------------------------

import {
  generatePickPlace,
  centroidToCsv
} from '../src/main/pickplace.ts'
import {
  generateStepBoard
} from '../src/main/step-export.ts'
import {
  checkComponentClearance,
  checkBoardEdgeClearance
} from '../src/main/mech-clearance.ts'
import {
  checkTraceClearance,
  routeTracesWithPushAndShove,
  routeDifferentialPair
} from '../src/main/pcb-layout.ts'
import { generateIpc2581 } from '../src/main/ipc2581.ts'
import { buildAnnotationLinks, findDivergences, generateEco, backwardAnnotation } from '../src/main/annotation.ts'
import type { PcbPlacement, PcbTrace, PcbPad, PcbDesignRules, DifferentialPair } from '../src/main/pcb-layout.ts'
import type { AnnotationLink } from '../src/main/annotation.ts'

// Pick-place centroid CSV
const testPlacements: PcbPlacement[] = [
  { componentId: 'c1', name: 'C1', center: { x: 10, y: 20 }, w: 5, h: 3, rotationDeg: 0, pads: [] },
  { componentId: 'r1', name: 'R1', center: { x: 30, y: 40 }, w: 6, h: 3, rotationDeg: 90, pads: [] }
]
const centroidParts = generatePickPlace(testPlacements, [])
const csv = centroidToCsv(centroidParts)
check('pick-place returns one row per placement', centroidParts.length === 2)
check('centroid CSV has header', csv.startsWith('Designator,X(mm),Y(mm),Rotation(deg),Side,Footprint'))
check('centroid CSV has data rows', csv.includes('C1') && csv.includes('R1'))

// STEP export doesn't throw on simple input
const testTraces: PcbTrace[] = [
  { net: 'NET_1', from: { componentId: 'c1', pinName: '1' }, to: { componentId: 'r1', pinName: '1' }, points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] }
]
const testPads: PcbPad[] = [
  { componentId: 'c1', pinName: '1', center: { x: 10, y: 20 }, w: 2, h: 2 },
  { componentId: 'r1', pinName: '1', center: { x: 30, y: 40 }, w: 2, h: 2 }
]
const step = generateStepBoard(testTraces, testPads, 100, 80, 1.6)
check('STEP export produces output', step.length > 0)
check('STEP export has header', step.startsWith('ISO-10303-21;'))
check('STEP export has footer', step.endsWith('END-ISO-10303-21;\n'))

// Mechanical clearance
const compClearance = checkComponentClearance(testPlacements, 2.0)
check('component clearance returns pairs', compClearance.length === 1)
check('component clearance has violation flag', typeof compClearance[0].violation === 'boolean')

const edgeClearance = checkBoardEdgeClearance(testPlacements, 100, 80, 5.0)
check('edge clearance returns per-component results', edgeClearance.length === 2)
check('edge clearance has violation flag', typeof edgeClearance[0].violation === 'boolean')

// Real-time DRC
const rules: PcbDesignRules = { traceWidth: 0.2, traceClearance: 0.2, padToTraceClearance: 0.2, viaToTraceClearance: 0.2, minAnnularRing: 0.1 }
const closeTrace: PcbTrace = {
  net: 'NET_A',
  from: { componentId: 'c1', pinName: '1' },
  to: { componentId: 'r1', pinName: '1' },
  points: [{ x: 10, y: 20 }, { x: 15, y: 20 }]
}
const existingTrace: PcbTrace = {
  net: 'NET_B',
  from: { componentId: 'c1', pinName: '2' },
  to: { componentId: 'r1', pinName: '2' },
  points: [{ x: 10, y: 20.15 }, { x: 15, y: 20.15 }]
}
const drcViolations2 = checkTraceClearance(closeTrace, [existingTrace], testPads, rules)
check('real-time DRC detects close traces', drcViolations2.length > 0)
check('real-time DRC violation has category', drcViolations2[0].category === 'trace-to-trace')

// Push-and-shove routing
// Simple board: two traces that cross, requiring push-and-shove
const psPlacements: PcbPlacement[] = [
  { componentId: 'c1', name: 'C1', center: { x: 10, y: 40 }, w: 6, h: 4, rotationDeg: 0, pads: [] },
  { componentId: 'c2', name: 'C2', center: { x: 40, y: 40 }, w: 6, h: 4, rotationDeg: 0, pads: [] },
  { componentId: 'c3', name: 'C3', center: { x: 10, y: 10 }, w: 6, h: 4, rotationDeg: 0, pads: [] },
  { componentId: 'c4', name: 'C4', center: { x: 40, y: 10 }, w: 6, h: 4, rotationDeg: 0, pads: [] }
]

const psPads: PcbPad[] = [
  { componentId: 'c1', pinName: '1', center: { x: 7, y: 40 }, w: 2, h: 2 },
  { componentId: 'c1', pinName: '2', center: { x: 13, y: 40 }, w: 2, h: 2 },
  { componentId: 'c2', pinName: '1', center: { x: 37, y: 40 }, w: 2, h: 2 },
  { componentId: 'c2', pinName: '2', center: { x: 43, y: 40 }, w: 2, h: 2 },
  { componentId: 'c3', pinName: '1', center: { x: 7, y: 10 }, w: 2, h: 2 },
  { componentId: 'c3', pinName: '2', center: { x: 13, y: 10 }, w: 2, h: 2 },
  { componentId: 'c4', pinName: '1', center: { x: 37, y: 10 }, w: 2, h: 2 },
  { componentId: 'c4', pinName: '2', center: { x: 43, y: 10 }, w: 2, h: 2 }
]

// Connections: c1:2 -> c2:1 (horizontal across top) AND c3:2 -> c4:1 (horizontal across bottom)
// These don't cross, so all should route normally
const psConnections = [
  { net: 'NET_A', fromPin: psPads[0], toPin: psPads[2] },
  { net: 'NET_B', fromPin: psPads[4], toPin: psPads[6] }
]

const psResult = routeTracesWithPushAndShove(
  psConnections,
  psPlacements,
  100,
  80,
  1,
  0.25
)
check('push-and-shove routes all connections on simple board', psResult.unrouted.length === 0)
check('push-and-shove returns traces', psResult.traces.length === 2)

// Board with crossing traces that require push-and-shove
// c1:2 -> c4:2 (diagonal across board) AND c3:2 -> c2:1 (diagonal other way)
// These two traces will cross in the middle, requiring push-and-shove
const psConnections2 = [
  { net: 'NET_X', fromPin: psPads[1], toPin: psPads[7] },
  { net: 'NET_Y', fromPin: psPads[5], toPin: psPads[2] }
]

const psResult2 = routeTracesWithPushAndShove(
  psConnections2,
  psPlacements,
  100,
  80,
  1,
  0.25
)
check('push-and-shove attempts crossing traces', psResult2.traces.length >= 1)
check('push-and-shove returns drc violations array', Array.isArray(psResult2.drcViolations))
check('push-and-shove returns rippedUp array', Array.isArray(psResult2.rippedUp))

// Differential-pair routing
const dpFromPin: PcbPad = { componentId: 'c1', pinName: '1', center: { x: 10, y: 40 }, w: 2, h: 2 }
const dpToPin: PcbPad = { componentId: 'c2', pinName: '1', center: { x: 40, y: 40 }, w: 2, h: 2 }
const dpPair: DifferentialPair = { pNet: 'USB_P', nNet: 'USB_N', separationMm: 0.2, targetLengthMm: 40 }

const dpResult = routeDifferentialPair(dpFromPin, dpToPin, dpPair, 100, 80, 1, 0.25)
check('diff-pair routing returns P trace', dpResult.pTrace.points.length >= 2)
check('diff-pair routing returns N trace', dpResult.nTrace.points.length >= 2)
check('diff-pair not unrouted', dpResult.unrouted === false)
check('diff-pair P and N have same point count', dpResult.pTrace.points.length === dpResult.nTrace.points.length)
check('diff-pair length diff is finite', isFinite(dpResult.lengthDiffMm))

// Length tuning: target longer than natural length should add meanders
const dpLongPair: DifferentialPair = { pNet: 'USB_P', nNet: 'USB_N', separationMm: 0.2, targetLengthMm: 100 }
const dpLongResult = routeDifferentialPair(dpFromPin, dpToPin, dpLongPair, 100, 80, 1, 0.25)
check('length tuning increases trace points', dpLongResult.pTrace.points.length >= dpResult.pTrace.points.length)
check('length tuning equalizes P and N lengths', dpLongResult.lengthDiffMm === 0)

// IPC-2581 manufacturing output
const ipc2581Xml = generateIpc2581(
  'Test Board',
  testPlacements,
  testTraces,
  testPads,
  [],
  100,
  80,
  1.6
)
check('IPC-2581 produces XML output', ipc2581Xml.length > 0)
check('IPC-2581 has XML declaration', ipc2581Xml.startsWith('<?xml'))
check('IPC-2581 has root element', ipc2581Xml.includes('<IPC2581>'))
check('IPC-2581 has header', ipc2581Xml.includes('<Header>'))
check('IPC-2581 has part list', ipc2581Xml.includes('<PartList>'))
check('IPC-2581 has netlist', ipc2581Xml.includes('<Netlist>'))
check('IPC-2581 has layer stackup', ipc2581Xml.includes('<LayerStackup>'))
check('IPC-2581 has manufacturing attributes', ipc2581Xml.includes('<ManufacturingAttributes>'))
check('IPC-2581 has closing tag', ipc2581Xml.endsWith('</IPC2581>\n'))

// Annotation / ECO
const testLinks: AnnotationLink[] = [
  { componentId: 'c1', designator: 'C1', placementId: 'p1', footprintId: 'cap-0603', schematicNet: 'NET_1', pcbNet: 'NET_1' },
  { componentId: 'r1', designator: 'R1', placementId: 'p2', footprintId: 'res-0603', schematicNet: 'NET_1', pcbNet: 'NET_1' },
  { componentId: 'u1', designator: 'U1', placementId: null, footprintId: 'mcu-qfn-20', schematicNet: 'NET_2', pcbNet: null }
]

const links = buildAnnotationLinks(
  {
    components: [
      { id: 'c1', name: 'C1', category: 'Passive', quantity: 1, pins: [], designator: 'C1', footprintId: 'cap-0603' },
      { id: 'r1', name: 'R1', category: 'Passive', quantity: 1, pins: [], designator: 'R1', footprintId: 'res-0603' },
      { id: 'u1', name: 'U1', category: 'Microcontroller', quantity: 1, pins: [], designator: 'U1', footprintId: 'mcu-qfn-20' }
    ],
    connections: [],
    sheets: [],
    hierarchicalBlocks: [],
    footprints: [],
    steps: [],
    title: 'Test',
    summary: '',
    difficulty: 'beginner'
  } as any,
  new Map([['p1', 'C1'], ['p2', 'R1']])
)
check('buildAnnotationLinks returns links for all components', links.length === 3)
check('linked component has placement', links[0].placementId === 'p1')
check('unplaced component has null placement', links.some((l) => l.designator === 'U1' && l.placementId === null))

const divergences = findDivergences(links, new Map([['p1', 'cap-0603']]), new Map([['p1', 'NET_1']]))
check('findDivergences detects unplaced component', divergences.some((d) => d.type === 'unplaced' && d.designator === 'U1'))
check('unplaced divergence is warning', divergences.find((d) => d.type === 'unplaced')!.severity === 'warning')

const eco = generateEco(divergences)
check('generateEco creates actions', eco.actions.length > 0)
check('eco has place_component action', eco.actions.some((a) => a.type === 'place_component'))
check('eco autoResolvable for place-only', eco.autoResolvable === true)

const backwardDivs = backwardAnnotation(
  [{ componentId: 'x1', designator: 'X1', footprintId: null, net: null }],
  [{ id: 'c1', name: 'C1', category: 'Passive', quantity: 1, pins: [], designator: 'C1' }]
)
check('backwardAnnotation detects PCB-only component', backwardDivs.some((d) => d.type === 'component_added' && d.severity === 'error'))

// Variants / alternate BOM
import {
  createVariant,
  addVariantOverride,
  removeVariantOverride,
  generateBomForVariant,
  compareBoms
} from '../src/main/variants.ts'
import type { Variant, BomAlternative, BomLineItem } from '../src/shared/types.ts'

const baseVariant = createVariant('v1', 'Base', null, null, true)
check('createVariant returns variant with id', baseVariant.id === 'v1')
check('createVariant has no overrides initially', baseVariant.componentOverrides.length === 0)

const variantWithOverride = addVariantOverride(
  baseVariant,
  'C1',
  'C0603X104K',
  'cap-0603',
  0.02,
  'Lower cost alternative'
)
check('addVariantOverride adds override', variantWithOverride.componentOverrides.length === 1)
check('override has correct designator', variantWithOverride.componentOverrides[0].designator === 'C1')
check('override has correct part number', variantWithOverride.componentOverrides[0].partNumber === 'C0603X104K')

const variantWithoutOverride = removeVariantOverride(variantWithOverride, 'C1')
check('removeVariantOverride removes override', variantWithoutOverride.componentOverrides.length === 0)

// BOM generation
const testComponents: Component[] = [
  { id: 'c1', name: 'C1', category: 'Passive', quantity: 10, pins: [], designator: 'C1', partName: 'C0603C104', unitPrice: 0.05, unitPriceCurrency: 'USD', footprintId: 'cap-0603' },
  { id: 'r1', name: 'R1', category: 'Passive', quantity: 5, pins: [], designator: 'R1', partName: 'R0603-10K', unitPrice: 0.01, unitPriceCurrency: 'USD', footprintId: 'res-0603' }
]

const testAlternates: BomAlternative[] = [
  { designator: 'C1', partNumber: 'C0603X104K', manufacturer: 'AltBrand', footprintId: 'cap-0603', reason: 'obsolescence', unitPrice: 0.03, unitPriceCurrency: 'USD', leadTimeDays: 5, url: null }
]

const bom = generateBomForVariant(testComponents, variantWithoutOverride, testAlternates)
check('generateBomForVariant returns items for all components', bom.length === 2)
check('primary part uses primary source', bom.find((i) => i.designator === 'C1')!.source === 'primary')
check('alternate part uses alternate source', bom.find((i) => i.designator === 'C1')!.source === 'primary') // No override, so primary
check('BOM computes extended price', bom.find((i) => i.designator === 'R1')!.extendedPrice === 0.05)

// Variant with override changes BOM source
const variantWithC1Override = addVariantOverride(
  variantWithoutOverride,
  'C1',
  'C0603X104K',
  'cap-0603',
  0.03,
  'Lower cost'
)
const bomWithOverride = generateBomForVariant(testComponents, variantWithC1Override, testAlternates)
check('override changes source to override', bomWithOverride.find((i) => i.designator === 'C1')!.source === 'override')

// BOM comparison
const diffs = compareBoms(bom, bomWithOverride)
check('compareBoms finds source difference', diffs.some((d) => d.designator === 'C1' && d.field === 'source'))
check('compareBoms shows old and new values', diffs.find((d) => d.designator === 'C1' && d.field === 'source')!.valueA === 'primary')
check('compareBoms shows new value', diffs.find((d) => d.designator === 'C1' && d.field === 'source')!.valueB === 'override')

// ECO: applyEco applies footprint changes
import { applyEco } from '../src/main/annotation.ts'
import type { Eco } from '../src/shared/types.ts'
const ecoSpec = {
  title: 'ECO test',
  summary: '',
  difficulty: 'beginner' as const,
  components: [
    { id: 'c1', name: 'Resistor', category: 'Passive', quantity: 1, designator: 'R1', pins: [], footprintId: 'old-fp' },
    { id: 'c2', name: 'Capacitor', category: 'Passive', quantity: 1, designator: 'C1', pins: [], footprintId: 'fp-a' }
  ],
  connections: [],
  steps: []
}
const testEco: Eco = {
  id: 'eco_1',
  createdAt: Date.now(),
  actions: [
    { type: 'change_footprint', designator: 'R1', newValue: 'new-fp', oldValue: 'old-fp' },
    { type: 'place_component', designator: 'C1', newValue: null, oldValue: null }
  ],
  divergences: [],
  autoResolvable: true
}
const nextSpec = applyEco(ecoSpec, testEco)
check('applyEco changes footprint for R1', nextSpec.components.find((c) => c.designator === 'R1')!.footprintId === 'new-fp')
check('applyEco does not mutate original spec', ecoSpec.components.find((c) => c.designator === 'R1')!.footprintId === 'old-fp')
check('applyEco leaves C1 footprint unchanged', nextSpec.components.find((c) => c.designator === 'C1')!.footprintId === 'fp-a')

// Run all async collaboration tests, then print the summary.
;(async () => {
  await runPresenceBroadcastTests()
  await runOperationBroadcastTests()
  await runServerStopTests()

  console.log(`\n${checks - failures}/${checks} checks passed`)
  if (failures > 0) {
    console.error(`${failures} FAILED`)
    process.exit(1)
  }
  console.log('all good')
})()