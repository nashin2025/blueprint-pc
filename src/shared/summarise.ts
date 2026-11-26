import type { DesignSpec } from './types'

/**
 * Turns a design into a short plain-text summary for a chat bubble.
 * Lives in shared so both the main process and the renderer can use it without
 * either one importing the other's code.
 */
export function summariseSpec(spec: DesignSpec): string {
  const cost = spec.components.reduce((sum, c) => sum + (c.unitPrice ?? 0) * c.quantity, 0)
  const parts = spec.components.length
  const links = spec.connections.length
  const costText = cost > 0 ? ` Estimated parts cost: about $${cost.toFixed(2)}.` : ''
  return `Built "${spec.title}" - ${parts} components, ${links} connections, ${spec.steps.length} assembly steps.${costText}\n\n${spec.summary}`
}