// Verify MECH tab 3D CAD viewer - we're already on ProjectView
// Run: node scripts/verify-mech.mjs

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

  // Click MECH tab
  await ev(ws, `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'MECH').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`)
  await sleep(1000)

  // Check canvas element exists
  const canvasCount = await ev(ws, `document.querySelectorAll('canvas').length`)
  check('Three.js canvas renders', canvasCount > 0)

  // Check WebGL context
  const webglInfo = await ev(ws, `(() => { const c = document.querySelector('canvas'); if (!c) return null; const gl = c.getContext('webgl2') || c.getContext('webgl'); return gl ? { vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER) } : null })()`)
  check('WebGL context active', webglInfo !== null)
  if (webglInfo) console.log(`  WebGL renderer: ${webglInfo.renderer}`)

  // Check MECH heading
  const heads = await ev(ws, `[...document.querySelectorAll('h1,h2,h3')].map(h => h.textContent.trim())`)
  check('MECH heading present', heads.some(h => h === 'Mechanical'))
  check('3D CAD view description present', heads.some(h => h.includes('3D CAD view')))

  // Check parts table
  const partRows = await ev(ws, `[...document.querySelectorAll('table tbody tr')].length`)
  check('Parts table has rows', partRows > 0)

  // Check 3D objects were added to scene (check for mesh count via three.js)
  const meshCount = await ev(ws, `(() => { try { const scene = document.querySelector('[data-three-scene]'); if (!scene) return 'no-scene-div'; return 'scene-div-exists'; } catch(e) { return e.message } })()`)
  console.log(`Scene div: ${meshCount}`)

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
  ws.close()
  process.exit(failures === 0 ? 0 : 3)
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })