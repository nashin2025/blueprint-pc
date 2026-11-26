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
import { ALL_CATEGORIES, categoryKey, partArt } from '../src/renderer/src/lib/partArt.ts'
import { componentLines, imagePromptFor, summaryMessagesFor, wiringLines } from '../src/main/ai/info-prompts.ts'
import { layoutWiring } from '../src/renderer/src/lib/wiringLayout.ts'
import { layoutPackage, pinCategory } from '../src/renderer/src/lib/packageLayout.ts'
import { normalisePin, parseCurrency, parsePriceValue } from '../src/main/sync/schematik-parse.ts'
import { MVR_PER_USD, approxUsd, formatNative, isComparable, toUsd } from '../src/shared/money.ts'
import type { Component, Connection } from '../src/shared/types.ts'

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
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} FAILED`)
  process.exit(1)
}
console.log('all good')