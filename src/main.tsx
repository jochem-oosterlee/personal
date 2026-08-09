import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { watchSession } from './lib/session'
import './index.css'
import App from './App.tsx'

// Ships a new build to installed clients without asking; state lives in
// localStorage, so a reload is never destructive.
registerSW({ immediate: true })

// Achter IAP opent de app uit de cache ook als de sessie verlopen is. Dan
// werkt er niets meer en verschijnt er geen loginscherm; dit stuurt je alsnog
// naar de login. Buiten IAP doet het niets.
watchSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
