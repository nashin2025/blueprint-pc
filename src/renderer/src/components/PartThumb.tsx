import { useEffect, useMemo, useRef, useState } from 'react'
import type { Component } from '@shared/types'
import { partArt } from '../lib/partArt'

/**
 * A part thumbnail: a real product photo when one can be found, and a local
 * category glyph otherwise.
 *
 * The glyph is the starting state rather than a loading spinner, because photo
 * lookup is network-bound and rate-limited. A parts list full of spinners is
 * worse than one full of recognisable category icons that fill in as photos
 * arrive.
 */

// Lookups are network-bound and frequently slow. Three at a time keeps a
// ten-row table from opening ten connections at once and stalling the UI.
const MAX_CONCURRENT = 3
let inFlight = 0
const waiting: Array<() => void> = []

function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => waiting.push(resolve))
}

function release(): void {
  inFlight--
  const next = waiting.shift()
  if (next) {
    inFlight++
    next()
  }
}

interface Props {
  component: Component
  /** Set false to skip the lookup entirely. */
  auto?: boolean
  size?: number
}

export default function PartThumb({ component, auto = true, size = 40 }: Props) {
  const art = useMemo(() => partArt(component.category), [component.category])
  const [photo, setPhoto] = useState<string | null>(null)
  const [broken, setBroken] = useState(false)
  const attempted = useRef(false)

  // Searching needs only a name, so every part is eligible. The glyph covers
  // the ones the lookup cannot find.
  const searchName = (component.partName || component.name || '').trim()
  const canSearch = searchName.length >= 2

  useEffect(() => {
    if (!auto || attempted.current || !canSearch) return
    attempted.current = true

    let cancelled = false

    void (async () => {
      await acquire()
      if (cancelled) {
        release()
        return
      }
      try {
        const resolved = await window.api.resolvePartImage({
          imageUrl: component.image,
          productUrl: component.url,
          // Searching the real part name beats the short display name the model
          // invented for the table.
          query: searchName
        })
        if (cancelled || !resolved.ok || !resolved.data) return
        const data = await window.api.loadImage(resolved.data)
        if (!cancelled && data?.ok && data.data) setPhoto(data.data)
      } catch {
        // A missing photo is a normal outcome. The glyph stays.
      } finally {
        release()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [auto, canSearch, searchName, component.image, component.url])

  const src = photo && !broken ? photo : art

  return (
    <div
      className="shrink-0 overflow-hidden rounded-md border border-line bg-surface-2"
      style={{ width: size, height: size }}
    >
      <img
        src={src}
        alt={photo && !broken ? searchName : ''}
        onError={() => setBroken(true)}
        loading="lazy"
        className="size-full object-cover"
        style={{ width: size, height: size }}
      />
    </div>
  )
}