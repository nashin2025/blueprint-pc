import type { StoreOffer } from '@shared/types'
import { approxUsd, formatNative, toUsd } from '@shared/money'

/**
 * Retailer price comparison for one part.
 *
 * Shared by the parts list and the part detail view so both quote prices the same
 * way: in the store's own currency, with a converted dollar figure marked "≈"
 * when the store does not trade in dollars.
 */
export function OffersTable({
  offers,
  quantity,
  loading,
  strict
}: {
  offers: StoreOffer[]
  quantity: number
  loading: boolean
  strict: boolean
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-ink-faint">
        <span className="inline-block size-3 animate-spin-slow rounded-full border-2 border-line border-t-accent" />
        Checking Adafruit, AliExpress, Amazon and eBay…
      </div>
    )
  }

  if (offers.length === 0) {
    return (
      <p className="text-[12px] text-ink-faint">
        No offers found at Adafruit, AliExpress, Amazon or eBay for this part. The stores may not
        stock it, or the search term needs adjusting.
      </p>
    )
  }

  // "Cheapest" is a dollar comparison; the stores do not share a currency.
  const cheapestUsd = toUsd(offers[0].price, offers[0].currency) ?? 0

  const caveat = strict ? null : (
    <p className="mb-2 text-[11px] leading-relaxed text-warn">
      No exact match found. These are the closest listings the stores returned, so check the listing
      title before ordering.
    </p>
  )

  return (
    <div>
      {caveat}
      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full border-collapse text-left text-[12px]">
          <thead>
            <tr className="bg-surface-2/70">
              <th className="px-3 py-1.5 font-mono text-[9.5px] font-normal uppercase tracking-widest text-ink-faint">
                Store
              </th>
              <th className="px-3 py-1.5 font-mono text-[9.5px] font-normal uppercase tracking-widest text-ink-faint">
                Listing
              </th>
              <th className="px-3 py-1.5 text-right font-mono text-[9.5px] font-normal uppercase tracking-widest text-ink-faint">
                Each
              </th>
              <th className="px-3 py-1.5 text-right font-mono text-[9.5px] font-normal uppercase tracking-widest text-ink-faint">
                For {quantity}
              </th>
            </tr>
          </thead>
          <tbody>
            {offers.slice(0, 12).map((o, idx) => (
              <tr key={`${o.store}-${o.url}`} className="border-t border-line/50">
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-1.5 text-ink-dim">
                    {o.store}
                    {idx === 0 && (
                      <span className="rounded border border-ok/30 bg-ok/10 px-1 py-px text-[9px] uppercase tracking-wider text-ok">
                        cheapest
                      </span>
                    )}
                    {!o.inStock && (
                      <span className="rounded border border-warn/30 bg-warn/10 px-1 py-px text-[9px] uppercase tracking-wider text-warn">
                        out of stock
                      </span>
                    )}
                  </span>
                </td>
                <td className="max-w-[340px] truncate px-3 py-1.5 text-ink-faint">{o.name}</td>
                <td
                  className={`px-3 py-1.5 text-right font-mono ${
                    (toUsd(o.price, o.currency) ?? 0) === cheapestUsd ? 'text-ok' : 'text-ink-dim'
                  }`}
                >
                  {formatNative(o.price, o.currency)}
                  {approxUsd(o.price, o.currency) && (
                    <span className="ml-1 text-[10px] text-ink-faint">
                      {approxUsd(o.price, o.currency)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-ink-dim">
                  {formatNative(o.price * quantity, o.currency)}
                  {approxUsd(o.price * quantity, o.currency) && (
                    <span className="ml-1 text-[10px] text-ink-faint">
                      {approxUsd(o.price * quantity, o.currency)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line bg-surface-2/40 px-3 py-1.5">
        <a
          href={offers[0].url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-accent hover:underline"
        >
          Open the cheapest listing at {offers[0].store}
        </a>
      </div>
    </div>
  )
}

/** The cheapest offer for a part, in the store's own currency. */
function NativePrice({ offer }: { offer: StoreOffer }) {
  const approx = approxUsd(offer.price, offer.currency)
  return (
    <div className="leading-tight">
      <div className="font-mono text-[13px] font-medium">
        {formatNative(offer.price, offer.currency)}
      </div>
      <div className="text-[10.5px] text-ink-faint">{approx ? `${offer.store} · ${approx}` : offer.store}</div>
    </div>
  )
}

/** One-line summary of the best price, for tables that have no room for the full table. */
export function BestPrice({ offer }: { offer: StoreOffer }) {
  return <NativePrice offer={offer} />
}