import { useEffect, useMemo, useState } from 'react'
import type { CatalogueSummary, Component } from '@shared/types'
import { SparkIcon } from '../../components/Icons'

/**
 * The PART section: search the local catalogue and add parts to the project.
 *
 * Everything is local — no network calls except the catalogue sync that already ran.
 */

interface Props {
  /** Called when a part is added to the project. The component already has
   *  a designator assigned by the caller if one was provided. */
  onAdd: (component: Component) => void
}

interface ColumnVisibility {
  part: boolean
  brand: boolean
  price: boolean
  pins: boolean
}

export default function PartTab({ onAdd }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogueSummary[]>([])
  const [searching, setSearching] = useState(false)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [columns, setColumns] = useState<ColumnVisibility>({
    part: true,
    brand: true,
    price: true,
    pins: true
  })

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    let cancelled = false
    const handle = setTimeout(async () => {
      const res = await window.api.catalogue.search(q, 20)
      if (cancelled) return
      if (res.ok && res.data) setResults(res.data)
      setSearching(false)
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query])

  async function addPart(slug: string) {
    if (added.has(slug)) return

    const res = await window.api.catalogue.get(slug)
    if (!res.ok || !res.data) return

    const part = res.data

    // Prompt for a designator (R1, C2, U1, etc.)
    const designator = window.prompt(
      `Designator for "${part.name}" (e.g. R1, C2, U1):`,
      `${part.category?.slice(0, 1).toUpperCase() ?? 'X'}${added.size + 1}`
    )

    const component: Component = {
      id: `cmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: part.name,
      partName: part.name,
      category: part.category ?? 'part',
      quantity: 1,
      unitPrice: part.priceValue ?? undefined,
      url: part.url || undefined,
      image: part.image ?? undefined,
      pins: part.pinout.map((p, i) => p.label || `#${i + 1}`),
      notes: part.description || undefined,
      designator: designator?.trim() || undefined
    }

    onAdd(component)

    setAdded((prev) => {
      const next = new Set(prev)
      next.add(slug)
      return next
    })
  }

  const filtered = useMemo(
    () =>
      results.filter(
        (p) =>
          !query.trim() ||
          p.name.toLowerCase().includes(query.toLowerCase()) ||
          (p.brand ?? '').toLowerCase().includes(query.toLowerCase())
      ),
    [results, query]
  )

  const hasAdded = added.size > 0

  const toggleColumn = (key: keyof ColumnVisibility) => {
    setColumns((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">PART</h2>
          <p className="mt-1 text-[13px] text-ink-dim">
            Search the local catalogue and add parts to this design.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-2 py-1">
            <span className="text-caption">Columns</span>
            {Object.entries(columns).map(([key, visible]) => (
              <button
                key={key}
                onClick={() => toggleColumn(key as keyof ColumnVisibility)}
                className={`rounded px-2 py-0.5 text-[10px] transition ${
                  visible ? 'bg-accent text-white' : 'text-ink-faint hover:bg-surface-2'
                }`}
                title={`Toggle ${key} column`}
              >
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search parts by name, brand or number…"
            className="input-field w-48"
          />
          {hasAdded && (
            <button
              className="btn-ghost"
              title="Added parts are already in this design"
            >
              {added.size} added
            </button>
          )}
        </div>
      </div>

      {query.trim() === '' ? (
        <EmptyHint />
      ) : searching ? (
        <div className="mt-8 flex h-64 items-center justify-center text-[12.5px] text-ink-faint">
          Searching catalogue…
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-8 flex h-64 items-center justify-center text-[12.5px] leading-relaxed text-ink-faint">
          No parts match <span className="text-ink">&ldquo;{query}&rdquo;</span>.
        </div>
      ) : (
        <div className="mt-4 overflow-y-auto">
          <table className="w-full border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-surface-2/60">
                {columns.part && (
                  <th className="px-3 py-2 text-[10px] uppercase tracking-widest text-ink-faint">Part</th>
                )}
                {columns.brand && (
                  <th className="px-3 py-2 text-[10px] uppercase tracking-widest text-ink-faint w-24">Brand</th>
                )}
                {columns.price && (
                  <th className="px-3 py-2 text-[10px] uppercase tracking-widest text-ink-faint w-20">Price</th>
                )}
                {columns.pins && (
                  <th className="px-3 py-2 text-[10px] uppercase tracking-widest text-ink-faint w-20">Pins</th>
                )}
                <th className="px-3 py-2 text-[10px] uppercase tracking-widest text-ink-faint w-16" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((part) => (
                <tr key={part.slug} className="border-b border-line/50 hover:bg-surface-1/40">
                  {columns.part && (
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[10px] font-mono uppercase tracking-wider text-ink-faint">
                          {part.category ? part.category[0].toUpperCase() : '?'}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium leading-tight text-ink truncate">
                            {part.name}
                          </div>
                        </div>
                      </div>
                    </td>
                  )}
                  {columns.brand && (
                    <td className="px-3 py-2 text-[12px] text-ink-dim">{part.brand ?? '—'}</td>
                  )}
                  {columns.price && (
                    <td className="px-3 py-2 text-[12px]">
                      {part.priceText ? (
                        <span className="font-mono text-ink">{part.priceText}</span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                  )}
                  {columns.pins && (
                    <td className="px-3 py-2 text-[12px] font-mono text-ink-faint">
                      {part.pinCount ?? '—'}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <button
                      onClick={() => void addPart(part.slug)}
                      disabled={added.has(part.slug)}
                      className={added.has(part.slug)
                        ? 'bg-surface-2 text-ink-faint cursor-not-allowed flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition'
                        : 'bg-accent text-white flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition hover:bg-accent/90 hover:scale-[0.98]'}
                    >
                      {added.has(part.slug) ? (
                        <span className="font-mono text-[10px]">added</span>
                      ) : (
                        <>
                          <SparkIcon size={12} />
                          Add
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {added.size > 0 && (
        <div className="mt-6 card p-4">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-ink-faint mb-3">
            Added to this design
          </h3>
          <p className="text-[13px] text-ink-dim">
            {added.size} part{added.size > 1 ? 's' : ''} added from the catalogue.
          </p>
        </div>
      )}
    </div>
  )
}

function EmptyHint() {
  return (
    <div className="mt-8 flex h-64 flex-col items-center justify-center text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-lg border border-line bg-surface-1 text-ink-faint">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="8" r="7" />
          <path d="M5 3h14l2 6h-6l-2 6" />
        </svg>
      </div>
      <h3 className="mt-3 text-sm font-medium">Search the catalogue</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">
        Type a part name, brand or number to find purchasable parts and add them to this design.
      </p>
    </div>
  )
}
