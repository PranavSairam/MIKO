import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GptLiveViewer } from './GptLiveViewer'
import './gpt-live.css'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <GptLiveViewer />
    </StrictMode>
  )
}
