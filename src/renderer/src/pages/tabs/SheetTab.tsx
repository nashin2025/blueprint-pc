import type { Connection, Component, DesignSpec, SheetPort } from '@shared/types'
import { PlusIcon, CircuitIcon } from '../../components/Icons'

interface Props {
  spec: DesignSpec
  activeSheetId: string | null
  onSheetChange: (sheetId: string) => void
  onAddConnection: (connection: Omit<Connection, 'id'>) => void
  onAddPort: (port: Omit<SheetPort, 'id'>) => void
}

/**
 * Canvas tab for a single sheet in a multi-sheet schematic.
 *
 * Shows the active sheet's ports (input/output) as connectable nodes, the
 * connections that belong to this sheet, and the full component list so the
 * user can wire pins to sheet ports. All mutations are reported through
 * callbacks so ProjectView persists the spec.
 */
export default function SheetTab({
  spec,
  activeSheetId,
  onAddConnection,
  onAddPort
}: Props) {
  const sheets = spec.sheets ?? []
  const ports = spec.ports ?? []
  const activeSheet = sheets.find((s) => s.id === activeSheetId) ?? null

  const sheetPorts = activeSheet
    ? ports.filter((p) => p.sheetId === activeSheet.id)
    : []
  const sheetConnections = activeSheet
    ? spec.connections.filter(
        (c) => c.sheetId === activeSheet.id || activeSheet.connectionIds.includes(c.id)
      )
    : []
  const inputPorts = sheetPorts.filter((p) => p.direction === 'input')
  const outputPorts = sheetPorts.filter((p) => p.direction === 'output')

  function componentName(componentId: string): string {
    return spec.components.find((c) => c.id === componentId)?.name ?? componentId
  }

  function handleAddPort() {
    if (!activeSheet) return
    const name = prompt('Port name', `IO${sheetPorts.length + 1}`)
    if (!name) return
    onAddPort({
      sheetId: activeSheet.id,
      name: name.trim(),
      x: 0,
      y: 0,
      direction: 'output'
    })
  }

  function handleAddConnection() {
    if (!activeSheet) return
    onAddConnection({
      sheetId: activeSheet.id,
      from: { componentId: '', pin: '' },
      to: { componentId: '', pin: '' },
      kind: 'signal'
    })
  }

  if (sheets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="max-w-md text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-lg border border-line bg-surface-1">
            <CircuitIcon size={20} className="text-ink-faint" />
          </div>
          <h3 className="mt-3 text-sm font-medium">No sheets yet</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">
            Add a sheet from the Sheets selector above to start a multi-sheet design.
          </p>
        </div>
      </div>
    )
  }

  if (!activeSheet) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="max-w-md text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-lg border border-line bg-surface-1">
            <CircuitIcon size={20} className="text-ink-faint" />
          </div>
          <h3 className="mt-3 text-sm font-medium">Select a sheet</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">
            Choose a sheet from the dropdown above to view its ports and connections.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Sheet</span>
          <div>
            <h3 className="text-sm font-semibold tracking-tight">{activeSheet.name}</h3>
            <div className="text-[11px] text-ink-faint">
              {activeSheet.width} × {activeSheet.height} mm · {sheetPorts.length} port(s) ·{' '}
              {sheetConnections.length} connection(s)
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAddPort}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-[13px] text-ink-dim transition hover:border-line-bright hover:text-ink"
          >
            <PlusIcon size={13} />
            Add port
          </button>
          <button
            onClick={handleAddConnection}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-[13px] text-ink-dim transition hover:border-line-bright hover:text-ink"
          >
            <PlusIcon size={13} />
            Add connection
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto p-6">
        {sheetPorts.length === 0 && sheetConnections.length === 0 ? (
          <EmptySheet />
        ) : (
          <div className="grid grid-cols-[1fr_4fr_1fr] gap-8">
            <div className="space-y-3">
              <h4 className="text-[11px] uppercase tracking-wider text-ink-faint font-medium mb-1">Inputs</h4>
              {inputPorts.length === 0 && (
                <p className="text-[12px] text-ink-dim">No input ports</p>
              )}
              {inputPorts.map((port) => (
                <PortNode key={port.id} port={port} direction="input" />
              ))}
            </div>

            <div className="flex flex-col gap-4">
              <h4 className="text-[11px] uppercase tracking-wider text-ink-faint font-medium">Connections</h4>
              <div className="flex-1 overflow-y-auto border border-line rounded-lg bg-surface-1/50">
                {sheetConnections.length === 0 ? (
                  <div className="p-4 text-center text-[12px] text-ink-dim">
                    No connections on this sheet yet.
                  </div>
                ) : (
                  <div className="divide-y divide-line/30">
                    {sheetConnections.map((conn) => (
                      <ConnectionRow
                        key={conn.id}
                        conn={conn}
                        componentName={componentName}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-[11px] uppercase tracking-wider text-ink-faint font-medium mb-1">Outputs</h4>
              {outputPorts.length === 0 && (
                <p className="text-[12px] text-ink-dim">No output ports</p>
              )}
              {outputPorts.map((port) => (
                <PortNode key={port.id} port={port} direction="output" />
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 border-t border-line/50 pt-6">
          <h4 className="text-[11px] uppercase tracking-wider text-ink-faint font-medium mb-3">Components</h4>
          {spec.components.length === 0 ? (
            <p className="text-[12px] text-ink-dim">No components in this design.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {spec.components.map((comp) => (
                <ComponentChip key={comp.id} component={comp} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptySheet() {
  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="max-w-md text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-lg border border-line bg-surface-1">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink-faint">
            <rect x="3" y="3" width="18" height="18" rx="1" />
            <path d="M3 9h18M3 13h12" />
          </svg>
        </div>
        <h3 className="mt-3 text-sm font-medium">Empty sheet</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">
          Add ports and connections to build out this sheet.
        </p>
      </div>
    </div>
  )
}

interface PortNodeProps {
  port: SheetPort
  direction: 'input' | 'output'
}

function PortNode({ port, direction }: PortNodeProps) {
  const isInput = direction === 'input'
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition ${
        isInput
          ? 'border-line bg-surface-1 text-ink hover:border-line-bright hover:text-accent'
          : 'border-line bg-surface-1 text-ink hover:border-line-bright hover:text-accent'
      }`}
    >
      <div
        className={`size-3 rounded-full border transition ${
          isInput ? 'border-accent bg-accent/10' : 'border-line bg-surface-2'
        }`}
      />
      <span className="font-medium">{port.name}</span>
      <span className="ml-auto text-[10px] font-mono text-ink-faint uppercase">
        {isInput ? 'in' : 'out'}
      </span>
    </div>
  )
}

interface ConnectionRowProps {
  conn: Connection
  componentName: (componentId: string) => string
}

function ConnectionRow({ conn, componentName }: ConnectionRowProps) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 text-[12px]">
      <div className="flex items-center gap-1 text-[11px] text-ink-dim font-mono">
        {conn.from.componentId ? componentName(conn.from.componentId) : '—'}
        <span>:</span>
        {conn.from.pin || '—'}
      </div>
      <span className="mx-2 text-ink-faint">→</span>
      <div className="flex items-center gap-1 text-[11px] text-ink-dim font-mono">
        {conn.to.componentId ? componentName(conn.to.componentId) : '—'}
        <span>:</span>
        {conn.to.pin || '—'}
      </div>
      {conn.net && (
        <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium text-ink-faint bg-surface-2">
          {conn.net}
        </span>
      )}
    </div>
  )
}

interface ComponentChipProps {
  component: Component
}

function ComponentChip({ component }: ComponentChipProps) {
  return (
    <div className="flex items-center justify-between rounded border border-line bg-surface-1 p-2.5 text-[12px]">
      <div className="flex items-center gap-2">
        <div className="size-2 rounded-full bg-ink-faint" />
        <span className="font-medium text-ink truncate">{component.name}</span>
      </div>
      <span className="text-[11px] text-ink-faint font-mono uppercase">{component.category}</span>
    </div>
  )
}
