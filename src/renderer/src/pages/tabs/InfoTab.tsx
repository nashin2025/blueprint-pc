import { useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import { activeApiKey, activeModel } from '@shared/settings'
import { useApp } from '../../state/useApp'
import { DIFFICULTY_LABELS, DIFFICULTY_STYLES, currency } from '../../lib/format'
import { SparkIcon } from '../../components/Icons'

interface Props {
  project: Project
  onSave: (project: Project) => Promise<void>
}

type Job = 'image' | 'summary' | null

/**
 * Product page for a design: what it looks like, and what it is.
 *
 * Both halves are generated from the design itself, so neither needs new input
 * from the user. Each is stored on the spec so it survives a reload and is
 * captured by the version history rather than being recomputed on every visit.
 */
export default function InfoTab({ project, onSave }: Props) {
  const settings = useApp((s) => s.settings)
  const spec = project.spec

  const [job, setJob] = useState<Job>(null)
  const [error, setError] = useState<string | null>(null)
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)

  const imagesEnabled = settings.enableImages
  const apiKey = activeApiKey(settings)
  const textModel = activeModel(settings)

  // Images live on disk, so load the data URL whenever the spec points at a new one.
  useEffect(() => {
    let cancelled = false
    setImageDataUrl(null)
    if (!spec.imageFile) return

    void window.api.loadImage(spec.imageFile).then((res) => {
      if (cancelled) return
      if (res.ok && res.data) setImageDataUrl(res.data)
    })
    return () => {
      cancelled = true
    }
  }, [spec.imageFile])

  async function persist(patch: Partial<typeof spec>) {
    await onSave({ ...project, spec: { ...spec, ...patch } })
  }

  async function run(which: Exclude<Job, null>) {
    if (job) return
    setJob(which)
    setError(null)

    const request = {
      spec,
      provider: settings.provider,
      apiKey,
      model: which === 'image' ? settings.imageModel : textModel
    }

    try {
      if (which === 'image') {
        const res = await window.api.generateProductImage(request)
        if (!res.ok || !res.data) {
          setError(res.error ?? 'Image generation failed.')
          return
        }
        await persist({ imageFile: res.data })
      } else {
        const res = await window.api.summarizeInfo(request)
        if (!res.ok || !res.data) {
          setError(res.error ?? 'Description generation failed.')
          return
        }
        await persist({ infoSummary: res.data })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setJob(null)
    }
  }

  const totalUnits = spec.components.reduce((sum, c) => sum + c.quantity, 0)
  const cost = spec.components.reduce((sum, c) => sum + (c.unitPrice ?? 0) * c.quantity, 0)
  const pricedCount = spec.components.filter((c) => c.unitPrice).length

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Product info</h2>
          <p className="text-[13px] text-ink-dim">
            What it looks like, and what it is.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void run('image')}
            disabled={job !== null || !imagesEnabled || !apiKey}
            title={!imagesEnabled ? 'Enable image generation in Settings' : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-[13px] text-ink-dim transition hover:border-line-bright hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {job === 'image' ? (
              <span className="size-3.5 animate-spin-slow rounded-full border-2 border-line-bright border-t-accent" />
            ) : (
              <SparkIcon size={13} />
            )}
            {spec.imageFile ? 'New image' : 'Generate image'}
          </button>
          <button
            onClick={() => void run('summary')}
            disabled={job !== null || !apiKey}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-[13px] text-ink-dim transition hover:border-line-bright hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {job === 'summary' ? (
              <span className="size-3.5 animate-spin-slow rounded-full border-2 border-line-bright border-t-accent" />
            ) : (
              <SparkIcon size={13} />
            )}
            {spec.infoSummary ? 'Rewrite' : 'Write description'}
          </button>
        </div>
      </div>

      {!imagesEnabled && (
        <p className="mt-2 text-[11px] text-ink-faint">
          Image generation is turned off. Enable it in Settings to render the product.
        </p>
      )}

      {error && (
        <div className="animate-fade-up mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
          {error}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* Product render */}
        <section className="card overflow-hidden">
          <div className="relative aspect-square w-full bg-surface-0">
            {job === 'image' ? (
              <ImageSkeleton />
            ) : imageDataUrl ? (
              <img
                src={imageDataUrl}
                alt={`Rendered product view of ${spec.title}`}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-2 bg-blueprint-grid px-6 text-center">
                <div className="flex size-10 items-center justify-center rounded-lg border border-line bg-surface-1 text-ink-faint">
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <circle cx="8.5" cy="10" r="1.5" />
                    <path d="M21 16l-5-5-5 6-3-3-2 2" />
                  </svg>
                </div>
                <p className="max-w-[15rem] text-[12.5px] leading-relaxed text-ink-faint">
                  {imagesEnabled
                    ? 'No product image yet. Generate one to see what this build looks like.'
                    : 'Image generation is disabled in Settings.'}
                </p>
                {imagesEnabled && (
                  <button
                    onClick={() => void run('image')}
                    disabled={job !== null || !apiKey}
                    className="mt-1 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:brightness-110 disabled:opacity-40"
                  >
                    Generate image
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-line px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
              {spec.imageFile ? 'AI render' : 'No render'}
            </span>
            <span className="truncate font-mono text-[10px] text-ink-faint">{settings.imageModel}</span>
          </div>
        </section>

        {/* Description and facts */}
        <section className="flex flex-col gap-3">
          <div className="card p-5">
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
              About this build
            </h3>
            {job === 'summary' ? (
              <div className="mt-3 space-y-2">
                <div className="h-2.5 w-full animate-pulse rounded bg-surface-3" />
                <div className="h-2.5 w-11/12 animate-pulse rounded bg-surface-3" />
                <div className="h-2.5 w-10/12 animate-pulse rounded bg-surface-3" />
                <div className="h-2.5 w-8/12 animate-pulse rounded bg-surface-3" />
              </div>
            ) : spec.infoSummary ? (
              <p className="mt-2.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-dim">
                {spec.infoSummary}
              </p>
            ) : (
              <div className="mt-2.5">
                <p className="text-[13px] leading-relaxed text-ink-faint">
                  {spec.summary || 'No description was produced for this design.'}
                </p>
                {apiKey && (
                  <button
                    onClick={() => void run('summary')}
                    disabled={job !== null}
                    className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-bright hover:text-ink disabled:opacity-40"
                  >
                    Expand this into a full description
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="card p-5">
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
              At a glance
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
              <Fact label="Difficulty">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${DIFFICULTY_STYLES[spec.difficulty]}`}
                >
                  {DIFFICULTY_LABELS[spec.difficulty]}
                </span>
              </Fact>
              <Fact label="Build time">{spec.estimatedTime ?? '—'}</Fact>
              <Fact label="Parts">
                {spec.components.length}
                <span className="text-ink-faint"> ({totalUnits} units)</span>
              </Fact>
              <Fact label="Parts cost">
                {pricedCount > 0 ? currency(cost) : '—'}
                {pricedCount > 0 && pricedCount < spec.components.length && (
                  <span className="text-ink-faint"> partial</span>
                )}
              </Fact>
              <Fact label="Connections">{spec.connections.length}</Fact>
              <Fact label="Assembly steps">{spec.steps.length}</Fact>
            </dl>
          </div>
        </section>
      </div>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  )
}

function ImageSkeleton() {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 bg-surface-0">
      <div className="size-10 animate-spin-slow rounded-full border-2 border-line border-t-accent" />
      <p className="max-w-[15rem] text-center text-[12px] leading-relaxed text-ink-faint">
        Rendering the product image. Diffusion models take a little while.
      </p>
    </div>
  )
}