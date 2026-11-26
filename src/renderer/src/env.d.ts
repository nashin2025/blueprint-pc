import type { Bridge } from '../../main/preload'

declare global {
  interface Window {
    api: Bridge
  }
}

export {}