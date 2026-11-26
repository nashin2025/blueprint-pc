import type { Connection, DesignSpec, Project } from '@shared/types'
import { layoutWiring, WIRE_LABELS } from './wiringLayout'

/** Trigger a download from the sandboxed renderer. */
function download(filename: string, mime: string, contents: string): void {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'design'
  )
}

export function exportProjectJson(project: Project): void {
  download(`${slugify(project.spec.title)}.json`, 'application/json', JSON.stringify(project, null, 2))
}

function csvCell(value: string | number | undefined): string {
  if (value === undefined || value === null) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportBomCsv(spec: DesignSpec): void {
  const header = ['Part', 'Name', 'Category', 'Qty', 'Unit price (USD)', 'Line total (USD)', 'URL']
  const rows = spec.components.map((c) => {
    const line = c.unitPrice === undefined ? undefined : c.unitPrice * c.quantity
    return [
      c.partName ?? '',
      c.name,
      c.category,
      c.quantity,
      c.unitPrice,
      line !== undefined ? line.toFixed(2) : '',
      c.url ?? ''
    ]
      .map(csvCell)
      .join(',')
  })
  const total = spec.components.reduce((sum, c) => sum + (c.unitPrice ?? 0) * c.quantity, 0)
  const footer = ['', 'TOTAL', '', '', '', total.toFixed(2), ''].map(csvCell).join(',')

  download(
    `${slugify(spec.title)}-parts.csv`,
    'text/csv;charset=utf-8',
    [header.join(','), ...rows, footer].join('\n')
  )
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Standalone SVG. Colours are written as literal hex because a CSS custom
 * property does not survive outside the document that declared it.
 */
export function exportWiringSvg(spec: DesignSpec): void {
  const layout = layoutWiring(spec.components, spec.connections)

  const hex: Record<Connection['kind'], string> = {
    power: '#e0b34a',
    ground: '#8b8b9a',
    signal: '#4f8cff',
    data: '#46c79a'
  }

  const wires = layout.wires
    .map((w) => `<path d="${w.d}" fill="none" stroke="${hex[w.kind]}" stroke-width="1.6" stroke-opacity="0.85"/>`)
    .join('\n')

  const nodes = layout.nodes
    .map((n) => {
      const pins = n.pins
        .map(
          (p) =>
            // Both edges, so every wire end has a pin under it in the export too.
            `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#0d0d10" stroke="#4f8cff" stroke-width="1.2"/>` +
            `<circle cx="${p.rightX}" cy="${p.y}" r="3" fill="#0d0d10" stroke="#4f8cff" stroke-width="1.2"/>` +
            `<text x="${p.x + 8}" y="${p.y - 4}" font-size="10" fill="#a0a0ad" font-family="monospace">${escapeXml(p.name)}</text>`
        )
        .join('\n')

      const subtitle = `${n.component.partName ?? n.component.category}${
        n.component.quantity > 1 ? ` x${n.component.quantity}` : ''
      }`

      return `<g>
<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="#121216" stroke="#2a2a35"/>
<text x="${n.x + 14}" y="${n.y + 26}" font-size="14" font-weight="600" fill="#f2f2f5" font-family="sans-serif">${escapeXml(n.component.name)}</text>
<text x="${n.x + 14}" y="${n.y + 41}" font-size="10" fill="#6b6b7a" font-family="monospace">${escapeXml(subtitle)}</text>
${pins}
</g>`
    })
    .join('\n')

  const height = layout.height + 70
  const key = Object.values(WIRE_LABELS).join(' / ')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${height}" viewBox="0 0 ${layout.width} ${height}">
<rect width="100%" height="100%" fill="#08080a"/>
<text x="32" y="38" font-size="18" font-weight="700" fill="#f2f2f5" font-family="sans-serif">${escapeXml(spec.title)}</text>
${wires}
${nodes}
<text x="32" y="${height - 18}" font-size="11" fill="#6b6b7a" font-family="monospace">WIRE KEY: ${escapeXml(key)}</text>
</svg>`

  download(`${slugify(spec.title)}-wiring.svg`, 'image/svg+xml', svg)
}