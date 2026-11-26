import type { AIProviderId, AppSettings } from './types'

/**
 * The provider settings are a flat record with three parallel key/model pairs.
 * These helpers are the only place that knows which pair is live, so adding a
 * fourth provider means editing one file instead of every `provider === ...`.
 */

export const PROVIDER_LABELS: Record<AIProviderId, string> = {
  nvidia: 'NVIDIA NIM',
  gemini: 'Gemini',
  openai: 'OpenAI'
}

export function activeApiKey(settings: AppSettings): string {
  switch (settings.provider) {
    case 'nvidia':
      return settings.nvidiaApiKey
    case 'openai':
      return settings.openaiApiKey
    case 'gemini':
      return settings.geminiApiKey
  }
}

export function activeModel(settings: AppSettings): string {
  switch (settings.provider) {
    case 'nvidia':
      return settings.nvidiaModel
    case 'openai':
      return settings.openaiModel
    case 'gemini':
      return settings.geminiModel
  }
}

export function hasApiKey(settings: AppSettings): boolean {
  return activeApiKey(settings).trim().length > 0
}

/**
 * Image generation is not one API — every provider names and shapes it
 * differently. These are the models to seed each provider with when the user
 * switches, so the Info tab is never left pointing at the previous provider's
 * catalog id.
 */
export const DEFAULT_IMAGE_MODELS: Record<AIProviderId, string> = {
  // NIM's image endpoint takes the vendor-prefixed path segment, not the bare
  // catalog name shown on build.nvidia.com. schnell is the low-step variant:
  // flux.1-dev sat in the free-tier queue for minutes during testing.
  nvidia: 'black-forest-labs/flux.1-schnell',
  openai: 'gpt-image-1',
  gemini: 'gemini-2.5-flash-image'
}