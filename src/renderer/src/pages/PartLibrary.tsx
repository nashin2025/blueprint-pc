import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CataloguePart, CatalogueSummary, SyncProgress } from '@shared/types'
import { ChipIcon, SparkIcon } from '../components/Icons'
import PinoutView from '../components/PinoutView'
import { relativeTime } from '../lib/format'

/**
 * The local part library.
 *
 * A searchable mirror of a public catalogue, kept on this machine. Two things
 * live here: a search over what has been imported, and a sync that pulls more
 * parts down in small, resumable batches. The sync is deliberately slow and
 * bounded - the source is someone else's free service, and "no hurry" is a
 * design constraint rather than an apology.
 */

interface Status {
  progress: SyncProgress
  lastSyncAt: number | null
  count: number
}

// How many parts one "import more" click pulls. Kept modest so a single run is
// short and the source is never hit hard.
const SYNC_BATCH = 40

// The parts tray holds at most 5 parts for comparison, mirroring schematik.io's
// parts tray. Selected parts can be viewed side-by-side or cleared.
const TRAY_LIMIT = 5

const RECENTLY_VIEWED_KEY = 'blueprint-pc:recentlyViewed'

function loadRecentlyViewed(): CataloguePart[] {
  try {
    const raw = localStorage.getItem(RECENTLY_VIEWED_KEY)
    if (!raw) return []
    return JSON.parse(raw) as CataloguePart[]
  } catch {
    return []
  }
}

function saveRecentlyViewed(parts: CataloguePart[]): void {
  try {
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(parts.slice(0, TRAY_LIMIT)))
  } catch {
    // LocalStorage may be unavailable in private/incognito modes; degrade silently.
  }
}

export default function PartLibrary({ onBack }: { onBack: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogueSummary[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [detail, setDetail] = useState<CataloguePart | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [tray, setTray] = useState<string[]>([])
  const [compareMode, setCompareMode] = useState(false)
  const [recentlyViewed, setRecentlyViewed] = useState<CataloguePart[]>([])

  const refreshStatus = useCallback(async () => {
    const res = await window.api.catalogue.status()
    if (res.ok && res.data) setStatus(res.data)
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  // Load recently viewed from localStorage on mount.
  useEffect(() => {
    setRecentlyViewed(loadRecentlyViewed())
  }, [])

  // Persist recently viewed whenever the detail part changes.
  useEffect(() => {
    if (!detail) return
    saveRecentlyViewed([detail, ...recentlyViewed.filter((p) => p.slug !== detail.slug)])
    setRecentlyViewed((prev) => [detail, ...prev.filter((p) => p.slug !== detail.slug)].slice(0, TRAY_LIMIT))
  }, [detail, recentlyViewed])

  // Debounced search. The catalogue is local, so this is cheap, but a 250ms
  // debounce keeps a fast typist from firing a query per keystroke.
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
      const res = await window.api.catalogue.search(q, 30)
      if (cancelled) return
      if (res.ok && res.data) setResults(res.data)
      setSearching(false)
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query])

  // Load a part's full record when the selection changes.
  useEffect(() => {
    if (!selectedSlug) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    void window.api.catalogue.get(selectedSlug).then((res) => {
      if (cancelled) return
      if (res.ok) setDetail(res.data ?? null)
      setDetailLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [selectedSlug])

  async function runSync() {
    if (syncing) return
    setSyncing(true)
    setSyncNote(null)
    const res = await window.api.catalogue.sync(SYNC_BATCH)
    setSyncing(false)
    if (res.ok && res.data) {
      setSyncNote(res.data.message)
      await refreshStatus()
      if (query.trim()) {
        const r = await window.api.catalogue.search(query.trim(), 30)
        if (r.ok && r.data) setResults(r.data)
      }
    } else {
      setSyncNote(res.error ?? 'sync failed')
    }
  }

  function addToTray(slug: string) {
    if (tray.includes(slug)) return
    setTray((prev) => [...prev, slug].slice(-TRAY_LIMIT))
    setCompareMode(false)
  }

  function removeFromTray(slug: string) {
    setTray((prev) => prev.filter((s) => s !== slug))
    if (tray.length === 1) setCompareMode(false)
  }

  function clearTray() {
    setTray([])
    setCompareMode(false)
  }

  function toggleCompare() {
    if (tray.length < 2) return
    setCompareMode((prev) => !prev)
  }

  const count = status?.count ?? 0

  // Distinct categories among current results, for filter chips.
  const categories = useMemo(
    () => [...new Set(results.map((r) => r.category).filter(Boolean))] as string[],
    [results]
  )

  const filteredResults = categoryFilter
    ? results.filter((r) => r.category === categoryFilter)
    : results

  const trayParts = recentlyViewed.filter((p) => tray.includes(p.slug))

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-0">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-line px-6 py-3.5">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-dim transition hover:text-ink"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Back
        </button>
        <div className="flex items-center gap-2">
          <ChipIcon size={15} className="text-accent" />
          <h1 className="text-[15px] font-semibold tracking-tight">Part library</h1>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-[11px] text-ink-faint">
            {count > 0 ? `${count} parts` : 'empty'}
            {status?.lastSyncAt ? ` · synced ${relativeTime(status.lastSyncAt)}` : ''}
          </span>
          <button
            onClick={() => void runSync()}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
          >
            {syncing ? (
              <>
                <span className="size-3.5 animate-spin-slow rounded-full border-2 border-white/30 border-t-white" />
                Importing…
              </>
            ) : (
              <>
                <SparkIcon size={14} />
                Import more
              </>
            )}
          </button>
        </div>
      </div>

      {syncNote && (
        <div className="border-b border-line bg-surface-1 px-6 py-2 text-[12px] text-ink-dim">
          {syncNote}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Left: search + filters + results */}
        <div className="flex w-[380px] shrink-0 flex-col border-r border-line">
          <div className="border-b border-line p-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search parts by name, brand or number…"
              className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-[13.5px] text-ink outline-none transition placeholder:text-ink-faint/70 focus:border-line-bright"
            />
          </div>

          <div className="border-b border-line p-2 overflow-x-auto whitespace-nowrap">
            <button
              onClick={() => setCategoryFilter(null)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition ${
                !categoryFilter ? 'bg-surface-2 text-ink' : 'text-ink-dim hover:bg-surface-1'
              }`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat === categoryFilter ? null : cat)}
                className={`ml-1 px-2 py-1 rounded-md text-xs font-medium transition ${
                  categoryFilter === cat ? 'bg-surface-2 text-ink' : 'text-ink-dim hover:bg-surface-1'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {query.trim() === '' ? (
              <EmptyHint count={count} onSearch={() => setQuery('oled')} onSelectPart={setSelectedSlug} recentlyViewed={recentlyViewed} />
            ) : searching ? (
              <p className="px-2 py-6 text-center text-[12.5px] text-ink-faint">Searching…</p>
            ) : filteredResults.length === 0 ? (
              <p className="px-2 py-6 text-center text-[12.5px] leading-relaxed text-ink-faint">
                No parts match “{query.trim()}”.
                {count === 0 && ' Import some parts first.'}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {filteredResults.map((r) => (
                  <li key={r.slug}>
                    <button
                      onClick={() => {
                        setSelectedSlug(r.slug)
                        addToTray(r.slug)
                      }}
                      className={`flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition ${
                        selectedSlug === r.slug ? 'bg-surface-2' : 'hover:bg-surface-1'
                      }`}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{r.name}</span>
                        {r.priceText && (
                          <span className="shrink-0 font-mono text-[11px] text-ink-dim">
                            {r.priceText}
                          </span>
                        )}
                      </span>
                      <span className="truncate text-[11px] text-ink-faint">
                        {[r.brand, r.category, `${r.pinCount} pins`].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: detail / comparison */}
        <div className="min-w-0 flex-1 overflow-y-auto pb-10">
          {compareMode && trayParts.length > 0 ? (
            <ComparisonView parts={trayParts} onSelectPart={(slug) => {
              setSelectedSlug(slug)
              setCompareMode(false)
            }} />
          ) : detailLoading ? (
            <p className="px-6 py-10 text-center text-[13px] text-ink-faint">Loading part…</p>
          ) : detail ? (
            <PartDetailView part={detail} />
          ) : (
            <div className="flex h-full items-center justify-center px-8">
              <p className="max-w-sm text-center text-[13px] leading-relaxed text-ink-faint">
                {selectedSlug ? 'Could not load that part.' : 'Search for a part, then select it to see its description, pinout and price.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Parts tray */}
      {tray.length > 0 && (
        <div className="border-t border-line bg-surface-0 p-3 shadow-sm">
          <div className="flex items-center gap-2 px-4 py-2 text-[12px] text-ink-dim">
            <span className="font-mono text-xs">{tray.length} in tray</span>
            <div className="flex gap-1 overflow-x-auto">
              {trayParts.map((p) => (
                <button
                  key={p.slug}
                  onClick={() => {
                    setSelectedSlug(p.slug)
                    setCompareMode(false)
                  }}
                  title={p.name}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-1 border border-line text-[11px] text-ink transition hover:bg-surface-2"
                >
                  <span className="truncate max-w-[120px]">{p.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFromTray(p.slug)
                    }}
                    className="ml-1 p-0.5 rounded text-ink-faint hover:text-ink"
                  >
                    ×
                  </button>
                </button>
              ))}
            </div>
            <button
              onClick={toggleCompare}
              disabled={tray.length < 2}
              className="ml-auto px-2.5 py-1 rounded-md text-xs font-medium transition ${
                tray.length < 2
                  ? 'text-ink-faint/50 cursor-not-allowed'
                  : 'text-accent hover:text-accent/90 hover:bg-accent/10'
              }"
            >
              {compareMode ? 'Stop compare' : 'Compare'}
            </button>
            <button
              onClick={clearTray}
              className="ml-2 px-2.5 py-1 rounded-md text-xs font-medium text-ink-faint hover:text-ink transition hover:bg-surface-1"
            >
              Clear
            </button>
          </div>
          {compareMode && trayParts.length > 0 && (
            <div className="px-4 py-2 border-t border-line text-[11px] text-ink-faint">
              Comparing {trayParts.length} parts — click any part to view its full detail.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EmptyHint({ count, onSearch, onSelectPart, recentlyViewed }: { count: number; onSearch: () => void; onSelectPart: (slug: string) => void; recentlyViewed: CataloguePart[] }) {
  return (
    <div className="px-3 py-8 text-center">
      {recentlyViewed.length > 0 && (
        <div className="mb-6">
          <div className="font-mono text-[10px] uppercase tracking-widest text-ink-faint mb-2">
            Recently viewed
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {recentlyViewed.map((p) => (
              <button
                key={p.slug}
                onClick={() => onSelectPart(p.slug)}
                className="flex flex-col items-center gap-1 px-2 py-2 rounded-lg bg-surface-1 border border-line transition hover:bg-surface-2"
              >
                <span className="truncate text-[11px] text-ink">{p.name}</span>
                <span className="text-[9.5px] text-ink-faint">{p.priceText ?? ''}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-[12.5px] leading-relaxed text-ink-faint">
        {count === 0 ? (
          <>
            The library is empty. Click <span className="text-ink-dim">Import more</span> to pull a
            batch of parts from the public catalogue.
          </>
        ) : (
          <>
            {count} parts stored locally. Search to find one.
          </>
        )}
      </p>
      {count > 0 && (
        <button
          onClick={onSearch}
          className="mt-3 rounded-full border border-line bg-surface-1 px-3 py-1 text-[12px] text-ink-dim transition hover:border-line-bright hover:text-ink"
        >
          Try “oled”
        </button>
      )}
    </div>
  )
}

function PartDetailView({ part }: { part: CataloguePart }) {
  const [activeTab, setActiveTab] = useState<'overview' | 'pinout'>('overview')

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-6">
      <div className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
        {part.category ?? 'part'}
      </div>
      <h2 className="mt-1 text-xl font-semibold tracking-tight">{part.name}</h2>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-dim">
        {part.brand && <span>{part.brand}</span>}
        {part.partNumber && (
          <span className="font-mono text-[11.5px] text-ink-faint">{part.partNumber}</span>
        )}
      </div>

      {/* Tab bar */}
      <div className="mt-6 flex gap-1 border-b border-line/50">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex items-center gap-1 px-3 py-2 text-[12px] border-b-2 transition ${
            activeTab === 'overview' ? 'border-accent text-accent' : 'text-ink-faint hover:text-ink border-transparent hover:border-line/50'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('pinout')}
          className={`flex items-center gap-1 px-3 py-2 text-[12px] border-b-2 transition ${
            activeTab === 'pinout' ? 'border-accent text-accent' : 'text-ink-faint hover:text-ink border-transparent hover:border-line/50'
          }`}
        >
          Pinout <span className="font-mono text-[10px] text-ink-faint">({part.pinout.length})</span>
        </button>
      </div>

      {activeTab === 'overview' && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Fact label="Price" value={part.priceText ?? '—'} />
            <Fact
              label={part.priceCurrency ? `Price (${part.priceCurrency})` : 'Price'}
              value={
                part.priceValue !== null && part.priceCurrency
                  ? `${part.priceCurrency} ${part.priceValue.toFixed(2)}`
                  : (part.priceText ?? '—')
              }
            />
            <Fact label="Pins" value={String(part.pinout.length)} />
          </div>

          {part.description && (
            <section className="mt-6">
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                Description
              </h3>
              <p className="text-[13.5px] leading-relaxed text-ink-dim">{part.description}</p>
            </section>
          )}
        </>
      )}

      {activeTab === 'pinout' && part.pinout.length > 0 && (
        <section className="mt-4">
          <PinoutView pins={part.pinout} label={part.partNumber ?? part.name} />
        </section>
      )}

      {part.url && (
        <section className="mt-6">
          <a
            href={part.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-bright hover:text-ink"
          >
            View on source site
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1 1-1V7a1 1 0 0 1 1-1h5" />
            </svg>
          </a>
        </section>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-ink-faint">
        Part data mirrored from the public Schematik catalogue. Descriptions and prices are the
        source&apos;s own and may be incomplete or out of date.
      </p>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2">
      <div className="font-mono text-[9.5px] uppercase tracking-widest text-ink-faint">{label}</div>
      <div className="mt-0.5 text-[13px] text-ink">{value}</div>
    </div>
  )
}

function ComparisonView({
  parts,
  onSelectPart
}: {
  parts: CataloguePart[]
  onSelectPart: (slug: string) => void
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-6">
      <div className="font-mono text-[10px] uppercase tracking-widest text-ink-faint mb-2">
        Comparing {parts.length} parts
      </div>
      <div className="overflow-x-auto border border-line rounded-lg">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-line bg-surface-2/60">
              <th className="px-3 py-2.5 text-[10px] uppercase tracking-widest text-ink-faint w-40">
                Part
              </th>
              {parts.map((p) => (
                <th key={p.slug} className="px-3 py-2.5 text-[10px] uppercase tracking-widest text-ink-faint">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line/50">
              <td className="px-3 py-2 font-mono text-[11px] text-ink-dim">Brand</td>
              {parts.map((p) => (
                <td key={p.slug} className="px-3 py-2 text-[11.5px] text-ink">
                  {p.brand ?? '—'}
                </td>
              ))}
            </tr>
            <tr className="border-b border-line/50">
              <td className="px-3 py-2 font-mono text-[11px] text-ink-dim">Part number</td>
              {parts.map((p) => (
                <td key={p.slug} className="px-3 py-2 text-[11.5px] font-mono text-ink-dim">
                  {p.partNumber ?? '—'}
                </td>
              ))}
            </tr>
            <tr className="border-b border-line/50">
              <td className="px-3 py-2 font-mono text-[11px] text-ink-dim">Price</td>
              {parts.map((p) => (
                <td key={p.slug} className="px-3 py-2 text-[11.5px] font-mono text-ink">
                  {p.priceText ?? '—'}
                </td>
              ))}
            </tr>
            <tr className="border-b border-line/50">
              <td className="px-3 py-2 font-mono text-[11px] text-ink-dim">Pins</td>
              {parts.map((p) => (
                <td key={p.slug} className="px-3 py-2 text-[11.5px] font-mono text-ink">
                  {p.pinout.length}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {parts.map((p) => (
          <div
            key={p.slug}
            className="flex flex-col items-start gap-2 rounded-lg border border-line bg-surface-1 p-3"
          >
              <button
                onClick={() => onSelectPart(p.slug)}
                className="w-full text-left"
              >
              <h3 className="text-[13px] font-semibold text-ink truncate">{p.name}</h3>
            </button>
            <PinoutView pins={p.pinout} label={p.partNumber ?? p.name} />
          </div>
        ))}
      </div>
    </div>
  )
}