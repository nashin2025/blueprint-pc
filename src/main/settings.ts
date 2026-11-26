import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings } from '@shared/types'
import { dataDir } from './paths'

/**
 * User settings, stored as a plain JSON file next to the projects.
 * Kept separate from projects.json so resetting designs never clears the API key.
 */

const FILE_NAME = 'settings.json'

const DEFAULTS: AppSettings = {
  provider: 'nvidia',
  geminiApiKey: '',
  geminiModel: 'gemini-3.8-flash',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini',
  nvidiaApiKey: '',
  nvidiaModel: 'meta/llama-3.3-70b-instruct',
  imageModel: 'black-forest-labs/flux.1-schnell',
  enableImages: false
}

function settingsPath(): string {
  return join(dataDir(), FILE_NAME)
}

export function loadSettings(): AppSettings {
  const path = settingsPath()
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AppSettings>
    // provider is a closed set: anything unrecognised (including a value from
    // an older build) falls back to the default rather than reaching llm.ts.
    const provider =
      parsed.provider === 'openai' || parsed.provider === 'nvidia' ? parsed.provider : 'gemini'
    return {
      provider,
      geminiApiKey: typeof parsed.geminiApiKey === 'string' ? parsed.geminiApiKey : '',
      geminiModel: parsed.geminiModel || DEFAULTS.geminiModel,
      openaiApiKey: typeof parsed.openaiApiKey === 'string' ? parsed.openaiApiKey : '',
      openaiModel: parsed.openaiModel || DEFAULTS.openaiModel,
      nvidiaApiKey: typeof parsed.nvidiaApiKey === 'string' ? parsed.nvidiaApiKey : '',
      nvidiaModel: parsed.nvidiaModel || DEFAULTS.nvidiaModel,
      imageModel: parsed.imageModel || DEFAULTS.imageModel,
      enableImages: parsed.enableImages === true
    }
  } catch (err) {
    console.error('[settings] unreadable, falling back to defaults:', err)
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  const path = settingsPath()
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8')
  renameSync(tmp, path)
  return settings
}