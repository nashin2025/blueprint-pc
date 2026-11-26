import { useState, useRef, useEffect } from 'react'
import { useApp, blankProject } from '../state/useApp'
import type { DesignSpec, GenerateRequest } from '@shared/types'
import { activeApiKey, activeModel, hasApiKey, PROVIDER_LABELS } from '@shared/settings'
import { SparkIcon } from '../components/Icons'

const EXAMPLES: Array<{ label: string; prompt: string }> = [
  {
    label: 'Plant monitor',
    prompt:
      'A desk plant monitor that measures soil moisture, air temperature and humidity, shows readings on a small OLED screen, and flashes a warning LED when the soil is dry.'
  },
  {
    label: 'Weather station',
    prompt:
      'An outdoor weather station that reports temperature, humidity, pressure and rain, powered by a small solar panel with a battery backup, and posts readings over Wi-Fi.'
  },
  {
    label: 'Robot arm gripper',
    prompt:
      'A servo-driven gripper for a small robot arm that opens and closes on command from an Arduino, with force feedback so it stops before crushing a soft object.'
  }
]

const THINKING_STEPS = [
  'Reading your request…',
  'Choosing parts…',
  'Working out the wiring…',
  'Writing the assembly steps…',
  'Checking electrical limits…'
]

export default function Home() {
  const settings = useApp((s) => s.settings)
  const upsertProject = useApp((s) => s.upsertProject)

  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thinkStep, setThinkStep] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!busy) {
      setThinkStep(0)
      return
    }
    const timer = setInterval(() => {
      setThinkStep((s) => (s + 1) % THINKING_STEPS.length)
    }, 3200)
    return () => clearInterval(timer)
  }, [busy])

  async function generate() {
    const trimmed = prompt.trim()
    if (!trimmed || busy) return

    if (!hasApiKey(settings)) {
      setError('No API key configured. Open Settings and add one.')
      return
    }

    setBusy(true)
    setError(null)

    const request: GenerateRequest = {
      prompt: trimmed,
      provider: settings.provider,
      apiKey: activeApiKey(settings),
      model: activeModel(settings)
    }

    try {
      const result = await window.api.generate(request)
      if (!result.ok || !result.data) {
        setError(result.error ?? 'Generation failed.')
        return
      }
      await upsertProject(blankProject(result.data as DesignSpec))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed.')
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void generate()
    }
  }

  const activeModelName = activeModel(settings)
  const canGenerate = !!prompt.trim() && !busy && hasApiKey(settings)

  return (
    <div className="flex-1 overflow-y-auto bg-surface-0">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center px-8 py-12">
        <div className="animate-fade-up">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint mb-6">
            <span className="size-1.5 rounded-full bg-accent" />
            {PROVIDER_LABELS[settings.provider]} · {activeModelName}
          </div>

          <h1 className="h1-premium mb-4">
            Describe the thing you want to build.
          </h1>
          <p className="text-body max-w-xl mb-8">
            You get a real parts list with prices, a wiring diagram with pin-accurate connections, and an
            assembly guide you can follow at the bench.
          </p>

          <div className="card mb-8 overflow-hidden">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onKeyDown}
              rows={6}
              placeholder="A battery-powered doorbell that sends a photo to my phone when someone presses it…"
              className="textarea-field disabled:opacity-60"
              disabled={busy}
            />
            <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-1 px-4 py-3">
              <span className="font-mono text-[11px] text-ink-faint">
                {busy ? THINKING_STEPS[thinkStep] : '⌘/Ctrl + Enter to generate'}
              </span>
              <button
                onClick={() => void generate()}
                disabled={!canGenerate}
                className={`btn-primary ${!canGenerate ? 'opacity-45 cursor-not-allowed' : ''}`}
              >
                {busy ? (
                  <>
                    <span className="size-3.5 animate-spin-slow rounded-full border-2 border-white/30 border-t-white" />
                    Generating
                  </>
                ) : (
                  <>
                    <SparkIcon size={15} />
                    Generate design
                  </>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="animate-fade-up mb-8 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="animate-fade-up">
            <div className="text-caption mb-2">Try one of these</div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  onClick={() => {
                    setPrompt(ex.prompt)
                    textareaRef.current?.focus()
                  }}
                  disabled={busy}
                  className="btn-ghost ${busy ? 'opacity-45 cursor-not-allowed' : ''}"
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
