// Debug what renders in Part library detail after clicking a part.
// Run: node scripts/debug-library.mjs

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

  await ev(ws, `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Part library')?.click()`)
  await sleep(500)
  await ev(ws, `(() => { const i = document.querySelector('input[type=text], input:not([type])'); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i,'esp32'); i.dispatchEvent(new Event('input',{bubbles:true})); })()`)
  await sleep(900)
  await ev(ws, `[...document.querySelectorAll('button')].find(b => /esp32/i.test(b.textContent) && /(from|\\d+\\.\\d+)\\s*(USD|EUR)/i.test(b.textContent))?.click()`)
  await sleep(1000)

  console.log('--- ALL BUTTON TEXTS ---')
  const btns = await ev(ws, `[...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean)`)
  console.log(btns.join('\n'))

  console.log('--- ALL H1/H2/H3 ---')
  const heads = await ev(ws, `[...document.querySelectorAll('h1,h2,h3')].map(h => h.textContent.trim())`)
  console.log(heads.join('\n'))

  console.log('--- SVG VIEWBOXES ---')
  const svgs = await ev(ws, `[...document.querySelectorAll('svg')].map(s => s.getAttribute('viewBox')).filter(Boolean)`)
  console.log(svgs.join('\n'))

  console.log('--- TRAY TEXT ---')
  const tray = await ev(ws, `[...document.querySelectorAll('button')].filter(b => /in tray/i.test(b.textContent)).map(b => b.textContent.trim())`)
  console.log(tray.join('\n'))

  ws.close()
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })