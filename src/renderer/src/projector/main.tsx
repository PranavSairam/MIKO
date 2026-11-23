import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Projector } from './Projector'
import './projector.css'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Projector />
    </StrictMode>
  )
}
