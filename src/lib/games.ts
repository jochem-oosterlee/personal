/**
 * Metagegevens bij een spel. De server praat met Steam — hier blijft alleen
 * het verzoek over, net als bij wensen en actiepunten.
 */

/** Wat Steam over een spel weet, zoals de server het teruggeeft. */
export type GameMeta = {
  appId: number
  name: string
  /** Eén tot drie genres, al samengevoegd; leeg als Steam er geen noemt. */
  genre: string
  description: string
  earlyAccess: boolean
  comingSoon: boolean
  /** Uitgebracht is hier: de 1.0 staat er. Early access telt dus niet mee. */
  released: boolean
  /** Zoals Steam hem schrijft — soms "Q1 2026" of "Coming soon". */
  releaseDate: string
  /** Alleen gevuld als er een hele datum in stond. */
  releaseAt: string | null
  storeUrl: string
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
