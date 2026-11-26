/**
 * Thin fetch clients for the supported model providers.
 *
 * All three are plain HTTPS calls, so there is no SDK to install and no supply
 * chain to keep patched. Keys never leave the main process.
 *
 * OpenAI and NVIDIA NIM speak the same wire format, so they share one chat
 * implementation that differs only by base URL and whether JSON mode is safe.
 */

import type { AIProviderId } from '@shared/types'
import { buildMessages } from './prompts'
import { firstImageBase64, modelPathSegment } from './images-parse'

export { firstImageBase64, modelPathSegment }

export interface LlmRequest {
  provider: AIProviderId
  apiKey: string
  model: string
  prompt: string
  currentSpec?: import('@shared/types').DesignSpec
}

export class LlmError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'LlmError'
    this.status = status
  }
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
const NVIDIA_MODELS_URL = 'https://integrate.api.nvidia.com/v1/models'

interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

/** Models sometimes wrap JSON in a markdown fence despite instructions. */
function extractJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fence) return JSON.parse(fence[1])
    const first = trimmed.indexOf('{')
    const last = trimmed.lastIndexOf('}')
    if (first !== -1 && last > first) return JSON.parse(trimmed.slice(first, last + 1))
    throw new LlmError('Model did not return valid JSON.', 502)
  }
}

async function callGemini(req: LlmRequest): Promise<string> {
  const { system, user } = buildMessages(req)

  const res = await fetch(`${GEMINI_BASE}/${encodeURIComponent(req.model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': req.apiKey
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        response_mime_type: 'application/json'
      }
    })
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new LlmError(formatApiError('Gemini', res.status, detail), res.status)
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
  if (!text) throw new LlmError('Gemini returned an empty response.', 502)
  return text
}

/**
 * One OpenAI-compatible chat call. `jsonMode` is opt-in because plenty of
 * OpenAI-compatible servers reject `response_format` outright with a 400, and a
 * provider that supports it gains us nothing that the prompt does not already.
 */
async function openAiCompatibleChat(opts: {
  url: string
  providerLabel: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  jsonMode: boolean
}): Promise<string> {
  const res = await fetch(opts.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0.4,
      ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: opts.messages
    })
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new LlmError(formatApiError(opts.providerLabel, res.status, detail), res.status)
  }

  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const text = json.choices?.[0]?.message?.content
  if (!text) throw new LlmError(`${opts.providerLabel} returned an empty response.`, 502)
  return text
}

async function callOpenAi(req: LlmRequest): Promise<string> {
  const { system, user } = buildMessages(req)
  return openAiCompatibleChat({
    url: OPENAI_URL,
    providerLabel: 'OpenAI',
    apiKey: req.apiKey,
    model: req.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    jsonMode: true
  })
}

/**
 * NIM hosts a wide range of model families, and a good number of them ignore
 * "reply with JSON only" and prepend a paragraph of explanation. Rather than
 * failing a slow call over formatting, hand the bad reply back once and ask for
 * the corrected object. This is the difference between a usable app and one
 * that fails on most first attempts.
 */
async function callNvidia(req: LlmRequest): Promise<unknown> {
  const { system, user } = buildMessages(req)
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]

  const first = await openAiCompatibleChat({
    url: NVIDIA_URL,
    providerLabel: 'NVIDIA NIM',
    apiKey: req.apiKey,
    model: req.model,
    messages,
    jsonMode: false
  })

  try {
    return extractJson(first)
  } catch {
    const repaired = await openAiCompatibleChat({
      url: NVIDIA_URL,
      providerLabel: 'NVIDIA NIM',
      apiKey: req.apiKey,
      model: req.model,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content:
            `${user}\n\nYour previous reply could not be parsed as JSON:\n\n` +
            `${first.slice(0, 2000)}\n\n` +
            `Reply with ONLY the corrected JSON object. No prose, no markdown fences, no explanation.`
        }
      ],
      jsonMode: false
    })
    return extractJson(repaired)
  }
}

/**
 * Lists the models this NIM account can call. Powers the model picker in
 * Settings so the user chooses from what actually exists rather than guessing a
 * catalog string.
 */
export async function listNvidiaModels(apiKey: string): Promise<string[]> {
  if (!apiKey.trim()) throw new LlmError('Enter an NVIDIA API key first.', 400)

  const res = await fetch(NVIDIA_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new LlmError(formatApiError('NVIDIA NIM', res.status, detail), res.status)
  }

  const json = (await res.json()) as { data?: Array<{ id?: string }> }
  const ids = (json.data ?? []).map((m) => m.id).filter((id): id is string => !!id)
  if (ids.length === 0) throw new LlmError('NVIDIA NIM returned no models for this key.', 502)
  return ids.sort()
}

interface ErrorBody {
  error?: { message?: string } | string
  detail?: unknown
}

function formatApiError(provider: string, status: number, detail: string): string {
  let message = detail
  let parsed: ErrorBody | null = null

  try {
    parsed = JSON.parse(detail) as ErrorBody
  } catch {
    parsed = null
  }

  if (parsed) {
    // NIM sometimes returns a string-valued `error` rather than an object.
    if (typeof parsed.error === 'string') message = parsed.error
    else if (parsed.error?.message) message = parsed.error.message
    else if (typeof parsed.detail === 'string') message = parsed.detail
  }

  if (status === 401 || status === 403) {
    return `${provider} rejected the API key. Check it in Settings. (${message.slice(0, 200)})`
  }

  // NIM answers validation failures with a pydantic array in `detail`, not a
  // message string. Flatten it, or the user sees the literal "[object Object]".
  if (parsed && Array.isArray(parsed.detail)) {
    const parts = parsed.detail
      .map((d) => {
        const item = d as { loc?: unknown[]; msg?: string }
        const field = Array.isArray(item.loc) ? item.loc.join('.') : ''
        const msg = item.msg ?? 'invalid'
        return field ? `${field}: ${msg}` : msg
      })
      .filter(Boolean)
    if (parts.length > 0) {
      return `${provider} rejected the request: ${parts.join('; ').slice(0, 300)}`
    }
  }

  if (status === 404) {
    return `${provider} does not have a model called that. Open Settings and pick one from the list. (${message.slice(0, 200)})`
  }
  if (status === 429) {
    return `${provider} rate limit or quota reached. Wait a moment, or check your plan. (${message.slice(0, 200)})`
  }
  // 503 is the normal "this model is at capacity" signal, not a bug on our side.
  // Say so and point at the one lever the user actually has.
  if (status === 503) {
    return `${provider}'s model is at capacity right now. Wait a minute and retry, or switch model in Settings.`
  }
  if (status >= 500) {
    return `${provider} had a server error (${status}). Try again shortly.`
  }
  return `${provider} error ${status}: ${message.slice(0, 300)}`
}

/** Calls the configured provider and returns the raw JSON the model produced. */
export async function requestDesign(req: LlmRequest): Promise<unknown> {
  if (!req.apiKey.trim()) {
    throw new LlmError('No API key configured. Open Settings and add one.', 400)
  }

  switch (req.provider) {
    case 'gemini':
      return extractJson(await callGemini(req))
    case 'nvidia':
      return callNvidia(req)
    case 'openai':
      return extractJson(await callOpenAi(req))
  }
}

// ---------------------------------------------------------------------------
// Free-form text: used for the product summary on the Info tab.
// ---------------------------------------------------------------------------

export async function requestText(req: {
  provider: AIProviderId
  apiKey: string
  model: string
  system: string
  user: string
}): Promise<string> {
  if (!req.apiKey.trim()) throw new LlmError('No API key configured.', 400)

  if (req.provider === 'gemini') {
    const res = await fetch(`${GEMINI_BASE}/${encodeURIComponent(req.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 4096 }
      })
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new LlmError(formatApiError('Gemini', res.status, detail), res.status)
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
    if (!text) throw new LlmError('Gemini returned an empty response.', 502)
    return text
  }

  return openAiCompatibleChat({
    url: req.provider === 'nvidia' ? NVIDIA_URL : OPENAI_URL,
    providerLabel: req.provider === 'nvidia' ? 'NVIDIA NIM' : 'OpenAI',
    apiKey: req.apiKey,
    model: req.model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user }
    ],
    jsonMode: false
  })
}

// ---------------------------------------------------------------------------
// Image generation. Deliberately three shapes, not one: NIM, OpenAI and Gemini
// all name their models and structure their responses differently, and NIM's
// image host is not the same as its chat host.
// ---------------------------------------------------------------------------

const NVIDIA_GENAI_BASE = 'https://ai.api.nvidia.com/v1/genai'
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations'

/**
 * Diffusion on a free tier can sit in a queue for minutes. Three minutes is
 * generous enough for a normal render and short enough that a dead request does
 * not leave the Info tab spinning indefinitely.
 */
const NVIDIA_IMAGE_TIMEOUT_MS = 180_000

export interface GeneratedImage {
  base64: string
  mime: string
}

function modelPathSegmentOrThrow(model: string): string {
  try {
    return modelPathSegment(model)
  } catch (err) {
    throw new LlmError(err instanceof Error ? err.message : 'Invalid image model id.', 400)
  }
}

export async function requestImage(req: {
  provider: AIProviderId
  apiKey: string
  model: string
  prompt: string
}): Promise<GeneratedImage> {
  if (!req.apiKey.trim()) throw new LlmError('No API key configured.', 400)
  if (!req.prompt.trim()) throw new LlmError('No image prompt.', 400)

  if (req.provider === 'nvidia') {
    // NIM validates image requests strictly and rejects any field a given model
    // does not declare, with 422 extra_forbidden. A bare prompt is the only body
    // guaranteed to work across the whole genai catalog, so send exactly that.
    const res = await fetch(`${NVIDIA_GENAI_BASE}/${modelPathSegmentOrThrow(req.model)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${req.apiKey}`
      },
      body: JSON.stringify({ prompt: req.prompt }),
      // Diffusion on the free tier can queue for minutes. Fail with a readable
      // message rather than leaving the spinner running forever.
      signal: AbortSignal.timeout(NVIDIA_IMAGE_TIMEOUT_MS)
    }).catch((err: unknown) => {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      if (timedOut) {
        throw new LlmError(
          `NVIDIA NIM took over ${Math.round(NVIDIA_IMAGE_TIMEOUT_MS / 1000)}s to render. ` +
            `The free tier queues image jobs - try again, or pick a faster model such as black-forest-labs/flux.1-schnell.`,
          504
        )
      }
      throw err
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new LlmError(formatApiError('NVIDIA NIM', res.status, detail), res.status)
    }
    const base64 = firstImageBase64(await res.json())
    if (!base64) throw new LlmError('NVIDIA NIM returned no image.', 502)
    return { base64, mime: 'image/jpeg' }
  }

  if (req.provider === 'openai') {
    const res = await fetch(OPENAI_IMAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${req.apiKey}`
      },
      body: JSON.stringify({
        model: req.model,
        prompt: req.prompt,
        size: '1024x1024',
        n: 1
      })
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new LlmError(formatApiError('OpenAI', res.status, detail), res.status)
    }
    const json = (await res.json()) as { data?: Array<{ b64_json?: string }> }
    const b64 = json.data?.[0]?.b64_json
    if (!b64) throw new LlmError('OpenAI returned no image.', 502)
    return { base64: b64, mime: 'image/png' }
  }

  // Gemini returns images inline alongside text, as typed parts.
  const res = await fetch(`${GEMINI_BASE}/${encodeURIComponent(req.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
    })
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new LlmError(formatApiError('Gemini', res.status, detail), res.status)
  }
  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }
    }>
  }
  const parts = json.candidates?.[0]?.content?.parts ?? []
  for (const part of parts) {
    if (part.inlineData?.data) {
      return { base64: part.inlineData.data, mime: part.inlineData.mimeType ?? 'image/png' }
    }
  }
  throw new LlmError('Gemini returned text but no image.', 502)
}