/**
 * Runs the retailer parsers against pages captured from the live sites.
 *
 * This is a verification harness, not a test suite: it proves the parsers produce
 * real offers from real markup. The captured HTML is written by hand into the
 * project root, so re-capture it before re-running.
 *
 * Run: node scripts/verify-offers.mjs
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseAliExpress,
  parseAmazonSearch,
  parseEbaySearch
} from '../src/main/offers-parse.ts'

// Directory holding the captured pages; defaults to the working directory.
const root = process.argv[2] ?? process.cwd()

/**
 * Reads a captured page.
 *
 * The captures are written by a browser driver that serialises the HTML as a JSON
 * string, so the file arrives with escaped quotes and newlines. Decoding it back
 * is part of loading the artifact, not part of the parse.
 */
function read(name) {
  const raw = readFileSync(join(root, name), 'utf-8')
  if (raw.startsWith('"')) {
    try {
      const decoded = JSON.parse(raw)
      if (typeof decoded === 'string') return decoded
    } catch {
      // Fall through: the file is already raw HTML.
    }
  }
  return raw
}

const cases = [
  ['eBay', 'ebay-live.html', parseEbaySearch],
  ['Amazon', 'amazon-live.html', parseAmazonSearch],
  ['AliExpress', 'aliexpress-live.html', (html) => parseAliExpress(html, 'https://www.aliexpress.com/')]
]

let failed = 0

for (const [label, file, parse] of cases) {
  const html = read(file)
  const offers = parse(html)
  console.log(`\n=== ${label}  (${html.length} bytes)`)
  console.log(`    ${offers.length} offers parsed`)

  if (offers.length === 0) {
    console.log('    FAIL: nothing parsed')
    failed++
    continue
  }

  for (const o of offers.slice(0, 4)) {
    console.log(`    ${o.currency} ${o.price.toFixed(2)}  ${o.store}`)
    console.log(`      name : ${o.name.slice(0, 78)}`)
    console.log(`      url  : ${o.url}`)
    console.log(`      image: ${o.imageUrl ? o.imageUrl.slice(0, 74) : '(none)'}`)
  }

  const problems = offers.filter(
    (o) => !/^https?:\/\//.test(o.url) || o.price <= 0 || o.name.length < 4
  )
  if (problems.length) {
    console.log(`    FAIL: ${problems.length} malformed offers`)
    failed++
  }

  const ads = offers.filter((o) => /shop on ebay/i.test(o.name))
  if (ads.length) {
    console.log(`    FAIL: ${ads.length} advert(s) leaked through`)
    failed++
  }
}

console.log(failed === 0 ? '\nall parsers produced usable offers' : `\n${failed} case(s) failed`)
process.exit(failed === 0 ? 0 : 1)