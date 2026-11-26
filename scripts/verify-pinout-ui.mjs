// Verifies PinoutView renders: an SVG package diagram AND a linked pin table,
// with a pin count matching the part's pinout.
//
// Run: node scripts/verify-pinout-ui.mjs

const PORT = process.env.CDP_PORT || '9229'

function connect(u) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(u)
    ws.onopen = () => res(ws)
    ws.onerror = (e) => rej(e)
  })
}
let id = 0
function send(ws, m, p) {
  const i = ++id
  return new Promise((res, rej) => {
    const on = (ev) => {
      const x = JSON.parse(ev.data)
      if (x.id === i) {
        ws.removeEventListener('message', on)
        x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result)
      }
    }
    ws.addEventListener('message', on)
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
  })
}
async function ev(ws, e) {
  const r = await send(ws, 'Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  const ws = await connect(page.webSocketDebuggerUrl)
  await send(ws, 'Runtime.enable')

  // Open Part library
  await ev(ws, `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Part library')?.click()`)
  await sleep(400)

  // Search for a board with many pins (ESP32 / a dev board)
  await ev(ws, `(() => {
    const input = document.querySelector('input[type=text], input:not([type])')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'esp32')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(900)

  const rowCount = await ev(ws, `[...document.querySelectorAll('button')].filter(b => /esp32/i.test(b.textContent)).length`)
  console.log('esp32 rows:', rowCount)

  // Open a real catalogue part (has a price), not a project card.
  await ev(ws, `[...document.querySelectorAll('button')].find(b => /esp32/i.test(b.textContent) && /(from|\\d+\\.\\d+)\\s*(USD|EUR)/i.test(b.textContent))?.click()`)
  await sleep(800)

  // Inspect: SVG diagram (viewBox width 260 = the package), pin table rows, colored dots
  const out = await ev(ws, `(() => {
    const svgs = [...document.querySelectorAll('svg')];
    const pinSvg = svgs.find(s => (s.getAttribute('viewBox') || '').split(' ')[2] === '260');
    const circles = pinSvg ? pinSvg.querySelectorAll('circle').length : 0;
    const tables = [...document.querySelectorAll('table')];
    const pinTable = tables.find(t => /Type/i.test(t.textContent) && /Function/i.test(t.textContent));
    const pinRows = pinTable ? pinTable.querySelectorAll('tbody tr').length : 0;
    const dots = pinTable ? pinTable.querySelectorAll('tbody tr span[style*="background-color"]').length : 0;
    const colors = new Set();
    if (pinTable) pinTable.querySelectorAll('tbody tr span[style*="background-color"]').forEach(d => colors.add(d.style.backgroundColor));
    return { hasPinSvg: !!pinSvg, circles, pinRows, dots, distinctColors: colors.size, colorList: [...colors] };
  })()`)

  console.log('pinout svg present:', out.hasPinSvg, '| pads (circles):', out.circles)
  console.log('pin table rows:', out.pinRows, '| colored dots:', out.dots)
  console.log('distinct category colors:', out.distinctColors, out.colorList)

  const pass =
    out.hasPinSvg &&
    out.circles > 3 &&
    out.pinRows > 3 &&
    out.circles === out.pinRows &&
    out.dots === out.pinRows &&
    out.distinctColors >= 2
  console.log('\n=== PINOUT UI', pass ? 'PASS' : 'FAIL', '===')
  ws.close()
  process.exit(pass ? 0 : 3)
}

main().catch((e) => {
  console.error('PINOUT UI FAILED:', e.message)
  process.exit(1)
})