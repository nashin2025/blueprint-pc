// Standalone probe for the Schematik public MCP + sitemap.
//
// Purpose: prove the live contract before building UI on top of it. This does
// NOT touch SQLite or Electron; it only exercises the network path that
// src/main/sync/schematik.ts depends on, and prints the *raw* get_part payload
// so we can confirm the field names match SourcePart.
//
// Run: node scripts/probe-schematik.mjs

const MCP_URL = 'https://www.schematik.io/mcp'
const SITEMAP_URL = 'https://www.schematik.io/sitemap.xml'
const UA = 'BlueprintPC/0.1 (local desktop app; personal catalogue mirror)'

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

  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  })

  const sid = res.headers.get('mcp-session-id')
  if (sid) session.sessionId = sid

  const text = await res.text()
  const data = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('')

  return { status: res.status, raw: text, data, parsed: safeParse(data || text) }
}

function safeParse(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

async function main() {
  console.log('=== 1. SITEMAP ===')
  const sm = await fetch(SITEMAP_URL, {
    headers: { 'User-Agent': UA, Accept: 'application/xml,text/xml,*/*' },
    signal: AbortSignal.timeout(30_000)
  })
  console.log('status', sm.status, sm.headers.get('content-type'))
  const xml = await sm.text()
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map((m) => m[1])
  const partBlocks = urls.filter((b) => /\/parts\/[^/?#]+$/.test(b.match(/<loc>([^<]+)<\/loc>/i)?.[1]?.trim() ?? ''))
  const withLastmod = partBlocks.filter((b) => /<lastmod>/i.test(b)).length
  const sampleSlugs = partBlocks
    .slice(0, 5)
    .map((b) => b.match(/<loc>([^<]+)<\/loc>/i)?.[1]?.trim().split('/').pop())
  console.log('total <url>', urls.length, '| part urls', partBlocks.length, '| with lastmod', withLastmod)
  console.log('sample slugs', sampleSlugs)

  console.log('\n=== 2. MCP initialize ===')
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'blueprint-pc-probe', version: '0.1.0' }
  })
  console.log('status', init.status, '| sessionId', session.sessionId)
  console.log('serverInfo', JSON.stringify(init.parsed?.result?.serverInfo ?? init.parsed?.result ?? init.parsed))

  console.log('\n=== 3. notifications/initialized ===')
  const note = await rpc('notifications/initialized', {}, true)
  console.log('status', note.status, '(204/202 expected, no body)')

  console.log('\n=== 4. tools/list ===')
  const tools = await rpc('tools/list', {})
  const names = (tools.parsed?.result?.tools ?? []).map((t) => t.name)
  console.log('tools', names)

  console.log('\n=== 5. get_part on sample slugs ===')
  for (const slug of sampleSlugs.slice(0, 3)) {
    const r = await rpc('tools/call', { name: 'get_part', arguments: { slug } })
    const content = r.parsed?.result?.content
    const text = content?.[0]?.text
    console.log(`\n--- ${slug} ---`)
    console.log('status', r.status, '| has content', Array.isArray(content), '| text length', text?.length ?? 0)
    if (text) {
      const parsed = safeParse(text)
      if (parsed) {
        console.log('keys:', Object.keys(parsed))
        console.log('name:', parsed.name, '| brand:', parsed.brand, '| partNumber:', parsed.partNumber)
        console.log('category:', parsed.category, '| price:', parsed.price, '| priceValue:', parsed.priceValue, '| currency:', parsed.priceCurrency)
        console.log('pinout count:', Array.isArray(parsed.pinout) ? parsed.pinout.length : 'MISSING')
        if (Array.isArray(parsed.pinout) && parsed.pinout[0]) {
          console.log('first pin keys:', Object.keys(parsed.pinout[0]))
          console.log('first pin:', JSON.stringify(parsed.pinout[0]))
        }
        console.log('description length:', parsed.description?.length ?? 0)
      } else {
        console.log('RAW TEXT (not JSON):', text.slice(0, 500))
      }
    } else {
      console.log('RAW:', JSON.stringify(r.parsed).slice(0, 400))
    }
    await new Promise((r) => setTimeout(r, 400))
  }

  console.log('\n=== DONE ===')
}

main().catch((e) => {
  console.error('PROBE FAILED:', e)
  process.exit(1)
})