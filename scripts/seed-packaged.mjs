// Import enough parts in the packaged app to reach the OLED entries, then
// confirm search finds them. Run: node scripts/seed-packaged.mjs [batch]

const PORT = process.env.CDP_PORT || '9230'
const BATCH = Number(process.argv[2] || 15)

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

  const r = await ev(ws, `window.api.catalogue.sync(${BATCH})`)
  console.log('sync:', JSON.stringify(r.data))
  await new Promise((x) => setTimeout(x, 400))

  const s = await ev(ws, `window.api.catalogue.search("oled", 10)`)
  console.log('oled search count:', s.data ? s.data.length : 'ERR')
  if (s.data) for (const row of s.data) console.log('  -', row.name, '|', row.priceText, '| pins', row.pinCount)

  ws.close()
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})