import { useState, useRef, useEffect } from 'react'
import type { DesignSpec, GenerateRequest, Project } from '@shared/types'
import { useApp, newId } from '../../state/useApp'
import { summariseSpec } from '@shared/summarise'
import { activeApiKey, activeModel } from '@shared/settings'
import { SparkIcon } from '../../components/Icons'

interface Props {
  project: Project
  onSave: (project: Project) => Promise<void>
  onBack: () => void
}

export default function ChatTab({ project, onSave }: Props) {
  const settings = useApp((s) => s.settings)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [project.chat.length, busy])

  async function send() {
    const text = draft.trim()
    if (!text || busy) return

    setBusy(true)
    setError(null)
    setDraft('')

    const userMessage = {
      id: newId('msg'),
      role: 'user' as const,
      content: text,
      createdAt: Date.now()
    }

    // Show the message immediately; the model call can take a while.
    const optimistic: Project = { ...project, chat: [...project.chat, userMessage] }

    const request: GenerateRequest = {
      prompt: text,
      provider: settings.provider,
      apiKey: activeApiKey(settings),
      model: activeModel(settings),
      currentSpec: project.spec
    }

    try {
      const result = await window.api.generate(request)
      if (!result.ok || !result.data) {
        setError(result.error ?? 'Refinement failed.')
        await onSave(optimistic)
        return
      }

      const nextSpec = result.data as DesignSpec
      const assistantSummary = summariseSpec(nextSpec)

      const updated: Project = {
        ...optimistic,
        updatedAt: Date.now(),
        spec: nextSpec,
        chat: [
          ...optimistic.chat,
          {
            id: newId('msg'),
            role: 'assistant',
            content: assistantSummary,
            createdAt: Date.now()
          }
        ],
        versions: [
          ...project.versions,
          {
            id: newId('ver'),
            label: truncate(text, 60),
            createdAt: Date.now(),
            prompt: text,
            spec: nextSpec
          }
        ]
      }

      await onSave(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refinement failed.')
      await onSave(optimistic)
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void send()
    }
  }

  const suggestions = buildSuggestions(project.spec)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Refine this design</h2>
            <span className="font-mono text-[11px] text-ink-faint">
              {project.versions.length} {project.versions.length === 1 ? 'version' : 'versions'}
            </span>
          </div>
          <p className="mt-0.5 text-[13px] text-ink-dim">
            Tell it what to change. Each accepted change becomes a version you can compare against.
          </p>

          <div className="mt-5 space-y-4">
            <Message
              role="assistant"
              content={`Current design: ${project.spec.title}\n\n${project.spec.summary || ''}`}
            />

            {project.chat.map((m) => (
              <Message key={m.id} role={m.role} content={m.content} />
            ))}

            {busy && <Thinking />}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-surface-0 px-6 py-3">
        <div className="mx-auto w-full max-w-3xl">
          {error && (
            <div className="mb-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
              {error}
            </div>
          )}

          {!busy && suggestions.length > 0 && project.chat.length === 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setDraft(s)
                    inputRef.current?.focus()
                  }}
                  className="rounded-full border border-line bg-surface-1 px-2.5 py-1 text-[11.5px] text-ink-faint transition hover:border-line-bright hover:text-ink-dim"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="card overflow-hidden focus-within:border-line-bright">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy}
              rows={2}
              placeholder="Swap the Arduino for an ESP32, or add a battery level indicator…"
              className="w-full resize-none bg-transparent px-3.5 py-2.5 text-[14px] leading-relaxed outline-none placeholder:text-ink-faint/70 disabled:opacity-60"
            />
            <div className="flex items-center justify-between border-t border-line bg-surface-2/60 px-3 py-2">
              <span className="font-mono text-[10.5px] text-ink-faint">⌘/Ctrl + Enter</span>
              <button
                onClick={() => void send()}
                disabled={!draft.trim() || busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:brightness-110 disabled:opacity-40 active:scale-[0.98]"
              >
                {busy ? (
                  <>
                    <span className="size-3 animate-spin-slow rounded-full border-2 border-white/30 border-t-white" />
                    Applying
                  </>
                ) : (
                  <>
                    <SparkIcon size={13} />
                    Apply change
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Message({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const isUser = role === 'user'
  return (
    <div className={`animate-fade-up flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-accent/15 text-ink'
            : 'border border-line bg-surface-1 text-ink-dim'
        }`}
      >
        {content}
      </div>
    </div>
  )
}

function Thinking() {
  return (
    <div className="animate-fade-up flex justify-start">
      <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface-1 px-3.5 py-2.5 text-[13px] text-ink-faint">
        <span className="size-3.5 animate-spin-slow rounded-full border-2 border-line-bright border-t-accent" />
        Rebuilding the design…
      </div>
    </div>
  )
}

function buildSuggestions(spec: DesignSpec): string[] {
  const out: string[] = []
  const hasBattery = spec.components.some((c) => /batt|li-?po|li-?ion|18650|power bank/i.test(`${c.name} ${c.partName ?? ''}`))
  const hasFirmware = spec.steps.some((s) => /code|program|firmware|sketch|upload/i.test(`${s.title} ${s.body}`))
  if (!hasFirmware) out.push('Write the firmware for this')
  if (!hasBattery) out.push('Make it battery powered')
  out.push('Add a power switch')
  out.push('Give me a cheaper alternative parts list')
  return out.slice(0, 3)
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}