import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

// clave nueva desde el rediseño: todos arrancan en el tema claro (el oscuro azul ya no existe)
try {
  document.documentElement.dataset.theme = localStorage.getItem('plano3d-theme') ?? 'light'
} catch {
  document.documentElement.dataset.theme = 'light'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
