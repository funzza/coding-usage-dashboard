import type { UsageApi } from '../../preload'

declare global {
  interface Window {
    usageApi: UsageApi
  }
}

export {}
