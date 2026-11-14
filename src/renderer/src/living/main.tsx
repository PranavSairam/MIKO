import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LivingPreview } from './LivingPreview'
import './living.css'

const root = document.getElementById('root')
if (!root) throw new Error('MIKO living preview root is missing')

createRoot(root).render(
  <StrictMode>
    <LivingPreview />
  </StrictMode>
)
