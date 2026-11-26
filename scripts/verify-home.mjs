// Quick Home page verification
// Run: node scripts/verify-home.mjs

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

  // Click Back to go to Home
  await ev(ws, `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Back')?.click()`)
  await sleep(800)

  const title = await ev(ws, `document.title`)
  console.log(`Page: ${title}`)

  const btns = await ev(ws, `[...document.querySelectorAll('button')].map(b => b.textContent.trim())`)
  check('Home has Describe it', btns.includes('Describe it'))
  check('Home has Upload image', btns.includes('Upload image'))
  check('Home has Draw a sketch', btns.includes('Draw a sketch'))
  check('Home has Lite', btns.includes('Lite'))
  check('Home has Pro', btns.includes('Pro'))

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
  ws.close()
  process.exit(failures === 0 ? 0 : 3)
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })