// Confirms which catalogue the running app sees (dev vs packaged folder).
// Run: node scripts/check-which-catalogue.mjs [port]

const PORT = process.env.CDP_PORT || '9231'
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
  const status = await ev(ws, `window.api.catalogue.status()`)
  const count = status.data?.count ?? 'ERR'
  console.log('packaged app sees catalogue count:', count)
  console.log('progress:', JSON.stringify(status.data?.progress))
  ws.close()
  // A packaged build reading the shared folder should report 3900+ parts, not 0.
  process.exit(typeof count === 'number' && count > 1000 ? 0 : 3)
}
main().catch((e) => {
  console.error('CHECK FAILED:', e.message)
  process.exit(1)
})