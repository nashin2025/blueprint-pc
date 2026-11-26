// Empirical rate-limit probe for the Schematik MCP.
//
// Fires N get_part calls back-to-back with NO artificial gap and records the
// HTTP status and latency of each. A 429, a 503, a Retry-After header, or a
// sharp latency climb would reveal a server-side throttle. A flat run of 200s
// means there is no enforced limit at this volume (which is itself the answer:
// the only limit is the fair-use policy, so our 400ms gap is self-imposed).
//
// This is a SMALL burst (15 calls) — enough to see a limiter react, not enough
// to be the "scale that harms other users" the terms forbid.
//
// Run: node scripts/probe-rate-limit.mjs [count]

const MCP_URL = 'https://www.schematik.io/mcp'
const UA = 'BlueprintPC/0.1 (local desktop app; personal catalogue mirror)'
const COUNT = Number(process.argv[2] || 15)

const session = { sessionId: null, requestId: 0 }

async function rpc(method, params, notify = false) {
  const body = { jsonrpc: '2.0', method }
  if (params) body.params = params
  if (!notify) body.id = ++session.requestId
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'User-Agent': UA
  }
  if (session.sessionId) headers['Mcp-Session-Id'] = session.sessionId

  const t0 = Date.now()
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  })
  const sid = res.headers.get('mcp-session-id')
  if (sid) session.sessionId = sid
  const retryAfter = res.headers.get('retry-after')
  const text = await res.text()
  return { status: res.status, retryAfter, ms: Date.now() - t0, len: text.length }
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'blueprint-pc-rate-probe', version: '0.1.0' }
  })
  await rpc('notifications/initialized', {}, true)

  // Pull a handful of real slugs from the sitemap first.
  const sm = await fetch('https://www.schematik.io/sitemap.xml', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30_000)
  })
  const xml = await sm.text()
  const slugs = [...xml.matchAll(/\/parts\/([^/?#]+)<\/loc>/gi)]
    .map((m) => m[1])
    .filter((s) => /^[a-z0-9][a-z0-9-]+$/.test(s))
    .slice(0, COUNT)

  console.log(`Firing ${slugs.length} get_part calls back-to-back (no gap)...\n`)
  const results = []
  for (const slug of slugs) {
    try {
      const r = await rpc('tools/call', { name: 'get_part', arguments: { slug } })
      results.push(r)
      const flag = r.status === 200 ? 'ok ' : '!! '
      console.log(`  ${flag} ${r.status}  ${String(r.ms).padStart(5)}ms  ${slug}${r.retryAfter ? `  Retry-After: ${r.retryAfter}` : ''}`)
    } catch (e) {
      console.log(`  ERR ${e.message}  ${slug}`)
      results.push({ status: 0, ms: -1 })
    }
  }

  const ok = results.filter((r) => r.status === 200).length
  const throttled = results.filter((r) => r.status === 429 || r.status === 503)
  const times = results.filter((r) => r.ms >= 0).map((r) => r.ms)
  const min = Math.min(...times)
  const max = Math.max(...times)
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length)

  console.log(`\n=== SUMMARY ===`)
  console.log(`  200 OK:        ${ok}/${results.length}`)
  console.log(`  throttled:     ${throttled.length} (429/503)`)
  console.log(`  latency:       min ${min}ms  avg ${avg}ms  max ${max}ms`)
  const anyRetryAfter = results.some((r) => r.retryAfter)
  console.log(`  Retry-After:   ${anyRetryAfter ? 'PRESENT (server asked us to slow down)' : 'none sent'}`)
  console.log(`\n  VERDICT: ${throttled.length > 0 ? 'server DOES throttle at this rate' : 'no throttle observed at this volume — limit is fair-use policy, not a hard number'}`)
}

main().catch((e) => {
  console.error('PROBE FAILED:', e)
  process.exit(1)
})