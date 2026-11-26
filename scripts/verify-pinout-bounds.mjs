// Confirms every rendered label chip sits inside the SVG viewBox (no clipping).
// Run: node scripts/verify-pinout-bounds.mjs

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

  // Open library -> search esp32 -> open a priced part
  await ev(ws, `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Part library')?.click()`)
  await sleep(400)
  await ev(ws, `(() => { const i = document.querySelector('input[type=text], input:not([type])'); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i,'esp32'); i.dispatchEvent(new Event('input',{bubbles:true})); })()`)
  await sleep(1000)
  await ev(ws, `[...document.querySelectorAll('button')].find(b => /esp32/i.test(b.textContent) && /(from|\\d+\\.\\d+)\\s*(USD|EUR)/i.test(b.textContent))?.click()`)
  await sleep(800)

  // Inspect the pinout SVG: every label rect must be within [0, viewBoxWidth].
  const out = await ev(ws, `(() => {
    const svg = [...document.querySelectorAll('svg')].find(s => (s.getAttribute('viewBox')||'').split(' ')[2] === '260');
    if (!svg) return { error: 'no pinout svg' };
    const vbW = parseFloat(svg.getAttribute('viewBox').split(' ')[2]);
    // Label chips are the <rect> with rx=4.5 (the chip), distinct from the board rect (rx=8).
    const chips = [...svg.querySelectorAll('rect[rx="4.5"]')];
    let minX = Infinity, maxRight = -Infinity, clipped = 0;
    chips.forEach(c => {
      const x = parseFloat(c.getAttribute('x'));
      const w = parseFloat(c.getAttribute('width'));
      minX = Math.min(minX, x);
      maxRight = Math.max(maxRight, x + w);
      if (x < 0 || x + w > vbW) clipped++;
    });
    return { viewBoxWidth: vbW, chipCount: chips.length, minX, maxRight, clipped };
  })()`)

  console.log('pinout bounds:', JSON.stringify(out))
  const pass = out.chipCount > 0 && out.clipped === 0 && out.minX >= 0 && out.maxRight <= out.viewBoxWidth
  console.log('\n=== BOUNDS', pass ? 'PASS (no clipping)' : 'FAIL (clipping detected)', '===')
  ws.close()
  process.exit(pass ? 0 : 3)
}
main().catch((e) => {
  console.error('BOUNDS CHECK FAILED:', e.message)
  process.exit(1)
})