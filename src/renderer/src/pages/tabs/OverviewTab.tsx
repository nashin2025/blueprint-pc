import type { DesignSpec, Project } from '@shared/types'
import { currency, relativeTime } from '../../lib/format'

interface Props {
  spec: DesignSpec
  project: Project
}

export default function OverviewTab({ spec, project }: Props) {
  const totalUnits = spec.components.reduce((sum, c) => sum + c.quantity, 0)
  const priced = spec.components.filter((c) => c.unitPrice)
  const cost = priced.reduce((sum, c) => sum + (c.unitPrice ?? 0) * c.quantity, 0)
  const unpriced = spec.components.length - priced.length

  const byCategory = spec.components.reduce<Record<string, number>>((acc, c) => {
    acc[c.category] = (acc[c.category] ?? 0) + c.quantity
    return acc
  }, {})
  const categories = Object.entries(byCategory).sort((a, b) => b[1] - a[1])

  const power = spec.connections.filter((c) => c.kind === 'power').length
  const ground = spec.connections.filter((c) => c.kind === 'ground').length
  const data = spec.connections.filter((c) => c.kind === 'data').length
  const signal = spec.connections.filter((c) => c.kind === 'signal').length

  const netNames = [...new Set(spec.connections.map((c) => c.net).filter((n): n is string => !!n))]

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Components" value={String(spec.components.length)} hint={`${totalUnits} units total`} />
        <Stat
          label="Parts cost"
          value={priced.length ? currency(cost) : '—'}
          hint={unpriced > 0 ? `${unpriced} without a price` : 'prices from the model'}
        />
        <Stat label="Connections" value={String(spec.connections.length)} hint={`${netNames.length} named nets`} />
        <Stat
          label="Build time"
          value={spec.estimatedTime ?? '—'}
          hint={spec.estimatedTime ? 'rough estimate' : 'no estimate given'}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold tracking-tight">What this is</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-dim">
            {spec.summary || 'No summary was produced for this design.'}
          </p>

          <h3 className="mt-5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
            Wiring by type
          </h3>
          <div className="mt-2.5 grid grid-cols-4 gap-2">
            <WireStat label="Power" value={power} color="var(--color-wire-power)" />
            <WireStat label="Ground" value={ground} color="var(--color-wire-ground)" />
            <WireStat label="Signal" value={signal} color="var(--color-wire-signal)" />
            <WireStat label="Data" value={data} color="var(--color-wire-data)" />
          </div>

          {netNames.length > 0 && (
            <>
              <h3 className="mt-5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                Named nets
              </h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {netNames.map((n) => (
                  <span
                    key={n}
                    className="rounded border border-line bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-ink-dim"
                  >
                    {n}
                  </span>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold tracking-tight">Parts by category</h2>
          {categories.length === 0 ? (
            <p className="mt-3 text-[13px] text-ink-faint">No components.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {categories.map(([name, count]) => {
                const max = categories[0][1]
                return (
                  <li key={name}>
                    <div className="flex items-baseline justify-between text-[12px]">
                      <span className="text-ink-dim">{name}</span>
                      <span className="font-mono text-ink-faint">{count}</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full bg-accent/70"
                        style={{ width: `${Math.max(6, (count / max) * 100)}%` }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="card mt-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Version history</h2>
          <span className="font-mono text-[11px] text-ink-faint">
            {project.versions.length} {project.versions.length === 1 ? 'version' : 'versions'}
          </span>
        </div>
        <ol className="mt-3 space-y-1.5">
          {[...project.versions].reverse().map((v, i) => (
            <li
              key={v.id}
              className="flex items-center gap-3 rounded-lg border border-line bg-surface-2/50 px-3 py-2"
            >
              <span className="font-mono text-[11px] text-ink-faint">
                v{project.versions.length - i}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{v.label}</span>
              {i === 0 && (
                <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                  current
                </span>
              )}
              <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(v.createdAt)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{label}</div>
      <div className="mt-1.5 truncate text-xl font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-ink-faint">{hint}</div>
    </div>
  )
}

function WireStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/50 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</span>
      </div>
      <div className="mt-0.5 font-mono text-sm">{value}</div>
    </div>
  )
}