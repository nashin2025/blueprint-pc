/**
 * Category illustrations for the parts list.
 *
 * These exist because vendor photos cannot be relied on. Models fabricate product
 * URLs at a high rate (in testing, 4 of 4 Amazon links were dead), and vendor
 * sites block scrapers. A locally drawn glyph means every row has a picture even
 * with no network, and a real photo simply replaces it when one is available.
 *
 * Pure string building, so the self-check can assert every category is covered.
 */

export type PartCategory =
  | 'Microcontroller'
  | 'Sensor'
  | 'Actuator'
  | 'Power'
  | 'Display'
  | 'Passive'
  | 'Connector'
  | 'Structure'
  | 'Other'

/** Maps the model's free-text category onto a known glyph. */
export function categoryKey(raw: string): PartCategory {
  const c = raw.trim().toLowerCase()
  if (c.includes('micro') || c.includes('controller') || c.includes('computer') || c.includes('board')) {
    return 'Microcontroller'
  }
  if (c.includes('sensor') || c.includes('input')) return 'Sensor'
  if (c.includes('actuat') || c.includes('output') || c.includes('motor') || c.includes('led')) {
    return 'Actuator'
  }
  if (c.includes('power') || c.includes('batter') || c.includes('supply') || c.includes('charger')) {
    return 'Power'
  }
  if (c.includes('display') || c.includes('screen') || c.includes('oled') || c.includes('lcd')) {
    return 'Display'
  }
  if (c.includes('passive') || c.includes('resistor') || c.includes('capacitor') || c.includes('crystal')) {
    return 'Passive'
  }
  if (c.includes('connector') || c.includes('cable') || c.includes('wire') || c.includes('header')) {
    return 'Connector'
  }
  if (c.includes('structure') || c.includes('mount') || c.includes('enclosure') || c.includes('bracket')) {
    return 'Structure'
  }
  return 'Other'
}

interface Glyph {
  /** Body drawn in a 24x24 box. */
  body: string
  color: string
}

const GLYPHS: Record<PartCategory, Glyph> = {
  Microcontroller: {
    color: '#4f8cff',
    body: `
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.6" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="0.8" />
      <path d="M9.5 3.2v3.3M14.5 3.2v3.3M9.5 17.5v3.3M14.5 17.5v3.3M3.2 9.5h3.3M3.2 14.5h3.3M17.5 9.5h3.3M17.5 14.5h3.3" />
    `
  },
  Sensor: {
    color: '#46c79a',
    body: `
      <circle cx="12" cy="12" r="2.4" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4" />
      <path d="M5 5a10 10 0 0 0 0 14M19 19a10 10 0 0 0 0-14" opacity="0.55" />
    `
  },
  Actuator: {
    color: '#e5544b',
    body: `
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2M5.9 5.9l1.6 1.6M16.5 16.5l1.6 1.6M18.1 5.9l-1.6 1.6M7.5 16.5l-1.6 1.6" />
    `
  },
  Power: {
    color: '#e0b34a',
    body: `
      <rect x="3" y="7.5" width="16" height="9" rx="1.8" />
      <path d="M19 10.5h1.6v3H19" />
      <rect x="5.4" y="9.6" width="3.4" height="4.8" rx="0.6" fill="currentColor" stroke="none" />
      <rect x="10.3" y="9.6" width="3.4" height="4.8" rx="0.6" fill="currentColor" stroke="none" opacity="0.5" />
    `
  },
  Display: {
    color: '#a78bfa',
    body: `
      <rect x="3" y="5.5" width="18" height="11" rx="1.8" />
      <path d="M9 19.5h6M12 16.5v3" />
      <rect x="6" y="8" width="4" height="2.4" rx="0.4" fill="currentColor" stroke="none" opacity="0.75" />
      <rect x="11.5" y="8" width="6.5" height="2.4" rx="0.4" fill="currentColor" stroke="none" opacity="0.4" />
      <rect x="6" y="12" width="7.5" height="2.2" rx="0.4" fill="currentColor" stroke="none" opacity="0.55" />
    `
  },
  Passive: {
    color: '#8b8b9a',
    body: `
      <path d="M2.5 12h4l1.4-3.2 2.2 6.4 2.2-6.4 2.2 6.4 1.6-3.2h5.4" />
      <path d="M2.5 9.6v4.8M21.5 9.6v4.8" opacity="0.5" />
    `
  },
  Connector: {
    color: '#7dd3fc',
    body: `
      <path d="M4 8.5h5.5v7H4z" />
      <path d="M9.5 10.5h3.2v3H9.5z" />
      <path d="M12.7 9.2h3.4M12.7 12h4.6M12.7 14.8h3.4" />
      <path d="M4 10.2v3.6" opacity="0.5" />
    `
  },
  Structure: {
    color: '#f0a868',
    body: `
      <path d="M4 19.5V5h5.5" />
      <path d="M9.5 5v4.5H14" />
      <path d="M14 9.5h5.5v10H4" opacity="0.65" />
    `
  },
  Other: {
    color: '#6b6b7a',
    body: `
      <rect x="5" y="5" width="14" height="14" rx="2.4" stroke-dasharray="2.4 2.2" />
      <path d="M12 9.4v5.2M9.4 12h5.2" opacity="0.7" />
    `
  }
}

/** An SVG data URI for a category glyph. Safe to use directly as an img src. */
export function partArt(category: string): string {
  const key = categoryKey(category)
  const glyph = GLYPHS[key]
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" ` +
    `fill="none" stroke="${glyph.color}" stroke-width="1.4" stroke-linecap="round" ` +
    `stroke-linejoin="round" style="color:${glyph.color}">${glyph.body}</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export const ALL_CATEGORIES: PartCategory[] = [
  'Microcontroller',
  'Sensor',
  'Actuator',
  'Power',
  'Display',
  'Passive',
  'Connector',
  'Structure',
  'Other'
]