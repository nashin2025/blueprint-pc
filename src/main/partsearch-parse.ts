/**
 * Pure query and matching logic for part lookup.
 *
 * No imports and no Electron, so the self-check can assert on it directly
 * instead of needing a network call or a running app.
 */

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)(?:[?#]|$)/i

/** Titles that describe a diagram or document, not a photograph of the part. */
export const LOOKS_LIKE_DOCUMENT =
  /(icon|logo|sprite|spacer|pixel|placeholder|avatar|diagram|schematic|graph|chart|pinout|datasheet|drawing|blueprint|poster|infographic)/i

/** Words too generic to prove a match on their own. */
const STOPWORDS = new Set([
  'the', 'and', 'with', 'for', 'from', 'pack', 'set', 'new', 'one', 'two',
  'module', 'board', 'cable', 'wire', 'kit', 'size', 'type', 'inch',
  'pcs', 'pc', 'price', 'sale'
])

export function isImageFile(url: string): boolean {
  return IMAGE_EXT.test(url ?? '')
}

/** Lowercase word tokens, ignoring punctuation and short noise. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

/** Prefix-aware equality, so "ohm" matches "ohms" and "battery" matches "batteries". */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 3 || b.length < 3) return false
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return long.startsWith(short)
}

/** Minimal entity decoding for retailer markup, which is full of &amp;. */
export function htmlDecode(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

/** Lowercase alphanumerics only, so "DHT-22" and "DHT22" compare equal. */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * The model numbers in a part name, e.g. "DHT22 (AM2302) sensor" -> ["dht22", "am2302"].
 *
 * These are what identify a part. "Temperature and humidity sensor" describes a
 * dozen products; "DHT22" describes exactly one.
 *
 * A token only counts when it mixes at least two letters with at least one digit.
 * That rejects bare dimensions like "128x64" and "0.96", which would otherwise
 * match every OLED on the shelf and make the wrong product look correct.
 */
export function modelTokens(name: string): string[] {
  const found = name.match(/[a-z0-9]+/gi) ?? []
  const keep = found.filter((t) => {
    if (t.length < 4) return false
    const letters = (t.match(/[a-z]/gi) ?? []).length
    const digits = (t.match(/\d/g) ?? []).length
    return letters >= 2 && digits >= 1
  })
  return [...new Set(keep.map((t) => t.toLowerCase()))]
}

/**
 * True when a retailer listing is actually the part we asked for.
 *
 * When the part name contains a model number, that model must appear in the
 * listing. Without this, searching for a DHT22 happily returns an AM2320, an
 * AHT20 and an SHT30 - all plausible-looking temperature sensors, all the wrong
 * part. Only when there is no model number does it fall back to word overlap.
 */
export function isSamePart(title: string, query: string): boolean {
  const models = modelTokens(query)
  if (models.length > 0) {
    const haystack = normalise(title)
    return models.some((model) => haystack.includes(model))
  }
  return isRelevantTitle(title, query)
}

/**
 * True when a Commons file title looks like it shows the part we searched for.
 *
 * The bar scales with how specific the query is. A multi-word query needs two
 * shared words, or one distinctive word of six or more characters. A single-word
 * query needs just that one word, because there is nothing else to match on.
 */
export function isRelevantTitle(title: string, query: string): boolean {
  const wanted = tokens(query)
  if (wanted.length === 0) return true

  const found = tokens(title)

  if (wanted.length === 1) {
    return found.some((word) => sameWord(word, wanted[0]))
  }

  let matches = 0
  for (const word of found) {
    for (const want of wanted) {
      if (sameWord(word, want)) {
        matches++
        if (want.length >= 6 || word.length >= 6) return true
        break
      }
    }
  }
  return matches >= 2
}

/**
 * Turns a model-written part name into progressively simpler search terms.
 *
 * "Capacitive Soil Moisture Sensor v1.2 (corrosion resistant)" is a terrible
 * search query and a fine part name. Candidates drop parentheticals, version
 * noise, pack sizes, bare measurements like 0.96in or 128x64, and finally word
 * count, down to the first word.
 */
export function searchCandidates(name: string): string[] {
  const stripped = name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\bpack of \d+\b/gi, ' ')
    .replace(/\bv\d+(\.\d+)?\b/gi, ' ')
    .replace(/["'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const withoutMeasures = stripped
    .replace(/\b\d+(?:\.\d+)?\s?(?:mm|cm|inch|in|ft|oz|ml)\b/gi, ' ')
    .replace(/\b\d+x\d+\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const out: string[] = []
  const push = (value: string) => {
    const v = value.replace(/\s+/g, ' ').trim()
    if (v.length >= 3 && !out.includes(v)) out.push(v)
  }

  push(stripped)
  push(withoutMeasures)

  for (const base of [stripped, withoutMeasures]) {
    const words = base.split(' ').filter(Boolean)
    if (words.length > 3) push(words.slice(0, 3).join(' '))
    if (words.length > 2) push(words.slice(0, 2).join(' '))
    if (words.length > 1 && words[0].length >= 5) push(words[0])
  }

  if (out.length === 0) push(name)

  return out
}