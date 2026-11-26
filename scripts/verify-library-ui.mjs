// Verify Part library UI: search, detail tabs, pinout rendering, parts tray, compare.
// Run: node scripts/verify-library-ui.mjs

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

  await ev(ws, `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Part library')?.click()`)
  await sleep(500)

  await ev(ws, `(() => { const i = document.querySelector('input[type=text], input:not([type])'); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i,'esp32'); i.dispatchEvent(new Event('input',{bubbles:true})); })()`)
  await sleep(900)
  const rows = await ev(ws, `[...document.querySelectorAll('button')].filter(b => /esp32/i.test(b.textContent) && /(from|\\d+\\.\\d+)\\s*(USD|EUR)/i.test(b.textContent)).length`)
  check('search returns catalogue parts', rows > 0)

  await ev(ws, `[...document.querySelectorAll('button')].find(b => /esp32/i.test(b.textContent) && /(from|\\d+\\.\\d+)\\s*(USD|EUR)/i.test(b.textContent))?.click()`)
  await sleep(800)

  const tabTexts = await ev(ws, `[...document.querySelectorAll('button')].map(b => b.textContent.trim())`)
  check('Overview tab renders', tabTexts.includes('Overview'))
  check('Pinout tab renders', tabTexts.some((t) => t.startsWith('Pinout')))

  // Click Pinout tab
  await ev(ws, `[...document.querySelectorAll('button')].find(b => /^Pinout/i.test(b.textContent))?.click()`)
  await sleep(700)
  const svgInfo = await ev(ws, `[...document.querySelectorAll('svg')].filter(s => (s.getAttribute('viewBox')||'').split(' ')[2] === '260').map(s => ({ circles: s.querySelectorAll('circle').length }))`)
  check('pinout SVG renders (260 width)', svgInfo.length > 0)
  check('pinout has pad circles', svgInfo[0] && svgInfo[0].circles > 3)

  // Tray label (span, not button)
  const trayLabel = await ev(ws, `[...document.querySelectorAll('*')].filter(el => /in tray/i.test(el.textContent.trim())).length`)
  check('tray shows "in tray" label', trayLabel > 0)

  // Add second part, compare
  await ev(ws, `(() => { const i = document.querySelector('input[type=text], input:not([type])'); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i,'oled'); i.dispatchEvent(new Event('input',{bubbles:true})); })()`)
  await sleep(900)
  await ev(ws, `[...document.querySelectorAll('button')].find(b => /oled/i.test(b.textContent) && /(from|\\d+\\.\\d+)\\s*(USD|EUR)/i.test(b.textContent))?.click()`)
  await sleep(800)
  const trayText2 = await ev(ws, `[...document.querySelectorAll('*')].filter(el => /in tray/i.test(el.textContent.trim())).map(el => el.textContent.trim())`)
  check('tray count increased', trayText2.some((t) => /2 in tray/i.test(t)))

  await ev(ws, `[...document.querySelectorAll('button')].find(b => /^Compare$/i.test(b.textContent))?.click()`)
  await sleep(700)
  const compareText = await ev(ws, `[...document.querySelectorAll('*')].filter(el => el.textContent.trim() === 'Comparing 2 parts').length`)
  check('compare view renders', compareText > 0)

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
  ws.close()
  process.exit(failures === 0 ? 0 : 3)
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })