import { useEffect, useState } from 'react'
import type { AIProviderId, AppSettings } from '@shared/types'
import { activeApiKey, activeModel, DEFAULT_IMAGE_MODELS } from '@shared/settings'

interface Props {
  settings: AppSettings
  onClose: () => void
  onSave: (settings: AppSettings) => Promise<void>
}

const PROVIDERS: Array<{ id: AIProviderId; title: string; subtitle: string; keyUrl: string }> = [
  {
    id: 'nvidia',
    title: 'NVIDIA NIM',
    subtitle: 'Open models, free tier',
    keyUrl: 'https://build.nvidia.com/'
  },
  {
    id: 'gemini',
    title: 'Google Gemini',
    subtitle: 'Free tier available',
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  {
    id: 'openai',
    title: 'OpenAI',
    subtitle: 'Requires billing',
    keyUrl: 'https://platform.openai.com/api-keys'
  }
]

const MODEL_HINTS: Record<AIProviderId, string> = {
  nvidia: 'Pick from the list once your key is entered, or type a catalog id.',
  gemini: 'Current models: gemini-3.8-flash, gemini-3.1-pro-preview',
  openai: 'Examples: gpt-4o-mini, gpt-4o'
}

export default function SettingsDialog({ settings, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [saving, setSaving] = useState(false)
  const [showKey, setShowKey] = useState(false)

  // NIM hosts hundreds of models across families, so the model is picked from
  // the live catalog rather than guessed. Loading is explicit to avoid firing a
  // request on every keystroke.
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)

  const provider = PROVIDERS.find((p) => p.id === draft.provider) ?? PROVIDERS[0]
  const isNvidia = draft.provider === 'nvidia'

  const apiKey = activeApiKey(draft)
  const model = activeModel(draft)

  function setProvider(id: AIProviderId) {
    setDraft((d) => {
      // Swap the image model along with the provider, but only if the user has
      // not customised it — a hand-picked model should survive a provider flip.
      const imageWasDefault = d.imageModel === DEFAULT_IMAGE_MODELS[d.provider]
      return {
        ...d,
        provider: id,
        imageModel: imageWasDefault ? DEFAULT_IMAGE_MODELS[id] : d.imageModel
      }
    })
    setModelError(null)
  }

  function setApiKey(value: string) {
    setDraft((d) => {
      if (d.provider === 'gemini') return { ...d, geminiApiKey: value }
      if (d.provider === 'nvidia') return { ...d, nvidiaApiKey: value }
      return { ...d, openaiApiKey: value }
    })
  }

  function setModel(value: string) {
    setDraft((d) => {
      if (d.provider === 'gemini') return { ...d, geminiModel: value }
      if (d.provider === 'nvidia') return { ...d, nvidiaModel: value }
      return { ...d, openaiModel: value }
    })
  }

  // Drop the cached list if the key changes, so a stale catalog is never offered.
  useEffect(() => {
    setModels([])
  }, [draft.nvidiaApiKey])

  async function loadModels() {
    setLoadingModels(true)
    setModelError(null)
    try {
      const result = await window.api.listNvidiaModels(draft.nvidiaApiKey)
      if (result.ok && result.data) {
        setModels(result.data)
        // If the saved model is not in the catalog, surface it rather than
        // silently keeping a value that will 404 on the next generation.
        if (result.data.length > 0 && !result.data.includes(draft.nvidiaModel)) {
          setModelError(`"${draft.nvidiaModel}" is not in your catalog. Pick one below.`)
        }
      } else {
        setModelError(result.error ?? 'Could not load models.')
      }
    } catch (err) {
      setModelError(err instanceof Error ? err.message : 'Could not load models.')
    } finally {
      setLoadingModels(false)
    }
  }

  async function save() {
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="animate-fade-up relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface-1 shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold tracking-tight">Settings</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-faint transition hover:bg-surface-3 hover:text-ink"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Provider</label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {PROVIDERS.map((p) => (
                <ProviderCard
                  key={p.id}
                  active={draft.provider === p.id}
                  title={p.title}
                  subtitle={p.subtitle}
                  onClick={() => setProvider(p.id)}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                API key
              </label>
              <a href={provider.keyUrl} className="text-[11px] text-accent hover:underline">
                Get a {provider.title} key
              </a>
            </div>
            <div className="mt-2 flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={isNvidia ? 'nvapi-…' : draft.provider === 'gemini' ? 'AIza…' : 'sk-…'}
                spellCheck={false}
                autoComplete="off"
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface-0 px-3 py-2 font-mono text-[12.5px] outline-none placeholder:text-ink-faint/60 focus:border-line-bright"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="rounded-lg border border-line bg-surface-2 px-2.5 text-[11px] text-ink-faint transition hover:text-ink-dim"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
              Stored in plain text at <span className="font-mono">userData/data/settings.json</span> on this
              machine. Never sent anywhere except {provider.title}.
            </p>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Model</label>
              {isNvidia && (
                <button
                  onClick={() => void loadModels()}
                  disabled={loadingModels || !draft.nvidiaApiKey.trim()}
                  className="text-[11px] text-accent transition hover:underline disabled:opacity-40"
                >
                  {loadingModels ? 'Loading…' : models.length > 0 ? 'Refresh list' : 'Load model list'}
                </button>
              )}
            </div>

            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list={isNvidia && models.length > 0 ? 'nim-models' : undefined}
              spellCheck={false}
              className="mt-2 w-full rounded-lg border border-line bg-surface-0 px-3 py-2 font-mono text-[12.5px] outline-none focus:border-line-bright"
            />

            {isNvidia && models.length > 0 && (
              <datalist id="nim-models">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            )}

            {modelError && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-danger">{modelError}</p>
            )}

            <p className="mt-1.5 text-[11px] text-ink-faint">
              {isNvidia && models.length > 0
                ? `${models.length} models available to your key.`
                : MODEL_HINTS[draft.provider]}
            </p>
          </div>

          <div>
            <label className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
              Product image
            </label>
            <div className="mt-2 flex items-start justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[13px] text-ink">Generate a product render</div>
                <div className="text-[11px] leading-relaxed text-ink-faint">
                  Creates the image on the Info tab. Slow, and each provider uses its own image model.
                </div>
              </div>
              <button
                onClick={() => setDraft((d) => ({ ...d, enableImages: !d.enableImages }))}
                role="switch"
                aria-checked={draft.enableImages}
                aria-label="Generate product images"
                className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${
                  draft.enableImages ? 'bg-accent' : 'bg-surface-3'
                }`}
              >
                <span
                  className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${
                    draft.enableImages ? 'left-[1.125rem]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>

            <input
              value={draft.imageModel}
              onChange={(e) => setDraft((d) => ({ ...d, imageModel: e.target.value }))}
              disabled={!draft.enableImages}
              spellCheck={false}
              className="mt-2 w-full rounded-lg border border-line bg-surface-0 px-3 py-2 font-mono text-[12.5px] outline-none focus:border-line-bright disabled:opacity-40"
            />
            <p className="mt-1.5 text-[11px] text-ink-faint">
              {isNvidia
                ? 'NIM: black-forest-labs/flux.1-schnell (fast), black-forest-labs/flux.1-dev (higher quality, slower)'
                : draft.provider === 'openai'
                  ? 'OpenAI: gpt-image-1'
                  : 'Gemini: gemini-2.5-flash-image'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2/50 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[13px] text-ink-dim transition hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving || !apiKey.trim()}
            className="rounded-lg bg-accent px-4 py-1.5 text-[13px] font-medium text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProviderCard({
  active,
  title,
  subtitle,
  onClick
}: {
  active: boolean
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-2.5 text-left transition ${
        active ? 'border-accent/50 bg-accent/10' : 'border-line bg-surface-2 hover:border-line-bright'
      }`}
    >
      <div className={`text-[13px] font-medium ${active ? 'text-ink' : 'text-ink-dim'}`}>{title}</div>
      <div className="text-[11px] leading-tight text-ink-faint">{subtitle}</div>
    </button>
  )
}