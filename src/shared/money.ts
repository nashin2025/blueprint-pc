/**
 * Money handling across currencies.
 *
 * Retailers do not quote in one currency. AliExpress geo-localises by IP and
 * serves the Maldivian rufiyaa to this user; Adafruit, Walmart and eBay quote in
 * US dollars. Comparing "158.17" against "11.49" as if both were dollars is the
 * kind of silent wrongness that makes a price comparison worse than useless, so
 * every offer carries its currency and anything that ranks or totals converts
 * through here first.
 */

/**
 * Maldivian rufiyaa per US dollar.
 *
 * The rufiyaa is pegged, so this is stable rather than a market rate that drifts
 * every minute. It is still a snapshot: if the peg ever moves, this constant is
 * the one line to update, and converted values are labelled "≈" in the UI so
 * nobody mistakes them for a quoted price.
 */
export const MVR_PER_USD = 15.42

const SUPPORTED = new Set(['USD', 'MVR'])

/** The offer's price expressed in US dollars, or null when it cannot be converted. */
export function toUsd(price: number, currency: string): number | null {
  if (!Number.isFinite(price)) return null
  if (currency === 'USD') return price
  if (currency === 'MVR') return price / MVR_PER_USD
  return null
}

/** True when a currency is one we can rank against the others. */
export function isComparable(currency: string): boolean {
  return SUPPORTED.has(currency)
}

/** Native formatting, e.g. "MVR 158.17" or "$11.49". */
export function formatNative(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(price)
  } catch {
    return `${currency} ${price.toFixed(2)}`
  }
}

/**
 * A dollar approximation for a non-USD offer, or null when the currency is
 * already USD or unknown. The "≈" is deliberate: this is a conversion, not a
 * quote from the store.
 */
export function approxUsd(price: number, currency: string): string | null {
  if (currency === 'USD' || !isComparable(currency)) return null
  const usd = toUsd(price, currency)
  if (usd === null) return null
  return `≈$${usd.toFixed(2)}`
}