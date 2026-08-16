import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { watchSession } from './lib/session'
import { runMigrations } from './lib/migrations'
import { startSync } from './lib/storage'
import './index.css'
import App from './App.tsx'

// Ships a new build to installed clients without asking; state lives in
// localStorage, so a reload is never destructive.
registerSW({ immediate: true })

// Achter IAP opent de app uit de cache ook als de sessie verlopen is. Dan
// werkt er niets meer en verschijnt er geen loginscherm; dit stuurt je alsnog
// naar de login. Buiten IAP doet het niets.
watchSession()

// Haalt de staat van de server en schrijft wijzigingen terug. Zonder API —
// GitHub Pages, dev-server — schakelt dit zichzelf uit. De verhuizingen
// draaien pas als die eerste ophaalpoging klaar is.
startSync(runMigrations)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
