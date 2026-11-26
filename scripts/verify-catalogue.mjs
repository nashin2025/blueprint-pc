// CDP driver for the catalogue end-to-end check.
//
// Launches nothing itself; expects the app already running with
// --remote-debugging-port=9229. Verifies the real path:
//   preload -> ipc -> sync/schematik.ts -> catalogue/db.ts -> SQLite
// by calling catalogue:sync (small batch), then search + get, and reading
// the results back through the renderer's exposed `api` bridge.
//
// Run: node scripts/verify-catalogue.mjs [batch]

const PORT = process.env.CDP_PORT || '9229'
const BATCH = Number(process.argv[2] || 5)

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => resolve(ws)
    ws.onerror = (e) => reject(new Error('ws error: ' + e.message))
  })
}

let msgId = 0
function send(ws, method, params) {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id === id) {
        ws.removeEventListener('message', onMsg)
        if (m.error) reject(new Error(JSON.stringify(m.error)))
        else resolve(m.result)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evalInPage(ws, expression, awaitPromise = true) {
  const r = await send(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  })
  if (r.exceptionDetails) {
    throw new Error('eval threw: ' + JSON.stringify(r.exceptionDetails))
  }
  return r.result.value
}

async function main() {
  // Find the page target.
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('no page target found on port ' + PORT)
  console.log('page:', page.title, page.url)

  const ws = await connect(page.webSocketDebuggerUrl)
  await send(ws, 'Runtime.enable')

  console.log(`\n=== catalogue:sync (batch=${BATCH}) ===`)
  const syncRes = await evalInPage(ws, `window.api.catalogue.sync(${BATCH})`)
  console.log('sync ok:', syncRes.ok)
  console.log('progress:', JSON.stringify(syncRes.data, null, 2))

  console.log('\n=== catalogue:status ===')
  const status = await evalInPage(ws, `window.api.catalogue.status()`)
  console.log('count:', status.data.count, '| lastSyncAt:', status.data.lastSyncAt)
  console.log('progress:', JSON.stringify(status.data.progress))

  if (!status.data.count) {
    console.log('\nNO PARTS SAVED. Inspecting why...')
    ws.close()
    process.exit(2)
  }

  console.log('\n=== catalogue:search("oled") ===')
  const search = await evalInPage(ws, `window.api.catalogue.search("oled", 10)`)
  console.log('results:', search.data.length)
  for (const r of search.data.slice(0, 5)) {
    console.log(`  - ${r.name} [${r.category}] ${r.priceText ?? 'no price'} | pins:${r.pinCount} | desc:${r.hasDescription}`)
  }

  if (search.data.length) {
    const slug = search.data[0].slug
    console.log(`\n=== catalogue:get("${slug}") ===`)
    const got = await evalInPage(ws, `window.api.catalogue.get(${JSON.stringify(slug)})`)
    const p = got.data
    console.log('name:', p.name)
    console.log('brand:', p.brand, '| partNumber:', p.partNumber)
    console.log('category:', p.category, '| price:', p.priceText, '| value:', p.priceValue, '| currency:', p.priceCurrency)
    console.log('description:', (p.description || '').slice(0, 120))
    console.log('pinout:', p.pinout.length, 'pins')
    for (const pin of p.pinout.slice(0, 4)) {
      console.log(`  [${pin.type}] ${pin.label}: ${pin.function ?? pin.voltage ?? '(no desc)'}`)
    }
    // Verify a pin with descriptive text survived (the bug we fixed).
    const withText = p.pinout.filter((x) => x.function && x.function.length > 5)
    console.log('pins with descriptive text:', withText.length, 'of', p.pinout.length)
  }

  console.log('\n=== VERIFY DONE ===')
  ws.close()
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e.message)
  process.exit(1)
})