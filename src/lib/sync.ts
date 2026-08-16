/**
 * Synchronisatie met /api/state, als die er is.
 *
 * localStorage blijft de bron waar de app uit leest: synchroon, en offline
 * gewoon bruikbaar. Deze laag haalt bij het openen op wat er op de server
 * staat en schrijft wijzigingen terug. Draait de app zonder API — GitHub
 * Pages, of de dev-server — dan schakelt hij zichzelf uit en verandert er
 * niets aan het gedrag.
 *
 * Conflicten worden niet opgelost: per sleutel wint de laatste schrijver. Voor
 * één gebruiker met twee apparaten is dat genoeg; bewerk je dezelfde lijst
 * tegelijk op twee toestellen, dan verlies je er een.
 */

/**
 * Het GitHub-token hoort op het apparaat te blijven en niet in een database.
 * Verdwijnt vanzelf zodra wensen niet meer via GitHub lopen.
 */
const NEVER_SYNC = new Set(['settings.githubToken'])

/** Wat we voor het laatst met de server hebben uitgewisseld, per sleutel. */
const settled = new Map<string, string>()

let enabled = true

type Applier = (key: string, raw: string) => void

export function syncDisabled(): boolean {
  return !enabled
}

/**
 * Haalt de serverstaat op en geeft elke sleutel door aan de app. Geeft terug of
 * de lokale staat nu de beste is die er te krijgen is: gelukt, of er is hier
 * helemaal geen API. Bij `false` stond de server er even niet en is wat lokaal
 * ligt mogelijk verouderd.
 */
export async function pull(apply: Applier): Promise<boolean> {
  if (!enabled) return true

  let state: Record<string, string>
  try {
    const response = await fetch('/api/state', { cache: 'no-store' })
    // 404 betekent: geen API onder deze host. Niet blijven proberen.
    if (response.status === 404) {
      enabled = false
      return true
    }
    if (!response.ok) return false
    state = await response.json()
  } catch {
    // Offline of geen netwerk: laat de lokale staat met rust.
    return false
  }

  for (const [key, raw] of Object.entries(state)) {
    if (NEVER_SYNC.has(key) || typeof raw !== 'string') continue
    settled.set(key, raw)
    apply(key, raw)
  }

  return true
}

/**
 * Wist ook de serverkant. Zonder dit zet de eerstvolgende synchronisatie alles
 * wat je net wiste gewoon terug.
 */
export async function wipe(): Promise<void> {
  settled.clear()
  if (!enabled) return
  try {
    await fetch('/api/state', { method: 'DELETE' })
  } catch {
    // Offline: de lokale wis is al gebeurd, de server volgt niet. Dat is
    // zichtbaar genoeg — bij de volgende synchronisatie komt alles terug.
  }
}

/**
 * Schrijft één sleutel terug. Slaat over wat we net van de server kregen,
 * anders duwt de app elke binnengehaalde waarde meteen weer terug.
 */
export async function push(key: string, raw: string): Promise<void> {
  if (!enabled || NEVER_SYNC.has(key)) return
  if (settled.get(key) === raw) return

  settled.set(key, raw)
  try {
    const response = await fetch(`/api/state/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: raw }),
    })
    if (response.status === 404) enabled = false
    if (!response.ok) settled.delete(key)
  } catch {
    // Mislukt: vergeet dat we het verstuurd hebben, dan gaat het bij de
    // volgende wijziging opnieuw mee.
    settled.delete(key)
  }
}
