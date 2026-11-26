import { htmlDecode, isSamePart, modelTokens, normalise } from './partsearch-parse'
import { toUsd } from '../shared/money'

/**
 * Parsers for retailer search pages.
 *
 * These are scrapes, not APIs. Vendors change markup without notice and most of
 * them block scripted requests outright, so every parser is defensive: it returns
 * what it can find and nothing rather than throwing. A bad parse must degrade to
 * "no offers", never to a broken parts list.
 *
 * What is reachable, measured rather than assumed:
 *
 * - Adafruit and AliExpress answer plain `fetch` with prices in the markup.
 * - eBay 403s plain `fetch` from its edge, so its HTML is obtained from a real
 *   browser window and handed here as a string.
 * - Amazon answers only after a warm-up navigation in the same session.
 * - DigiKey, Mouser, RobotShop, Newark 403; SparkFun, Pololu, Temu and Walmart
 *   render prices client-side, and Temu additionally walls search behind a login.
 */

export interface ParsedOffer {
  store: string
  name: string
  price: number
  currency: string
  url: string
  inStock: boolean
  /** Present when the listing page exposed a product photo. */
  imageUrl?: string
}

function absolute(url: string, base: string): string {
  try {
    return new URL(url, base).toString()
  } catch {
    return url
  }
}

function stripTags(text: string): string {
  return htmlDecode(text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/**
 * Adafruit exposes schema.org microdata: `itemprop="name"`, `itemprop="price"`
 * with the value in a `content` attribute, and `itemprop="availability"`.
 * Each result carries a `/product/<id>` link and a thumbnail.
 */
export function parseAdafruit(html: string, baseUrl: string): ParsedOffer[] {
  const offers: ParsedOffer[] = []
  const nameRe = /itemprop=["']name["'][^>]*content=["']([^"']+)["']/gi

  let match: RegExpExecArray | null
  while ((match = nameRe.exec(html)) !== null) {
    const name = htmlDecode(match[1]).trim()
    if (!name) continue

    // The name, price and link sit in the same product tile, a few hundred
    // characters apart, so a forward window is enough to pair them.
    const window = html.slice(match.index, match.index + 3000)

    const priceMatch = window.match(/itemprop=["']price["'][^>]*content=["']([\d.]+)["']/i)
    if (!priceMatch) continue
    const price = Number(priceMatch[1])
    if (!Number.isFinite(price) || price <= 0) continue

    const currency = window.match(/itemprop=["']priceCurrency["'][^>]*content=["']([A-Z]{3})["']/i)
    const link = window.match(/href=["'](\/product\/\d+)["']/i)
    const image = window.match(/class=["'][^"']*productThumb[^"']*["'][^>]*src=["']([^"']+)["']/i)
    const availability = window.match(/itemprop=["']availability["'][^>]*content=["']([^"']+)["']/i)

    const inStock = !/OutOfStock|BackOrder|Discontinued/i.test(availability?.[1] ?? '')

    offers.push({
      store: 'Adafruit',
      name,
      price,
      currency: currency?.[1] ?? 'USD',
      url: link ? absolute(link[1], baseUrl) : baseUrl,
      inStock,
      ...(image ? { imageUrl: absolute(image[1], baseUrl) } : {})
    })
  }

  return offers
}

/**
 * AliExpress ships its search results as one embedded SSR blob: `productId`,
 * `image.imgUrl`, `title.displayTitle` and a `prices` object holding a
 * `salePrice` and, when the listing is multi-pack, a per-piece
 * `singleDiscountPrice`.
 *
 * Two traps, both learned by looking at a real response:
 *
 * 1. `prices` also carries a top-level `minPrice`, which is the undiscounted
 *    price. Reading the first `minPrice` after the product id returns that
 *    instead of the sale price, so the lookup is scoped to each price object.
 * 2. `salePrice` on a "5 Pcs" listing is the price of all five, while
 *    `singleDiscountPrice` is one. Only the per-piece figure is comparable to
 *    the unit prices other stores quote, so it wins and `salePrice` is a
 *    labelled fallback.
 *
 * Currency comes from the payload rather than being assumed: AliExpress
 * geo-localises by IP and quotes this user in MVR.
 */
export function parseAliExpress(html: string, baseUrl: string): ParsedOffer[] {
  const offers: ParsedOffer[] = []
  const idRe = /"productId":"(\d+)"/g

  let match: RegExpExecArray | null
  while ((match = idRe.exec(html)) !== null) {
    const productId = match[1]
    if (!productId) continue

    const window = html.slice(match.index, match.index + 5000)

    const title = window.match(/"displayTitle":"((?:[^"\\]|\\.)*)"/)
    if (!title) continue
    const name = decodeJsonString(title[1]).trim()
    if (name.length < 4) continue

    // Scoped so the outer, undiscounted `minPrice` cannot be picked up.
    const priceIn = (key: string): { price: number; currency: string } | null => {
      const at = window.indexOf(`"${key}":{`)
      if (at < 0) return null
      const section = window.slice(at, at + 600)
      const value = section.match(/"minPrice":([\d.]+)/)
      if (!value) return null
      const price = Number(value[1])
      if (!Number.isFinite(price) || price <= 0) return null
      const currency = section.match(/"currencyCode":"([A-Z]{3})"/)
      if (!currency) return null
      return { price, currency: currency[1] }
    }

    const perPiece = priceIn('singleDiscountPrice')
    const lot = priceIn('salePrice')
    const chosen = perPiece ?? lot
    if (!chosen) continue

    const image = window.match(/"imgUrl":"([^"]+)"/)
    const absoluteImage = image
      ? image[1].startsWith('//')
        ? `https:${image[1]}`
        : absolute(image[1], baseUrl)
      : null

    offers.push({
      store: 'AliExpress',
      name,
      price: chosen.price,
      currency: chosen.currency,
      url: `https://www.aliexpress.com/item/${productId}.html`,
      inStock: true,
      ...(absoluteImage ? { imageUrl: absoluteImage } : {})
    })
  }

  return offers
}

/**
 * eBay search results.
 *
 * eBay 403s plain `fetch` with a 1.9 KB edge rejection, so the HTML handed to
 * this parser comes from a real browser window (see store-browser.ts).
 *
 * Two different markups are in service and the same query can return either, so
 * both are handled:
 *
 * - the older `<li class="s-item">` with `.s-item__title` / `.s-item__price`
 * - the newer `<li class="s-card">` with `.s-card__title span` / `.s-card__price`
 *
 * The card variant is the better of the two because it carries `data-listingid`,
 * which gives a canonical `/itm/<id>` URL instead of the tracking-laden href.
 *
 * Cards are sliced from one start tag to the next rather than to a closing tag:
 * result cards contain nested lists, so a non-greedy match to `</li>` truncates.
 * Taking the first title and price inside each slice keeps the right card.
 *
 * Class attributes carry several tokens ("su-styled-text primary bold large-1
 * s-card__price"), so each class is matched as one token among others rather
 * than as the whole attribute value.
 *
 * Two things are filtered. The first card is usually an advert titled "Shop on
 * eBay" whose link is a placeholder `/itm/123456`; and eBay appends "Opens in a
 * new window or tab" to titles, which would otherwise pollute model matching.
 */
export function parseEbaySearch(html: string): ParsedOffer[] {
  const offers: ParsedOffer[] = []
  const startRe = /<li[^>]*class="[^"]*s-(?:item|card)[^"]*"[^>]*>/gi
  const starts = [...html.matchAll(startRe)]

  for (let i = 0; i < starts.length; i++) {
    const from = starts[i].index ?? 0
    const to = i + 1 < starts.length ? (starts[i + 1].index ?? html.length) : html.length
    const card = html.slice(from, to)

    // Prefer the id attribute; it is unambiguous where the href is not.
    const listingId = card.match(/data-listingid="(\d+)"/i)?.[1]
    const href = card.match(/href="(https?:\/\/www\.ebay\.[^"]*\/itm\/(\d+)[^"]*)"/i)
    const itemId = listingId ?? href?.[2]
    if (!itemId || itemId === '123456') continue

    const rawTitle =
      card.match(/class="[^"]*\bs-card__title\b[^"]*"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i) ??
      card.match(/class="[^"]*\bs-item__title\b[^"]*"[^>]*>([\s\S]*?)<\//i) ??
      card.match(/class="[^"]*\bs-card__title\b[^"]*"[^>]*>([\s\S]*?)<\//i)
    if (!rawTitle) continue

    const name = stripTags(rawTitle[1])
      .replace(/\s*Opens in a new window or tab\s*/gi, '')
      .trim()
    if (name.length < 4 || /^shop on ebay$/i.test(name)) continue

    const rawPrice =
      card.match(/class="[^"]*\bs-card__price\b[^"]*"[^>]*>([\s\S]*?)<\//i) ??
      card.match(/class="[^"]*\bs-item__price\b[^"]*"[^>]*>([\s\S]*?)<\//i)
    if (!rawPrice) continue

    // Ranges like "$2.84 to $5.22" are quoted from the low end.
    const priceMatch = stripTags(rawPrice[1]).match(/\$\s?(\d[\d,]*\.\d{2})/)
    if (!priceMatch) continue
    const price = Number(priceMatch[1].replace(/,/g, ''))
    if (!Number.isFinite(price) || price <= 0) continue

    const image = card.match(/<img[^>]+src="([^"]+)"/i)

    offers.push({
      store: 'eBay',
      name,
      price,
      currency: 'USD',
      url: `https://www.ebay.com/itm/${itemId}`,
      inStock: true,
      ...(image ? { imageUrl: image[1] } : {})
    })
  }

  return offers
}

/**
 * Amazon search results, one `div[data-component-type="s-search-result"]` per
 * listing.
 *
 * Amazon 503s the first search of a session, so the HTML arrives from a browser
 * that has already visited the homepage (see store-browser.ts).
 *
 * Amazon also geo-localises: it quotes this user in MVR, with the currency in
 * the price text rather than in a data attribute, so the currency is read out of
 * the string. A strikethrough list price is rendered with `a-text-price` and is
 * excluded, otherwise the saving is reported instead of the price.
 */
export function parseAmazonSearch(html: string): ParsedOffer[] {
  const offers: ParsedOffer[] = []
  const cardRe =
    /<div[^>]*data-component-type="s-search-result"[\s\S]*?(?=<div[^>]*data-component-type="s-search-result"|<\/body>)/gi

  let card: RegExpExecArray | null
  while ((card = cardRe.exec(html)) !== null) {
    const body = card[0]

    const title = body.match(/<h2[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)
    if (!title) continue
    const name = stripTags(title[1]).trim()
    if (name.length < 4) continue

    // The buy-box price, never the struck-through list price.
    const rawPrice = body.match(
      /<span[^>]*class="[^"]*a-price[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>([\s\S]*?)<\/span>/i
    )
    if (!rawPrice) continue

    const priceText = stripTags(rawPrice[1]).replace(/ /g, ' ').trim()
    const currency = priceText.match(/\b([A-Z]{3})\b/)
    const amount = priceText.match(/([\d][\d,]*(?:\.\d{2})?)/)
    if (!amount) continue

    const price = Number(amount[1].replace(/,/g, ''))
    if (!Number.isFinite(price) || price <= 0) continue

    // Ads and some sponsored rows carry no /dp/ link; without one the offer is
    // not actionable, so it is dropped rather than linked to the search page.
    const link = body.match(/href="([^"]*\/dp\/[A-Z0-9]+[^"]*)"/i)
    if (!link) continue

    const image = body.match(/<img[^>]+class="[^"]*s-image[^"]*"[^>]+src="([^"]+)"/i)

    offers.push({
      store: 'Amazon',
      name,
      price,
      // Amazon states the currency in the price itself; dollars when it does not.
      currency: currency?.[1] ?? 'USD',
      url: absolute(link[1].split('&')[0], 'https://www.amazon.com/'),
      inStock: true,
      ...(image ? { imageUrl: image[1] } : {})
    })
  }

  return offers
}

/** Minimal JSON string unescape for values lifted out of an SSR blob. */
function decodeJsonString(value: string): string {
  return value
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\u0026/gi, '&')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\//g, '/')
}

/** Words too generic to prove a match, on top of the shared stoplist. */
const FLUFF = new Set(['premium', 'simple', 'best', 'cheap', 'wholesale', 'genuine', 'original'])

function significantWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (w) => w.length >= 5 && !FLUFF.has(w)
  )
}

/**
 * Drops offers that are not plausibly the part we asked for.
 *
 * Two passes, because the stakes differ. The strict pass requires the model
 * number to appear, or - when the part has no model number - every distinctive
 * word of the request. That is what stops a 1.3in SH1106 OLED being sold to
 * someone who asked for a 0.96in SSD1306, or a "Simple Soil Moisture Sensor"
        being sold to someone who asked for a capacitive one.
 *
 * If the strict pass finds nothing, the loose pass runs so the feature still
        returns something, and `strict` comes back false so the caller can label those
 * results as approximate.
 */
export function matchOffers(
  offers: ParsedOffer[],
  partName: string
): { offers: ParsedOffer[]; strict: boolean } {
  const unique = new Map<string, ParsedOffer>()
  for (const offer of offers) {
    const key = `${offer.store}:${offer.url}`
    if (!unique.has(key)) unique.set(key, offer)
  }
  const all = [...unique.values()]

  const wanted = significantWords(partName)
  const strict = all.filter((offer) => {
    const models = modelTokens(partName)
    if (models.length > 0) {
      const haystack = normalise(offer.name)
      return models.some((m) => haystack.includes(m))
    }
    if (wanted.length === 0) return true
    const found = new Set(significantWords(offer.name))
    const haystack = normalise(offer.name)
    return wanted.every((w) => found.has(w) || haystack.includes(w))
  })

  if (strict.length > 0) return { offers: strict, strict: true }

  const loose = all.filter((offer) => isSamePart(offer.name, partName))
  return { offers: loose, strict: false }
}

/**
 * Cheapest first, with in-stock ahead of out-of-stock at the same price.
 *
 * Ordering is by price in one common currency, because the stores do not share
 * one. Offers in a currency that cannot be converted sort last rather than being
 * compared at face value against dollars.
 */
export function rankOffers(offers: ParsedOffer[]): ParsedOffer[] {
  const comparable = (offer: ParsedOffer): number => toUsd(offer.price, offer.currency) ?? Infinity

  return [...offers].sort((a, b) => {
    if (a.inStock !== b.inStock) return a.inStock ? -1 : 1
    const usdA = comparable(a)
    const usdB = comparable(b)
    if (usdA !== usdB) return usdA - usdB
    return a.price - b.price
  })
}