/**
 * Metagegevens bij een spel. De server praat met Steam en met Claude — hier
 * blijft alleen het verzoek over, net als bij wensen en actiepunten.
 */

/** Een bron: de officiële site, de uitgever, een winkel buiten Steam. */
export type GameLink = { label: string; url: string }

/** Wat er over een spel bekend is, zoals de server het teruggeeft. */
export type GameMeta = {
  /** `steam:<app-id>` of `web:<naam>`; een spel van het web heeft geen app-id. */
  id: string
  source: 'steam' | 'web'
  appId?: number
  name: string
  /** Eén tot drie genres, al samengevoegd; leeg als de bron er geen noemt. */
  genre: string
  description: string
  earlyAccess: boolean
  comingSoon: boolean
  /** Uitgebracht is hier: de 1.0 staat er. Early access telt dus niet mee. */
  released: boolean
  /** Zoals de bron hem schrijft — soms "Q1 2026" of "Coming soon". */
  releaseDate: string
  /** Alleen gevuld als er een hele datum in stond. */
  releaseAt: string | null
  /**
   * Wat er over de 1.0 van een spel in early access gevonden is. Steam noemt
   * die nooit; dit komt dus altijd van het web, ook bij een Steam-spel.
   */
  fullRelease?: string
  fullReleaseAt?: string | null
  /** Waar de naam heen linkt: de winkelpagina, of de eerste bron van het web. */
  storeUrl: string
  /** Waar het vandaan komt. Alleen gevuld bij gegevens van het web. */
  links?: GameLink[]
}

/** Een spel in de lijst: de metagegevens plus wanneer ze opgehaald zijn. */
export type Game = GameMeta & { checkedAt: number }

export type SearchHit = { appId: number; name: string }

async function call(path: string): Promise<Response> {
  const response = await fetch(path, { cache: 'no-store' })
  if (!response.ok) throw new Error(`server antwoordde met ${response.status}`)
  return response
}

export async function searchGames(term: string): Promise<SearchHit[]> {
  const response = await call(`/api/games/search?q=${encodeURIComponent(term)}`)
  const { results } = await response.json()
  return Array.isArray(results) ? results : []
}

export async function fetchGame(appId: number): Promise<GameMeta> {
  return (await call(`/api/games/${appId}`)).json()
}

/**
 * Hetzelfde, maar dan opgezocht op het web in plaats van bij Steam. Duurt een
 * halve minuut — Claude zoekt en leest een paar pagina's — en geeft `null` als
 * er niets bruikbaars te vinden was.
 */
export async function fetchFromWeb(term: string): Promise<GameMeta | null> {
  const { game } = await (await call(`/api/games/web?q=${encodeURIComponent(term)}`)).json()
  return game ?? null
}
