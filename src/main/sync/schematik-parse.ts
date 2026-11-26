/**
 * Pure parsing helpers for the Schematik source.
 *
 * Kept free of imports so the self-check can run them under
 * `--experimental-strip-types` without pulling in Electron or better-sqlite3,
 * the same reason `partsearch-parse.ts` and `images-parse.ts` exist.
 *
 * The source is inconsistent by nature: price arrives as display text
 * ("from 6.99 USD"), and a pin's descriptive text lives under `function` on
 * connectors but `description` on modules. These helpers normalise both.
 */

export interface SourcePin {
  type?: string | null
  label?: string
  function?: string | null
  description?: string | null
  voltage?: string | null
  required?: boolean
  connectsTo?: string | null
}

export interface NormalisedPin {
  type: string | null
  label: string
  function: string | null
  voltage: string | null
  required: boolean
  connectsTo: string | null
}

/**
 * A price string to a number, or null.
 *
 * "from 6.99 USD" → 6.99. "from 1.5 EUR" → 1.5. A real numeric field wins if
 * the source ever supplies one. A genuine 0 is preserved as 0, not dropped.
 */
export function parsePriceValue(priceText: string | null | undefined, numeric: unknown): number | null {
  if (typeof numeric === 'number' && Number.isFinite(numeric)) return numeric
  if (!priceText) return null
  const match = priceText.match(/(\d+(?:[.,]\d+)?)/)
  if (!match) return null
  const value = Number(match[1].replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

/** A three-letter currency code from the price text, or null. */
export function parseCurrency(priceText: string | null | undefined, explicit: unknown): string | null {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  if (!priceText) return null
  return priceText.match(/\b([A-Z]{3})\b/)?.[1] ?? null
}

/** One source pin to our shape. Reads `function` or `description` for the text. */
export function normalisePin(pin: SourcePin): NormalisedPin {
  return {
    type: pin.type ?? null,
    label: pin.label ?? '',
    // Connectors put the text under `function`, modules under `description`.
    function: pin.function ?? pin.description ?? null,
    voltage: pin.voltage ?? null,
    required: pin.required === true,
    connectsTo: pin.connectsTo ?? null
  }
}