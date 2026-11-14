/// <reference types="vite/client" />

import type { MikoApi } from '../../shared/api'
import type { MikoSwitcherApi } from '../../shared/switcher'

declare global {
  interface Window {
    miko: MikoApi
    mikoSwitcher: MikoSwitcherApi
  }
}

export {}
