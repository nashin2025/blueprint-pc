// Full catalogue sync driver.
//
// Drives the REAL sync code inside the running packaged app over CDP, calling
// catalogue:sync in a loop until the source is exhausted. This reuses the exact
// code path the UI uses (schematik.ts -> db.ts -> SQLite) — no re-implementation,
// no second writer. The app must already be running with --remote-debugging-port.
//
// The sync is resumable: every saved part persists in SQLite, so if this driver
// is interrupted, re-running it continues where it left off.
//
// Run: node scripts/sync-all.mjs [batch]

const PORT = process.env.CDP_PORT || '9229'
const BATCH = Number(process.argv[2] || 40)
// Safety cap so a runaway loop can never spin forever.
const MAX_BATCHES = 400

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
const now = () => new Date().toLocaleTimeString()

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('no page target on port ' + PORT + ' — is the app running with CDP?')
  const ws = await connect(page.webSocketDebuggerUrl)
  await send(ws, 'Runtime.enable')

  const start = Date.now()
  let totalSaved = 0
  let totalFailed = 0
  let lastToFetch = -1

  console.log(`[${now()}] full sync started (batch=${BATCH})`)

  for (let i = 0; i < MAX_BATCHES; i++) {
    const res = await ev(ws, `window.api.catalogue.sync(${BATCH})`)
    if (!res.ok) throw new Error('sync IPC failed: ' + (res.error ?? 'unknown'))
    const p = res.data

    totalSaved += p.done
    totalFailed += p.failed

    const elapsed = ((Date.now() - start) / 1000) | 0
    console.log(
      `[${now()}] +${p.done} saved, +${p.failed} failed | ` +
        `total known=${p.known} toFetch=${p.toFetch} | ${elapsed}s elapsed`
    )

    // Nothing left to fetch, or this batch did no work and the queue is empty.
    if (p.toFetch === 0 || (p.done === 0 && p.failed === 0 && p.known === p.total)) {
      console.log(`[${now()}] queue empty — sync complete`)
      break
    }
    // No forward progress across a whole batch means stop rather than spin.
    if (p.done === 0 && p.failed === 0) {
      console.log(`[${now()}] no progress this batch (done=0, failed=0) — stopping`)
      break
    }
    lastToFetch = p.toFetch
  }

  const final = await ev(ws, `window.api.catalogue.status()`)
  console.log(`\n=== SYNC ALL COMPLETE ===`)
  console.log(`  parts in library: ${final.data.count}`)
  console.log(`  saved this run:   ${totalSaved}`)
  console.log(`  failed this run:  ${totalFailed}`)
  console.log(`  queue remaining:  ${final.data.progress.toFetch}`)
  ws.close()
}

main().catch((e) => {
  console.error('SYNC-ALL FAILED:', e.message)
  process.exit(1)
})