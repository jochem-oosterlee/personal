/**
 * Herkennen dat de IAP-sessie verlopen is, en er iets aan doen.
 *
 * Achter IAP antwoordt een verlopen sessie met een 302 naar accounts.google.com.
 * Een gewone fetch volgt die redirect, loopt cross-origin tegen CORS aan en
 * gooit — niet te onderscheiden van "geen netwerk". Met redirect: 'manual'
 * komt hij terug als een opaqueredirect, en dát is het verschil tussen
 * opnieuw inloggen en rustig offline doorwerken.
 *
 * Beide gedragingen zijn met een wegwerpservice op Cloud Run nagemeten voordat
 * dit hier kwam te staan.
 */

/** nginx geeft 204; IAP onderschept dit als de sessie weg is. */
const PROBE = '/__session'

/** Pad dat de service worker met rust laat, dus echt langs IAP komt. */
const RECOVER = '/__auth'

export async function sessionExpired(): Promise<boolean> {
  try {
    const response = await fetch(`${PROBE}?t=${Date.now()}`, {
      redirect: 'manual',
      cache: 'no-store',
    })
    return response.type === 'opaqueredirect'
  } catch {
    // Gegooid betekent geen netwerk, niet geen sessie. Offline hoort gewoon
    // door te werken uit de cache.
    return false
  }
}

export function recoverSession(): void {
  location.href = RECOVER
}

/**
 * Eén controle bij het openen en bij terugkeer naar de voorgrond. Zonder dit
 * opent de app uit de cache, werkt er niets meer en krijg je ook geen
 * loginscherm te zien — een doodstille app.
 *
 * Op GitHub Pages bestaat /__session niet; dat geeft een 404 en dus geen
 * opaqueredirect, waardoor dit daar vanzelf niets doet.
 */
export function watchSession(): () => void {
  let checking = false

  async function check() {
    if (checking || document.visibilityState !== 'visible') return
    checking = true
    try {
      if (await sessionExpired()) recoverSession()
    } finally {
      checking = false
    }
  }

  check()
  document.addEventListener('visibilitychange', check)
  return () => document.removeEventListener('visibilitychange', check)
}
