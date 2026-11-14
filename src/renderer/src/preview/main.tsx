import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Phase2Preview } from './Phase2Preview'
import './preview.css'

const root = document.getElementById('root')
if (!root) {
  throw new Error('MIKO preview root element is missing')
}

createRoot(root).render(
  <StrictMode>
    <Phase2Preview />
  </StrictMode>
)
