import { Fragment, useMemo, useState } from 'react'
import type { Component, DesignSpec } from '@shared/types'
import { MVR_PER_USD, toUsd } from '@shared/money'
import { currency } from '../../lib/format'
import { exportBomCsv } from '../../lib/export'
import PartThumb from '../../components/PartThumb'
import { BestPrice, OffersTable } from '../../components/OffersTable'
import PartDetail from './PartDetail'
import { useOffers } from '../../state/useOffers'

interface Props {
  spec: DesignSpec
  /** Called when the user wants to inspect a component's properties. */
  onSelectComponent?: (component: Component) => void
}

/** Always-works path to a purchasable listing, built from the part name. */
function searchUrl(name: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${name} buy`)}`
}

export default function PartsTab({ spec, onSelectComponent }: Props) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'category' | 'price' | 'name' | 'offers'>('category')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // Which part has been opened for detail, if any.
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Offers are loaded once for every row and reused when a row is expanded.
  const allComponents = spec.components
  const { offers, loading } = useOffers(allComponents)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = allComponents.filter((c) => {
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        (c.partName ?? '').toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
      )
    })
    return [...filtered].sort((a, b) => {
      if (sort === 'price') return (b.unitPrice ?? 0) * b.quantity - (a.unitPrice ?? 0) * a.quantity
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'offers') {
        // Offers arrive in mixed currencies, so rank on the dollar equivalent.
        const best = (id: string): number => {
          const offer = offers[id]?.offers[0]
          if (!offer) return Number.POSITIVE_INFINITY
          return toUsd(offer.price, offer.currency) ?? Number.POSITIVE_INFINITY
        }
        return best(a.id) - best(b.id)
      }
      return a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
    })
  }, [allComponents, query, sort, offers])

  const shownCost = rows.reduce((sum, c) => sum + (c.unitPrice ?? 0) * c.quantity, 0)
  const priced = rows.filter((c) => c.unitPrice !== undefined)
  const isPartial = priced.length < rows.length

  const bestTotal = rows.reduce((sum, c) => {
    const offer = offers[c.id]?.offers[0]
    if (!offer) return sum
    // Totals are in dollars, so a rufiyaa offer is converted before it is added.
    return sum + (toUsd(offer.price, offer.currency) ?? 0) * c.quantity
  }, 0)
  const rowsWithOffers = rows.filter((c) => (offers[c.id]?.offers.length ?? 0) > 0).length
  const approximateCount = rows.filter(
    (c) => (offers[c.id]?.offers.length ?? 0) > 0 && offers[c.id]?.strict === false
  ).length

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const selected = selectedId ? allComponents.find((c) => c.id === selectedId) : undefined

  // Opening a part replaces the list rather than stacking on top of it, so the
  // back button always returns to the same scroll position and filter.
  if (selected) {
    const result = offers[selected.id]
    return (
      <PartDetail
        component={selected}
        spec={spec}
        offers={result?.offers ?? []}
        loading={!!loading[selected.id]}
        strict={result?.strict ?? true}
        onBack={() => setSelectedId(null)}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Parts list</h2>
          <p className="text-[13px] text-ink-dim">
            {spec.components.length} line items, {spec.components.reduce((s, c) => s + c.quantity, 0)} units
            {rowsWithOffers > 0 && <> · live prices from {rowsWithOffers} of them</>}
            {approximateCount > 0 && (
              <span className="text-warn"> · {approximateCount} approximate</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter parts…"
            className="w-48 rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-[13px] outline-none placeholder:text-ink-faint focus:border-line-bright"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded-lg border border-line bg-surface-1 px-2.5 py-1.5 text-[13px] text-ink-dim outline-none focus:border-line-bright"
          >
            <option value="category">By category</option>
            <option value="price">By model price</option>
            <option value="offers">By cheapest offer</option>
            <option value="name">By name</option>
          </select>
          <button
            onClick={() => exportBomCsv(spec)}
            className="rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-[13px] text-ink-dim transition hover:border-line-bright hover:text-ink"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="card mt-4 overflow-hidden">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-surface-2/60">
              <Th>Part</Th>
              <Th>Category</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Est.</Th>
              <Th className="text-right">Best offer</Th>
              <Th className="w-20">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-ink-faint">
                  No parts match “{query}”.
                </td>
              </tr>
            )}
            {rows.map((c, i) => {
              const prev = rows[i - 1]
              const newGroup = sort === 'category' && prev && prev.category !== c.category
              const result = offers[c.id]
              const partOffers = result?.offers ?? []
              const best = partOffers[0]
              const isExpanded = !!expanded[c.id]

              return (
                <Fragment key={c.id}>
                  {newGroup && (
                    <tr className="bg-surface-2/40">
                      <td
                        colSpan={6}
                        className="px-4 py-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-faint"
                      >
                        {c.category}
                      </td>
                    </tr>
                  )}

                  <tr
                    onClick={() => setSelectedId(c.id)}
                    className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-surface-2/40"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <PartThumb component={c} size={44} />
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium leading-tight">{c.partName ?? c.name}</div>
                          {c.partName && c.partName !== c.name && (
                            <div className="text-[11px] text-ink-faint">{c.name}</div>
                          )}
                          {c.notes && <div className="mt-0.5 text-[11px] text-ink-faint">{c.notes}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-dim">
                        {c.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[13px]">{c.quantity}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[13px] text-ink-dim">
                      {c.unitPrice === undefined ? (
                        <span className="text-ink-faint">—</span>
                      ) : (
                        currency(c.unitPrice)
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {loading[c.id] ? (
                        <span className="inline-block size-3 animate-spin-slow rounded-full border-2 border-line border-t-accent" />
                      ) : best ? (
                        <BestPrice offer={best} />
                      ) : (
                        <span className="text-[13px] text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        {onSelectComponent && (
                          <button
                            onClick={() => onSelectComponent(c)}
                            title="Inspect component"
                            className="rounded p-1.5 text-ink-faint transition hover:bg-surface-3 hover:text-accent"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <rect x="2" y="2" width="20" height="20" rx="2" />
                              <path d="M16 16l3 3" />
                            </svg>
                          </button>
                        )}
                        {(partOffers.length > 0 || loading[c.id]) && (
                          <button
                            onClick={() => toggle(c.id)}
                            title={isExpanded ? 'Hide offers' : 'Compare prices'}
                            className={`rounded p-1.5 transition hover:bg-surface-3 ${
                              isExpanded ? 'text-accent' : 'text-ink-faint hover:text-accent'
                            }`}
                          >
                            <ChevronIcon expanded={isExpanded} />
                          </button>
                        )}
                        <a
                          href={searchUrl(c.partName ?? c.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Search for this part"
                          className="rounded p-1.5 text-ink-faint transition hover:bg-surface-3 hover:text-accent"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                            <circle cx="11" cy="11" r="7" />
                            <path d="M16.2 16.2 21 21" />
                          </svg>
                        </a>
                        {c.url && (
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open the model's link (may be out of date)"
                            className="rounded p-1.5 text-ink-faint transition hover:bg-surface-3 hover:text-accent"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                            </svg>
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr
                      className="border-b border-line/60 bg-surface-0/60"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <td colSpan={6} className="px-4 py-3">
                        <OffersTable
                          offers={partOffers}
                          quantity={c.quantity}
                          loading={!!loading[c.id]}
                          strict={result?.strict ?? true}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-line bg-surface-2/60">
                <td colSpan={3} className="px-4 py-2.5 text-[12px] text-ink-dim">
                  {rows.length} of {spec.components.length} items shown
                  {isPartial && <span className="ml-1 text-ink-faint">· some prices are missing</span>}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[13px] font-semibold">
                  {currency(shownCost)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[13px] font-semibold">
                  {bestTotal > 0 ? currency(bestTotal) : '—'}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        <span className="text-ink-dim">Est.</span> is the model's guess at the price and is often wrong.{' '}
        <span className="text-ink-dim">Best offer</span> comes from live retailer pages (Adafruit,
        AliExpress, eBay), cached for a day. Prices are scraped snapshots, so check the store
        before ordering. AliExpress and Amazon quote in MVR; the <span className="text-ink-dim">≈</span> figure
        beside one is converted at a pegged {MVR_PER_USD} rufiyaa to the dollar.
      </p>
    </div>
  )
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2 font-mono text-[10px] font-normal uppercase tracking-widest text-ink-faint ${className}`}
    >
      {children}
    </th>
  )
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 160ms ease' }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}