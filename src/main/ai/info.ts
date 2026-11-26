import type { DesignSpec } from '@shared/types'
import { requestImage, requestText } from './llm'
import type { GeneratedImage } from './llm'
import { imagePromptFor, summaryMessagesFor } from './info-prompts'

/**
 * Calls for the Info tab: a product render and a page-style description. Both
 * are derived from the design itself, so a regenerated design produces a
 * matching picture and description without any new input.
 *
 * The prompts themselves live in ./info-prompts so they can be asserted on
 * without a network call.
 */

export async function generateSummary(spec: DesignSpec, req: {
  provider: 'gemini' | 'openai' | 'nvidia'
  apiKey: string
  model: string
}): Promise<string> {
  const { system, user } = summaryMessagesFor(spec)
  const text = await requestText({
    provider: req.provider,
    apiKey: req.apiKey,
    model: req.model,
    system,
    user
  })
  return text.trim()
}

export async function generateImage(spec: DesignSpec, req: {
  provider: 'gemini' | 'openai' | 'nvidia'
  apiKey: string
  model: string
}): Promise<GeneratedImage> {
  return requestImage({
    provider: req.provider,
    apiKey: req.apiKey,
    model: req.model,
    prompt: imagePromptFor(spec)
  })
}