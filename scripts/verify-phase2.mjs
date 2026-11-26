// Phase 2 UI verification: Home page + ProjectView with 6-section tabs
// Run: node scripts/verify-phase2.mjs

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
let failures = 0
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`)
  if (!cond) failures++
}

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  const ws = await connect(page.webSocketDebuggerUrl)
  await send(ws, 'Runtime.enable')

  // Check current page
  const pageTitle = await ev(ws, `document.title`)
  console.log(`Current page: ${pageTitle}`)

  // Check Home page elements
  const homeChecks = await ev(ws, `(() => {
    const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim())
    return {
      hasDescribeIt: btns.some(t => t === 'Describe it'),
      hasLite: btns.some(t => t === 'Lite'),
      hasPro: btns.some(t => t === 'Pro'),
      modeCount: btns.filter(t => t === 'Describe it' || t === 'Upload image' || t === 'Draw a sketch').length,
      buildCount: btns.filter(t => t === 'Lite' || t === 'Pro').length
    }
  })()`)
  check('Home has Describe it button', homeChecks.hasDescribeIt)
  check('Home has Lite button', homeChecks.hasLite)
  check('Home has Pro button', homeChecks.hasPro)
  check('Home has 3 mode buttons', homeChecks.modeCount === 3)
  check('Home has 2 build buttons', homeChecks.buildCount === 2)

  // Generate a design
  await ev(ws, `(() => { const i = document.querySelector('input[type=text], input:not([type])'); if (!i) return 'no input'; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i,'A simple LED blinker with a push button'); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok' })()`)
  await sleep(300)
  await ev(ws, `[...document.querySelectorAll('button')].find(b => /Generate design/i.test(b.textContent.trim()))?.click()`)
  await sleep(8000)

  // Check if we navigated to ProjectView
  const heads = await ev(ws, `[...document.querySelectorAll('h1')].map(h => h.textContent.trim())`)
  console.log(`H1s: ${JSON.stringify(heads)}`)
  check('Project page loaded', heads.length > 0)

  // Check new tab names
  const tabNames = await ev(ws, `[...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => t === 'INFO' || t === 'BOM' || t === 'WIRING' || t === 'MECH' || t === 'INSTRUCTIONS' || t === 'PART')`)
  check('INFO tab present', tabNames.includes('INFO'))
  check('BOM tab present', tabNames.includes('BOM'))
  check('WIRING tab present', tabNames.includes('WIRING'))
  check('MECH tab present', tabNames.includes('MECH'))
  check('INSTRUCTIONS tab present', tabNames.includes('INSTRUCTIONS'))
  check('PART tab present', tabNames.includes('PART'))

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
  ws.close()
  process.exit(failures === 0 ? 0 : 3)
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })