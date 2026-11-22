import { createRoot } from 'react-dom/client'
import { ChatGptWebShell } from './ChatGptWebShell'
import './chatgpt-web.css'

const root = document.getElementById('root')
if (root) createRoot(root).render(<ChatGptWebShell />)
