import { useEffect, useState } from 'react'
import type { CataloguePart, Component, Connection, DesignSpec, StoreOffer } from '@shared/types'
import { approxUsd, formatNative } from '@shared/money'
import PartThumb from '../../components/PartThumb'
import PinoutView from '../../components/PinoutView'
import { OffersTable } from '../../components/OffersTable'
import { cadSources, hasCadModel } from '../../lib/cadSources'

/**
 * Detail view for one component in the parts list.
 *
 * The parts list answers "what do I need and what does it cost". This answers the
 * follow-up questions that come next: what does it plug into, what does it cost
 * across shops, and where do I read more.
 *
 * Everything here comes from data the app already holds - the component record,
 * the connection graph, and the live offers cache - so opening a part costs no
 * extra requests.
 */

interface Props {
  component: Component
  spec: DesignSpec
  offers: StoreOffer[]
  /** Unix ms when the retailer offers were last fetched, for staleness UI. */
  fetchedAt: number
  loading: boolean
  strict: boolean
  onBack: () => void
}

/** Every wire that touches this component, with the other end resolved. */
function connectionsFor(spec: DesignSpec, componentId: string): Connection[] {
  return spec.connections.filter(
    (c) => c.from.componentId === componentId || c.to.componentId === componentId
  )
}

/** The pin on the far side of a wire, as a component id and pin name. */
function otherEnd(connection: Connection, componentId: string): { componentId: string; pin: string } {
  return connection.from.componentId === componentId
    ? { componentId: connection.to.componentId, pin: connection.to.pin }
    : { componentId: connection.from.componentId, pin: connection.from.pin }
}

export default function PartDetail({
  component,
  spec,
  offers,
  fetchedAt,
  loading,
  strict,
  onBack
}: Props) {
  const connections = connectionsFor(spec, component.id)
  const nameOf = (id: string) => spec.components.find((c) => c.id === id)

  const cheapest = offers[0]
  const lineTotal = cheapest
    ? formatNative(cheapest.price * component.quantity, cheapest.currency)
    : null
  const lineApprox = cheapest
    ? approxUsd(cheapest.price * component.quantity, cheapest.currency)
    : null

  // Pull the matching entry from the local part library, if one exists. The
  // library is optional (it is populated by an explicit import), so a miss here
  // is silent: the detail view simply omits the section.
  const [catalogueRefreshKey, setCatalogueRefreshKey] = useState(0)
  const [kitRefreshing, setKitRefreshing] = useState(false)
  const kit = useCatalogueMatch(component.partName ?? component.name, catalogueRefreshKey)

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-6">
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-ink-dim transition hover:text-ink"
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
        Back to parts list
      </button>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <PartThumb component={component} size={104} />

        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
            {component.category}
          </div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            {component.partName ?? component.name}
          </h2>
          {component.partName && component.partName !== component.name && (
            <p className="mt-0.5 text-[13px] text-ink-dim">{component.name}</p>
          )}
          {component.notes && (
            <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-ink-dim">
              {component.notes}
            </p>
          )}
        </div>

        <div className="shrink-0 rounded-lg border border-line bg-surface-1 px-4 py-3 text-right">
          <div className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
            Best price
          </div>
          {cheapest ? (
            <>
              <div className="mt-0.5 font-mono text-[15px]">
                {formatNative(cheapest.price, cheapest.currency)}
              </div>
              <div className="text-[11px] text-ink-faint">
                {cheapest.store}
                {approxUsd(cheapest.price, cheapest.currency)
                  ? ` · ${approxUsd(cheapest.price, cheapest.currency)}`
                  : ''}
                <PriceStaleness fetchedAt={fetchedAt} />
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-[13px] text-ink-faint">—</div>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Quantity" value={String(component.quantity)} />
        <Fact
          label="Est. unit"
          value={component.unitPrice === undefined ? '—' : `$${component.unitPrice.toFixed(2)}`}
        />
        <Fact label="Pins" value={String(component.pins.length)} />
        <Fact label="Connections" value={String(connections.length)} />
      </div>

      <Section title="Sourcing">
        <OffersTable offers={offers} quantity={component.quantity} loading={loading} strict={strict} />
        {lineTotal && (
          <p className="mt-2 text-[11px] text-ink-faint">
            Cheapest listing for {component.quantity}: {lineTotal}
            {lineApprox ? ` (${lineApprox})` : ''}
          </p>
        )}
      </Section>

      <Section title="Connections">
        {connections.length === 0 ? (
          <p className="text-[12.5px] text-ink-faint">This part is not wired to anything yet.</p>
        ) : (
          <ul className="divide-y divide-line/50 overflow-hidden rounded-lg border border-line">
            {connections.map((c) => {
              const mine = c.from.componentId === component.id ? c.from : c.to
              const other = otherEnd(c, component.id)
              const otherComponent = nameOf(other.componentId)
              return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12.5px]"
                >
                  <span className="font-mono text-[11.5px] text-ink-dim">{mine.pin}</span>
                  <span className="flex items-center gap-2 text-ink-faint">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                      {c.net ?? c.kind}
                    </span>
                    <span aria-hidden>→</span>
                    <span className="text-ink">
                      {otherComponent?.partName ?? otherComponent?.name ?? 'Unknown'}
                    </span>
                    <span className="font-mono text-[11.5px] text-ink-dim">{other.pin}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      {kit && (
        <Section title="From the part library">
          <div className="rounded-lg border border-line bg-surface-1 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13px] text-ink">{kit.name}</span>
              {kit.priceText && (
                <span className="font-mono text-[11.5px] text-ink-dim">{kit.priceText}</span>
              )}
            </div>
            {[kit.brand, kit.partNumber].filter(Boolean).length > 0 && (
              <div className="mt-0.5 text-[11.5px] text-ink-faint">
                {[kit.brand, kit.partNumber].filter(Boolean).join(' · ')}
              </div>
            )}
            {kit.description && (
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{kit.description}</p>
            )}
            {kit.pinout.length > 0 && (
              <div className="mt-3">
                <PinoutView pins={kit.pinout} label={kit.partNumber ?? kit.name} />
              </div>
            )}
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[10px] text-ink-faint">
                Library data {kit.fetchedAt ? `updated ${Math.round((Date.now() - kit.fetchedAt) / 86400000)} day${Math.round((Date.now() - kit.fetchedAt) / 86400000) === 1 ? '' : 's'} ago` : 'never'}
              </span>
              <button
                onClick={async () => {
                  setKitRefreshing(true)
                  const res = await window.api.catalogue.refreshPart(kit.slug)
                  setKitRefreshing(false)
                  if (res.ok && res.data) {
                    setCatalogueRefreshKey((k) => k + 1)
                  }
                }}
                className="rounded p-1.5 text-[10px] text-ink-dim transition hover:bg-surface-3 hover:text-accent"
                title="Refresh from Schematik"
                disabled={kitRefreshing}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M23 4v3a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V1a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v3" />
                  <path d="M1 20v-3a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3" />
                </svg>
              </button>
              {kitRefreshing && (
                <span className="inline-block size-3 animate-spin-slow rounded-full border-2 border-line border-t-accent" />
              )}
            </div>
            <p className="mt-3 text-[10.5px] text-ink-faint">
              Mirrored from the public Schematik catalogue; may be incomplete or out of date.
            </p>
          </div>
        </Section>
      )}

      <Section title="Reference">
        <div className="flex flex-wrap gap-2">
          {component.datasheet && (
            <a
              href={component.datasheet}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-bright hover:text-ink"
            >
              Datasheet
            </a>
          )}
          {component.url && (
            <a
              href={component.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-bright hover:text-ink"
            >
              Model&apos;s link
            </a>
          )}
          <a
            href={`https://www.google.com/search?q=${encodeURIComponent(
              `${component.partName ?? component.name} datasheet`
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-bright hover:text-ink"
          >
            Search the web
          </a>
        </div>
      </Section>

      {hasCadModel(component.category) && (
        <Section title="CAD / 3D files">
          <p className="mb-2 text-[11.5px] text-ink-faint">
            Opens each library&apos;s search for this part. A library may have nothing for it.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {cadSources(component.partName ?? component.name).map((source) => (
              <a
                key={source.name}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start justify-between gap-3 rounded-lg border border-line bg-surface-1 px-3 py-2 transition hover:border-line-bright"
              >
                <span className="min-w-0">
                  <span className="block text-[12.5px] text-ink">{source.name}</span>
                  <span className="block text-[11px] text-ink-faint">{source.note}</span>
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="mt-0.5 shrink-0 text-ink-faint transition group-hover:text-accent"
                >
                  <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                </svg>
              </a>
            ))}
          </div>
        </Section>
      )}
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint">{title}</h3>
      {children}
    </section>
  )
}

/** Small badge showing how old retailer price data is. */
function PriceStaleness({ fetchedAt }: { fetchedAt: number }) {
  const STALE_DAYS = 7
  const days = Math.round((Date.now() - fetchedAt) / 86400000)
  const stale = days > STALE_DAYS
  if (days <= 0 || !stale) return null
  return (
    <span
      className="ml-1 inline-block text-[9px] uppercase tracking-wider text-warn border border-warn/30 bg-warn/10 px-1.5 py-0.5 rounded"
    >
      stale ({days}d)
    </span>
  )
}

/**
 * The best catalogue match for a part name, or null.
 *
 * The library is a separate, opt-in mirror, so a miss is the common case and is
 * handled silently. When it does hold the part, we show its description and
 * pinout - richer than anything the model supplied.
 *
 * `refreshKey` forces a re-fetch when changed (used by the manual refresh button).
 */
function useCatalogueMatch(name: string, refreshKey?: number): CataloguePart | null {
  const [match, setMatch] = useState<CataloguePart | null>(null)

  useEffect(() => {
    let cancelled = false
    setMatch(null)
    void window.api.catalogue.search(name, 5).then((res) => {
      if (cancelled || !res.ok || !res.data || res.data.length === 0) return
      const top = res.data[0]
      void window.api.catalogue.get(top.slug).then((got) => {
        if (cancelled || !got.ok) return
        setMatch(got.data ?? null)
      })
    })
    return () => {
      cancelled = true
    }
  }, [name, refreshKey])

  return match
}