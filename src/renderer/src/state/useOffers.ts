import { useEffect, useRef, useState } from 'react'
import type { Component, OfferResult } from '@shared/types'

/**
 * Loads retailer offers for a set of components.
 *
 * Each part triggers two store scrapes, so ten parts is twenty requests. Those
 * are throttled to two at a time and cached by the main process for a day, which
 * makes the first load a slow reveal and every later load instant.
 *
 * Failures are silent by design: a store that blocks us or changes its markup
 * must leave an empty offer list, not a broken parts table.
 */

const MAX_CONCURRENT = 2
/** Give up waiting on all stores after this long, even if individual
 *  requests haven't timed out yet. Keeps the loading icon from spinning
 *  forever when a slow browser-based store (eBay / Amazon) hangs. */
const GLOBAL_MAX_WAIT_MS = 60_000

export type OffersByPart = Record<string, OfferResult>

export function useOffers(components: Component[]) {
  const [offers, setOffers] = useState<OffersByPart>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const started = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false

    const pending = components.filter(
      (c) => !started.current.has(c.id) && (c.partName || c.name || '').trim().length >= 3
    )
    if (pending.length === 0) return

    // Safety net: if every store request hasn't finished by this deadline,
    // force the loading icon off for every part still waiting. Better to show
    // stale/missing prices than a spinner that never stops.
    const globalTimer = setTimeout(() => {
      if (!cancelled) {
        setLoading((prev) => {
          const next = { ...prev }
          let changed = false
          for (const id of Object.keys(next)) {
            if (next[id]) {
              next[id] = false
              changed = true
            }
          }
          return changed ? next : prev
        })
      }
    }, GLOBAL_MAX_WAIT_MS)

    for (const c of pending) started.current.add(c.id)
    setLoading((prev) => {
      const next = { ...prev }
      for (const c of pending) next[c.id] = true
      return next
    })

    let cursor = 0
    let active = 0

    const pump = () => {
      if (cancelled) return
      while (active < MAX_CONCURRENT && cursor < pending.length) {
        const component = pending[cursor++]
        active++

        void window.api
          .getOffers(component.partName || component.name)
          .then((res) => {
            if (cancelled) return
            const data = res.data
            if (res.ok && data) {
              setOffers((prev) => ({ ...prev, [component.id]: data }))
            }
          })
          .catch(() => {
            // Leave this part with no offers; the row shows a dash.
          })
          .finally(() => {
            active--
            if (!cancelled) {
              setLoading((prev) => ({ ...prev, [component.id]: false }))
              pump()
            }
          })
      }
    }

    pump()

    return () => {
      cancelled = true
      clearTimeout(globalTimer)
    }
  }, [components])

  return { offers, loading }
}