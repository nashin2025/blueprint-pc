/**
 * Build a netlist text from a DesignSpec.
 *
 * Format (one net per line):
 *   NET:<net_name> <component_id>:<pin> <component_id>:<pin> ...
 *
 * Connections without a net name get an auto-generated name (NET_1, NET_2, ...).
 * Each pin appears once per net it belongs to.
 */
import type { Connection, DesignSpec } from '@shared/types'

export function buildNetlist(spec: DesignSpec): string {
  const lines: string[] = []
  lines.push('# Blueprint PC netlist')
  lines.push('# Format: NET:<net_name> <component_id>:<pin> <component_id>:<pin> ...')
  lines.push('# Generated: ' + new Date().toISOString())
  lines.push('')

  // Group connections by net name.
  const netMap = new Map<string, Array<{ componentId: string; pin: string }>>()
  let autoNetCounter = 0
  const netName = (conn: Connection): string => {
    if (conn.net) return conn.net
    autoNetCounter += 1
    return `NET_${autoNetCounter}`
  }

  for (const conn of spec.connections) {
    const name = netName(conn)
    if (!netMap.has(name)) netMap.set(name, [])
    netMap.get(name)!.push(conn.from)
    netMap.get(name)!.push(conn.to)
  }

  for (const [name, pins] of netMap) {
    const entries = pins.map((p) => `${p.componentId}:${p.pin}`).join(' ')
    lines.push(`NET:${name} ${entries}`)
  }

  return lines.join('\n') + '\n'
}
