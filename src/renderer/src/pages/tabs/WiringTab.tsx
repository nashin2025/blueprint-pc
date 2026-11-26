import { useState } from 'react'
import type { Connection, DesignSpec } from '@shared/types'
import WiringDiagram from '../../components/WiringDiagram'
import { WIRE_COLORS, WIRE_LABELS } from '../../lib/wiringLayout'
import { exportWiringSvg } from '../../lib/export'
import { DownloadIcon } from '../../components/Icons'

interface Props {
  spec: DesignSpec
}

const KINDS: Connection['kind'][] = ['power', 'ground', 'signal', 'data']

export default function WiringTab({ spec }: Props) {
  const [focus, setFocus] = useState<string | null>(null)
  const [filter, setFilter] = useState<Connection['kind'] | null>(null)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Show</span>
          <button
            onClick={() => setFilter(null)}
            className={`rounded-md border px-2 py-1 text-[11px] transition ${
              filter === null
                ? 'border-line-bright bg-surface-3 text-ink'
                : 'border-line bg-surface-1 text-ink-faint hover:text-ink-dim'
            }`}
          >
            All
          </button>
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setFilter(filter === k ? null : k)}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition ${
                filter === k
                  ? 'border-line-bright bg-surface-3 text-ink'
                  : 'border-line bg-surface-1 text-ink-faint hover:text-ink-dim'
              }`}
            >
              <span className="size-1.5 rounded-full" style={{ background: WIRE_COLORS[k] }} />
              {WIRE_LABELS[k]}
              <span className="font-mono text-ink-faint">
                {spec.connections.filter((c) => c.kind === k).length}
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={() => exportWiringSvg(spec)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-[13px] text-ink-dim transition hover:border-line-bright hover:text-ink"
        >
          <DownloadIcon size={14} />
          Save SVG
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {spec.connections.length === 0 ? (
          <EmptyWiring />
        ) : (
          <WiringDiagram spec={spec} focusComponentId={focus} onFocusComponent={setFocus} filterKind={filter} />
        )}
      </div>

      {focus && (
        <div className="shrink-0 border-t border-line bg-surface-2/60 px-6 py-2 text-[11px] text-ink-faint">
          Highlighting wires for{' '}
          <span className="text-ink-dim">{spec.components.find((c) => c.id === focus)?.name ?? 'component'}</span>
          <button onClick={() => setFocus(null)} className="ml-2 text-accent hover:underline">
            clear
          </button>
        </div>
      )}
    </div>
  )
}

function EmptyWiring() {
  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="max-w-md text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-lg border border-line bg-surface-1">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink-faint">
            <circle cx="6" cy="6" r="2.4" />
            <circle cx="18" cy="18" r="2.4" />
            <path d="M8.4 6H14a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h6.6" />
          </svg>
        </div>
        <h3 className="mt-3 text-sm font-medium">No wiring in this design</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">
          The model returned components but no connections between them. Refine the design in the Chat tab and
          ask it to wire everything up.
        </p>
      </div>
    </div>
  )
}