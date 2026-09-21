/**
 * Wat het web over een spel zegt, via Claude met websearch.
 *
 * Niet elk spel staat op Steam: er zijn er genoeg waarvan alleen de studio zelf
 * een pagina heeft, of die op een andere winkel staan. En voor een spel dat er
 * wél staat noemt Steam nooit een datum voor de 1.0 van early access — die
 * staat hooguit in een aankondiging ergens anders. Dit is daarvoor de tweede
 * weg: Claude zoekt, leest, en geeft via een tool met schema terug wat de lijst
 * toont, met de links waar het vandaan komt.
 *
 * Het zoeken gebeurt bij Anthropic (de server-tool `web_search`), niet hier.
 * Het loopt op hetzelfde abonnementstoken als de rest van de app — net zo
 * ongedocumenteerd, dus de route erboven moet een weigering netjes kunnen
 * doorgeven en de app moet zonder verder kunnen.
 */

import { ask, textOf, toolInput } from './claude.js'

/** Zoeken en lezen tegelijk; haiku mist te vaak welke bron de recentste is. */
const MODEL = 'claude-sonnet-5'

/** Genoeg voor de officiële site, een winkel en een aankondiging. */
const MAX_SEARCHES = 5

/** Wat er in de kaart past zonder dat het een linkverzameling wordt. */
const MAX_LINKS = 5

/** Wat er in de badge nog als aanduiding leest ("~2027") en niet als zin. */
const SHORT_MAX = 14

const WEB_SEARCH = { type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }

/**
 * Een tool met een schema in plaats van "geef JSON terug": dan komt er geen
 * uitleg of code-fence omheen die we eruit moeten pulken. Dezelfde aanpak als
 * bij de actiepunten en het overzicht.
 */
const RESULT_TOOL = {
  name: 'spel',
  description: 'Geeft terug wat het web over dit spel zegt.',
  input_schema: {
    type: 'object',
    properties: {
      gevonden: {
        type: 'boolean',
        description:
          'Onwaar als het zoeken niets opleverde of je niet zeker weet dat het om dit spel gaat.',
      },
      naam: { type: 'string', description: 'De naam zoals de makers hem schrijven.' },
      genre: { type: 'string', description: 'Eén tot drie genres, gescheiden door komma’s.' },
      omschrijving: {
        type: 'string',
        description: 'Twee of drie zinnen over wat voor spel het is, in de taal van de bron.',
      },
      status: {
        type: 'string',
        enum: ['aangekondigd', 'early-access', 'uitgebracht'],
        description:
          'aangekondigd = nog niet te spelen, early-access = speelbaar maar de 1.0 staat er niet, uitgebracht = de 1.0 staat er.',
      },
      datum: {
        type: 'string',
        description:
          'De datum die bij die status hoort, zoals de bron hem noemt: "12 maart 2026", "Q1 2026", "2026". Leeg als er geen datum bekend is.',
      },
      datumIso: {
        type: 'string',
        description: 'Diezelfde datum als YYYY-MM-DD, alleen als er een hele datum bekend is.',
      },
      volledigeRelease: {
        type: 'string',
        description:
          'Alleen bij early access: wat de makers over de 1.0 gezegd hebben, zoals zij het schrijven. Eén of twee zinnen, en maak ze af. Leeg als ze er niets over gezegd hebben.',
      },
      volledigeReleaseIso: {
        type: 'string',
        description: 'Die 1.0-datum als YYYY-MM-DD, alleen als er een hele datum genoemd is.',
      },
      volledigeReleaseKort: {
        type: 'string',
        description:
          'Waar die zin op neerkomt, in een paar tekens: "~2027", "Q1 2026", "eind 2026". Een tilde als het een schatting is. Hooguit twaalf tekens, en leeg als er geen jaar of datum in staat.',
      },
      links: {
        type: 'array',
        description: 'De bronnen die je gebruikt hebt, de officiële voorop.',
        items: {
          type: 'object',
          properties: {
            titel: { type: 'string', description: 'Kort: "Officiële site", "PlayStation Store".' },
            url: { type: 'string' },
          },
          required: ['titel', 'url'],
        },
      },
    },
    required: ['gevonden'],
  },
}

const SYSTEM = [
  {
    type: 'text',
    text: `Je zoekt op wat er over één spel bekend is, voor iemand die een lijstje spellen bijhoudt en wil weten wanneer er wat te spelen valt.

- Zoek altijd eerst. Ga nooit op je geheugen af: juist bij spellen die nog moeten verschijnen schuiven datums op.
- De beste bronnen zijn de officiële site van het spel, de site van de ontwikkelaar of de uitgever, en een winkelpagina (PlayStation Store, Xbox, Epic, GOG, Nintendo). Een nieuwsbericht telt alleen als het recenter is dan die.
- Staat het spel in early access, zoek dan expliciet naar wat de makers over de 1.0 gezegd hebben. Daar is dit lijstje voor.
- Moet het spel nog verschijnen, zoek dan expliciet naar de precieste datum die de makers zelf noemen: een winkelpagina of een aankondiging noemt vaak een dag waar een overzichtspagina bij een jaartal blijft.
- Verzin niets en gok niet. Staat een datum er niet, laat hem leeg; "2026" of "eind 2026" mag als dat alles is wat er staat.
- Twijfel je of je het juiste spel te pakken hebt, of levert het zoeken niets op, zet dan gevonden op onwaar.
- Sluit af met één aanroep van het gereedschap \`spel\`.`,
  },
]

/** Eén regel tekst, zonder witruimte-uitschieters en met een dak erop. */
function text(value, max) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function isoDate(value) {
  const clean = text(value, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : null
}

/** Alleen http(s), en de titel valt terug op het domein: dat zegt genoeg. */
function link(entry) {
  try {
    const url = new URL(text(entry?.url, 500))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return {
      label: text(entry?.titel, 60) || url.hostname.replace(/^www\./, ''),
      url: url.toString(),
    }
  } catch {
    return null
  }
}

/**
 * Een spel van het web heeft geen app-id, dus wordt de naam zijn sleutel. Bij
 * bijwerken houdt de app het id dat er al stond, zodat een spel dat zijn naam
 * anders gaat schrijven geen tweede regel wordt.
 */
function slug(name) {
  const base = name
    .toLowerCase()
    // Eerst de accenten los van de letter, dan weg: anders wordt "Pokémon"
    // niet `pokemon` maar `poke-mon`.
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'spel'
}

/** Van wat het model teruggaf naar precies wat de lijst toont. */
function shape(input, term) {
  // Alleen een uitgesproken "gevonden" telt: een tool-aanroep zonder dat veld
  // zou anders een kaart opleveren met de zoekterm als naam en verder niets,
  // en dat leest als een echt spel.
  if (input?.gevonden !== true) return null

  const name = text(input.naam, 120) || term
  const short = text(input.volledigeReleaseKort, 40)
  const status = text(input.status, 20).toLowerCase()
  const earlyAccess = status === 'early-access'
  const released = status === 'uitgebracht'
  const links = (Array.isArray(input.links) ? input.links : [])
    .map(link)
    .filter(Boolean)
    .slice(0, MAX_LINKS)

  return {
    id: `web:${slug(name)}`,
    source: 'web',
    name,
    genre: text(input.genre, 80),
    description: text(input.omschrijving, 300),
    earlyAccess,
    // Een status die we niet kennen wordt "komt nog": dat is de zachtste van de
    // drie beweringen, en "uitgebracht" is er een die je zou natrekken.
    comingSoon: !earlyAccess && !released,
    released,
    releaseDate: text(input.datum, 60),
    releaseAt: isoDate(input.datumIso),
    // Na de 1.0 zegt een 1.0-datum niets meer, en voor een spel dat nog moet
    // verschijnen is het gewoon de releasedatum die hierboven al staat.
    // Hetzelfde dak als de omschrijving: dit is zelden een datum en meestal een
    // zin van de makers ("blijft nog zeker tot eind 2026 in early access"), en
    // bij 80 tekens brak die middenin af.
    fullRelease: earlyAccess ? text(input.volledigeRelease, 300) : '',
    fullReleaseAt: earlyAccess ? isoDate(input.volledigeReleaseIso) : null,
    // De korte vorm hoort in de badge te passen. Afknippen helpt daar niet — dan
    // staat er een halve zin — dus wat te lang is valt weg; de zin hierboven
    // heeft het dan alsnog.
    fullReleaseShort: earlyAccess && short.length <= SHORT_MAX ? short : '',
    // De eerste link is de plek waar je heen wilt; die hangt de app aan de naam.
    storeUrl: links[0]?.url ?? '',
    links,
  }
}

/**
 * Zoekt het spel op en geeft terug wat de lijst ervan toont, of `null` als het
 * web niets bruikbaars opleverde — dat is geen storing.
 */
export async function webGame(term) {
  const today = new Date().toISOString().slice(0, 10)
  const question = `Vandaag is ${today}. Zoek op wat er bekend is over het spel "${term}".`

  const data = await ask({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    tools: [WEB_SEARCH, RESULT_TOOL],
    messages: [{ role: 'user', content: question }],
  })

  const found = toolInput(data, RESULT_TOOL.name)
  if (found) return shape(found, term)

  // Soms schrijft het model zijn bevindingen op in plaats van de tool aan te
  // roepen. Het zoekwerk is dan al gedaan en betaald; alleen het ordenen kost
  // nog een aanroep, en die hoeft niet meer het web op.
  const written = textOf(data)
  if (!written) return null

  const ordered = await ask({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    tools: [RESULT_TOOL],
    tool_choice: { type: 'tool', name: RESULT_TOOL.name },
    messages: [
      { role: 'user', content: question },
      { role: 'assistant', content: written },
      { role: 'user', content: 'Zet dit in het gereedschap `spel`.' },
    ],
  })

  return shape(toolInput(ordered, RESULT_TOOL.name), term)
}
