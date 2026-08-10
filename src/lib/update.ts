/**
 * Haalt een nieuwe build binnen en herlaadt pas als die er ook echt is.
 *
 * registration.update() belooft minder dan de naam suggereert: die belofte is
 * ingelost zodra de controle klaar is en de installatie *begonnen*. Herlaad je
 * op dat moment — en dat deed de knop — dan bedient de oude worker de pagina
 * nog steeds uit de oude cache. Je ziet dus niets veranderen, terwijl de nieuwe
 * versie een seconde later wel klaarstaat. Vandaar dat een tweede poging vaak
 * wél werkte.
 *
 * Dus: wachten tot de nieuwe worker actief is, en dan pas herladen.
 */

/** Ruim boven een normale installatie; hierna herladen we toch maar. */
const READY_TIMEOUT_MS = 20_000

function waitForActive(worker: ServiceWorker): Promise<void> {
  if (worker.state === 'activated') return Promise.resolve()

  return new Promise((resolve) => {
    worker.addEventListener('statechange', () => {
      // 'redundant' betekent dat de installatie is afgeblazen. Doorgaan met
      // wachten heeft dan geen zin meer.
      if (worker.state === 'activated' || worker.state === 'redundant') resolve()
    })
  })
}

function after(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function applyUpdate(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    if (registration) {
      await registration.update()

      const pending = registration.installing ?? registration.waiting
      if (pending) {
        // Blijft een worker in 'waiting' hangen, dan wacht hij op de laatste
        // pagina die de oude versie gebruikt — dat zijn wij. Dit zet hem door.
        registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
        await Promise.race([waitForActive(pending), after(READY_TIMEOUT_MS)])
      }
    }
  } catch {
    // Geen service worker, of de controle mislukte. Herladen kan alsnog
    // helpen, dus dat doen we hieronder gewoon.
  }

  location.reload()
}
