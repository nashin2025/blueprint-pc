// Debug: check what buttons are on the current page
// Run: node scripts/debug-home.mjs

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

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  const ws = await connect(page.webSocketDebuggerUrl)
  await send(ws, 'Runtime.enable')

  const btns = await ev(ws, `[...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean)`)
  console.log('All buttons:')
  btns.forEach(b => console.log(`  "${b}"`))

  const heads = await ev(ws, `[...document.querySelectorAll('h1')].map(h => h.textContent.trim())`)
  console.log(`\nH1s: ${JSON.stringify(heads)}`)

  ws.close()
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })