import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Switcher } from './Switcher'
import './switcher.css'

const root = document.getElementById('root')
if (!root) throw new Error('MIKO switcher root is missing')

createRoot(root).render(
  <StrictMode>
    <Switcher />
  </StrictMode>
)
