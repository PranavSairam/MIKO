import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PANEL, PET_WINDOW } from '../../shared/layout'
import { App } from './App'
import './styles.css'

const page = document.documentElement
page.style.setProperty('--pet-width', `${PET_WINDOW.width}px`)
page.style.setProperty('--pet-height', `${PET_WINDOW.height}px`)
page.style.setProperty('--panel-width', `${PANEL.width}px`)
page.style.setProperty('--panel-height', `${PANEL.height}px`)
page.style.setProperty('--panel-gap', `${PANEL.gap}px`)

if (typeof window.miko !== 'undefined') {
  window.miko.setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
}

const root = document.getElementById('root')
if (!root) {
  throw new Error('MIKO root element is missing')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
