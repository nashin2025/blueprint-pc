// End-to-end pinout check with verbose state dumps at each step.
// Run: node scripts/debug-pinout.mjs

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

  // Step 1: click Part library
  const libClick = await ev(
    ws,
    `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Part library'); if (!b) return 'no button'; b.click(); return 'clicked'; })()`
  )
  console.log('1. library click:', libClick)
  await sleep(500)

  const headings1 = await ev(ws, `[...document.querySelectorAll('h1,h2,h3')].map(h => h.textContent.trim())`)
  console.log('   headings now:', JSON.stringify(headings1))

  // Step 2: type esp32
  const typeRes = await ev(
    ws,
    `(() => { const i = document.querySelector('input[type=text], input:not([type])'); if (!i) return 'no input'; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i,'esp32'); i.dispatchEvent(new Event('input',{bubbles:true})); return 'typed'; })()`
  )
  console.log('2. type:', typeRes)
  await sleep(1000)

  // Step 3: list result buttons
  const rows = await ev(
    ws,
    `[...document.querySelectorAll('button')].filter(b => /esp32/i.test(b.textContent)).map(b => b.textContent.trim().slice(0,50))`
  )
  console.log('3. esp32 buttons:', rows.length, JSON.stringify(rows.slice(0, 4)))

  // Step 4: click a real CATALOGUE PART (has a "from … USD" price), not a project card
  const partBtn = `[...document.querySelectorAll('button')].find(b => /esp32/i.test(b.textContent) && /(from|\\d+\\.\\d+)\\s*(USD|EUR)/i.test(b.textContent))`
  const hasPart = await ev(ws, `!!(${partBtn})`)
  console.log('4. found a catalogue part row:', hasPart)
  if (!hasPart) {
    // fall back: any esp32 button that is NOT a project (no "parts ·")
    console.log('   no priced part; listing all esp32 buttons:')
    const all = await ev(ws, `[...document.querySelectorAll('button')].filter(b => /esp32/i.test(b.textContent)).map(b => b.textContent.trim().slice(0,60))`)
    console.log('  ', JSON.stringify(all.slice(0, 8)))
    ws.close()
    return
  }
  await ev(ws, `(${partBtn}).click()`)
  await sleep(800)

  // Step 5: what's in the detail pane now?
  const headings2 = await ev(ws, `[...document.querySelectorAll('h1,h2,h3')].map(h => h.textContent.trim())`)
  console.log('4. headings after click:', JSON.stringify(headings2))

  const svgs = await ev(
    ws,
    `[...document.querySelectorAll('svg')].map(s => ({ vb: s.getAttribute('viewBox'), circles: s.querySelectorAll('circle').length, rects: s.querySelectorAll('rect').length, texts: s.querySelectorAll('text').length }))`
  )
  console.log('5. svgs:', JSON.stringify(svgs.filter((s) => s.vb && s.vb !== '0 0 24 24')))

  const tables = await ev(
    ws,
    `[...document.querySelectorAll('table')].map(t => ({ txt: t.textContent.slice(0,60).replace(/\\s+/g,' '), rows: t.querySelectorAll('tbody tr').length }))`
  )
  console.log('6. tables:', JSON.stringify(tables))

  ws.close()
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})