/**
 * Metagegevens bij een spel, van Steam's storefront-API.
 *
 * Die API is publiek en heeft geen sleutel nodig, maar stuurt geen
 * CORS-koppen: de app kan er dus niet zelf bij en het loopt via deze server,
 * net als Gmail en Claude. Er is niets te bewaren — de app houdt de lijst zelf
 * bij en haalt hier alleen op wat Steam nú over een spel zegt.
 */

const SEARCH_URL = 'https://store.steampowered.com/api/storesearch/'
const DETAILS_URL = 'https://store.steampowered.com/api/appdetails'

/** Steam antwoordt meestal binnen een seconde; hierna is het geen wachten waard. */
const TIMEOUT_MS = 8000

/** Early access is bij Steam geen vlag maar een genre. */
const EARLY_ACCESS_GENRE = '70'

/** Genoeg om het juiste spel aan te wijzen, kort genoeg om te overzien. */
const MAX_RESULTS = 8

const MONTHS = new Map(
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map(
    (month, index) => [month, index + 1],
  ),
)

async function getJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Steam antwoordde met ${response.status}`)
  return response.json()
}

/**
 * De datum die Steam teruggeeft is een stuk tekst in de gevraagde taal, en
 * lang niet altijd een dag: "Q1 2026", "2026" en "Coming soon" komen net zo
 * goed voorbij. Alleen een volledige datum wordt hier een ISO-datum; de rest
 * toont de app zoals Steam hem schreef.
 */
function isoDate(text) {
  const clean = String(text ?? '')
    .replace(',', ' ')
    .trim()

  // Steam schrijft in het Engels zowel "2 May 2024" als "May 2 2024".
  const dayFirst = clean.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
  const monthFirst = clean.match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/)

  let parts = null
  if (dayFirst) parts = { day: dayFirst[1], month: dayFirst[2], year: dayFirst[3] }
  if (monthFirst) parts = { day: monthFirst[2], month: monthFirst[1], year: monthFirst[3] }
  if (!parts) return null

  const month = MONTHS.get(parts.month.slice(0, 3).toLowerCase())
  if (!month) return null

  return `${parts.year}-${String(month).padStart(2, '0')}-${parts.day.padStart(2, '0')}`
}

/** De korte omschrijving bevat soms opmaak; de app toont platte tekst. */
function plain(text) {
  return String(text ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#0?39|apos|nbsp);/g, (_match, entity) => {
      switch (entity) {
        case 'amp':
          return '&'
        case 'lt':
          return '<'
        case 'gt':
          return '>'
        case 'quot':
          return '"'
        case 'nbsp':
          return ' '
        default:
          return "'"
      }
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/** Zoeken op naam; de app laat je kiezen welke het is. */
export async function searchGames(term) {
  const data = await getJson(
    `${SEARCH_URL}?term=${encodeURIComponent(term)}&l=english&cc=nl`,
  )
  const items = Array.isArray(data?.items) ? data.items : []

  return items
    .filter((item) => Number.isInteger(Number(item?.id)) && (item?.type ?? 'app') === 'app')
    .slice(0, MAX_RESULTS)
    .map((item) => ({ appId: Number(item.id), name: plain(item.name).slice(0, 120) }))
    .filter((item) => item.name)
}

/**
 * Alles wat de lijst toont, in één keer. `null` als Steam het spel niet kent —
 * dat is geen storing, maar een app-id dat niet (meer) bestaat.
 */
export async function gameDetails(appId) {
  const data = await getJson(`${DETAILS_URL}?appids=${appId}&l=english&cc=nl`)
  const entry = data?.[String(appId)]
  if (!entry?.success || !entry.data) return null

  const app = entry.data
  const genres = Array.isArray(app.genres) ? app.genres : []
  const earlyAccess = genres.some((genre) => String(genre?.id) === EARLY_ACCESS_GENRE)
  const comingSoon = Boolean(app.release_date?.coming_soon)
  const date = plain(app.release_date?.date)

  return {
    appId: Number(appId),
    name: plain(app.name).slice(0, 120),
    // Early access staat als vlag al in de regel; nog eens als genre erbij
    // zou de enige twee tot drie woorden opsouperen die er passen.
    genre: genres
      .filter((genre) => String(genre?.id) !== EARLY_ACCESS_GENRE)
      .map((genre) => plain(genre?.description))
      .filter(Boolean)
      .slice(0, 3)
      .join(', '),
    description: plain(app.short_description).slice(0, 300),
    earlyAccess,
    comingSoon,
    // "Uitgebracht" is hier: de 1.0 staat er. Een spel in early access is dus
    // niet uitgebracht — hetzelfde onderscheid dat de spreadsheet maakte.
    released: !comingSoon && !earlyAccess,
    releaseDate: date,
    releaseAt: isoDate(date),
    storeUrl: `https://store.steampowered.com/app/${appId}/`,
  }
}
