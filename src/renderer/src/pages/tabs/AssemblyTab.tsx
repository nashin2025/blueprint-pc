import { useState } from 'react'
import type { DesignSpec } from '@shared/types'

interface Props {
  spec: DesignSpec
}

export default function AssemblyTab({ spec }: Props) {
  const [done, setDone] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setDone((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const completed = spec.steps.filter((s) => done.has(s.id)).length

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Assembly guide</h2>
          <p className="text-[13px] text-ink-dim">
            {spec.steps.length} steps
            {spec.estimatedTime && <> · roughly {spec.estimatedTime}</>}
          </p>
        </div>
        {spec.steps.length > 0 && (
          <div className="text-right">
            <div className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">progress</div>
            <div className="text-sm font-medium">
              {completed}
              <span className="text-ink-faint">/{spec.steps.length}</span>
            </div>
          </div>
        )}
      </div>

      {completed > 0 && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-ok transition-all duration-300"
            style={{ width: `${(completed / spec.steps.length) * 100}%` }}
          />
        </div>
      )}

      {spec.steps.length === 0 ? (
        <p className="mt-8 text-[13px] text-ink-faint">
          No assembly steps were produced. Ask for them in the Refine tab.
        </p>
      ) : (
        <ol className="mt-6 space-y-3">
          {spec.steps.map((step) => {
            const isDone = done.has(step.id)
            return (
              <li
                key={step.id}
                className={`card animate-fade-up overflow-hidden transition ${
                  isDone ? 'border-ok/25 opacity-60' : ''
                }`}
              >
                <div className="flex gap-3.5 p-4">
                  <button
                    onClick={() => toggle(step.id)}
                    className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border font-mono text-[11px] transition ${
                      isDone
                        ? 'border-ok/40 bg-ok/15 text-ok'
                        : 'border-line bg-surface-2 text-ink-dim hover:border-line-bright'
                    }`}
                    title={isDone ? 'Mark as not done' : 'Mark as done'}
                  >
                    {isDone ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                        <path d="M4 12.5 9.5 18 20 6.5" />
                      </svg>
                    ) : (
                      step.order
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <h3
                      className={`text-[14px] font-medium leading-snug ${
                        isDone ? 'text-ink-dim line-through' : ''
                      }`}
                    >
                      {step.title}
                    </h3>
                    {step.body && (
                      <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">{step.body}</p>
                    )}

                    {step.componentIds.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {step.componentIds.map((id) => {
                          const c = spec.components.find((x) => x.id === id)
                          if (!c) return null
                          return (
                            <span
                              key={id}
                              className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-dim"
                            >
                              {c.name}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}