import { useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { usePersistentState } from '../../lib/storage'
import { useLanguage } from '../../lib/language'
import { fetchFromWeb, fetchGame, searchGames } from '../../lib/games'
import type { Game, GameMeta, SearchHit } from '../../lib/games'
import type { Language, Translations } from '../../lib/translations'
import './Games.css'

/** Een hele datum leest netter dan de tekst waar hij vandaan komt. */
function dayText(iso: string, language: Language): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Wat er van de datum te maken valt: een hele datum, anders de tekst zelf. */
function dateText(game: GameMeta, language: Language, t: Translations): string {
  if (game.releaseAt) return dayText(game.releaseAt, language)
  return game.releaseDate || t.games.dateUnknown
}

/** Wat er op het web over de datum gevonden is, of leeg als er niets staat. */
function fullReleaseText(game: GameMeta, language: Language): string {
  if (game.fullReleaseAt) return dayText(game.fullReleaseAt, language)
  return game.fullRelease ?? ''
}

/** Wat er nog als aanduiding leest in de badge, en niet als zin. */
const SHORT_MAX = 14

/**
 * Diezelfde vondst in een paar tekens, voor in de badge: een hele datum als het
 * web die noemde, anders de korte vorm die de server erbij vroeg ("~2027"), en
 * anders de tekst zelf zolang die kort genoeg is — bij een spel dat nog moet
 * verschijnen is dat meestal niet meer dan "Q1 2026". Blijft er niets over, dan
 * staat het alleen in het uitklapbare stuk.
 */
function shortReleaseText(game: GameMeta, language: Language): string {
  if (game.fullReleaseAt) return dayText(game.fullReleaseAt, language)
  if (game.fullReleaseShort) return game.fullReleaseShort
  const found = game.fullRelease ?? ''
  return found.length <= SHORT_MAX ? found : ''
}

/**
 * Waar de vondst van het web over gaat: bij early access de 1.0, bij een spel
 * dat nog moet verschijnen de release zelf. Twee keer dezelfde vraag — wanneer
 * valt hier wat te spelen — maar los zegt een datum niet wélke het is.
 */
function foundLabel(game: GameMeta, t: Translations): (when: string) => string {
  return game.earlyAccess ? t.games.fullRelease : t.games.releaseExpected
}

function statusLabel(game: GameMeta, t: Translations): string {
  if (game.comingSoon) return t.games.comingSoon
  if (game.earlyAccess) return t.games.earlyAccess
  return t.games.released
}

function statusModifier(game: GameMeta): string {
  if (game.comingSoon) return 'soon'
  if (game.earlyAccess) return 'early'
  return 'released'
}

/**
 * Zoeken valt er alleen iets bij een Steam-spel dat er nog niet is: van het web
 * komt de datum al mee, en na de release valt er niets meer op te zoeken. Dat
 * geldt voor early access — Steam noemt nooit een 1.0 — én voor een spel dat
 * nog moet verschijnen, want daar blijft Steam vaak bij "2026" terwijl de
 * makers elders al een dag genoemd hebben.
 */
function canLookUp(game: Game): boolean {
  return game.source !== 'web' && !game.released
}

/**
 * Een regel die er al stond heeft alleen een app-id; de verhuizing in
 * `migrations.ts` geeft hem een id. Die draait pas na de eerste synchronisatie
 * en offline dus voorlopig niet, en tot die tijd moet verwijderen wel werken.
 */
function idOf(game: Game): string {
  return game.id || `steam:${game.appId}`
}

/** De bronnen die het web opleverde, als lijstje links. */
function Links({ game }: { game: GameMeta }) {
  const links = game.links ?? []
  if (links.length === 0) return null

  return (
    <ul className="gamecard__links">
      {links.map((link) => (
        <li key={link.url}>
          <a href={link.url} target="_blank" rel="noreferrer">
            {link.label}
            <ExternalLink size={10} strokeWidth={1.4} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  )
}

/**
 * Een spel is één regel: de naam, de badge rechts uitgelijnd en dan de knoppen.
 * Ingeklapt staan genre, omschrijving, bronnen en wat het web over de datum zei
 * er helemaal niet — de naam, de status en de datum zijn waar je de lijst voor
 * doorloopt, en de rest maakt daar een muur van. Van die vondst blijft alleen de
 * korte vorm in de badge staan ("~2027"): genoeg om zonder uitklappen te zien
 * waar een spel op wacht, de zin erachter staat eronder. Past de naam niet op
 * één regel, dan breekt die over twee regels en houdt de badge zijn plek rechts.
 */
function GameRow({
  game,
  language,
  t,
  lookingUp,
  webBusy,
  onLookUp,
  onRemove,
}: {
  game: Game
  language: Language
  t: Translations
  lookingUp: boolean
  /** Ergens loopt al een zoekopdracht; twee tegelijk wachten alleen op elkaar. */
  webBusy: boolean
  onLookUp: (game: Game) => void
  onRemove: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const planned = fullReleaseText(game, language)
  const shortPlanned = shortReleaseText(game, language)
  const expandable = Boolean(
    game.genre || game.description || planned || (game.links ?? []).length > 0 || canLookUp(game),
  )

  return (
    <li className="game">
      <div className="game__head">
        <div className="game__title">
          {/* Een spel van het web heeft niet altijd een pagina om heen te
              linken; dan blijft de naam gewoon tekst. */}
          {game.storeUrl ? (
            <a className="game__name" href={game.storeUrl} target="_blank" rel="noreferrer">
              {game.name}
              <ExternalLink size={11} strokeWidth={1.4} aria-hidden="true" />
            </a>
          ) : (
            <span className="game__name">{game.name}</span>
          )}
          {/*
            Status en datum staan in dezelfde badge — los zegt een jaartal niet
            wát het is — maar elk op een eigen regel: de releasevorm bovenaan,
            de datum eronder. Achter elkaar brak "Early access, 1 mei 2026" bij
            de ene naam wel en bij de andere niet, en dan staat de datum in de
            lijst nergens op dezelfde plek. Wat het web verwacht komt daar in het
            kort onder, achter een pijl: de datum van de regel blijft zo die van
            Steam, en wat er nog komt staat eronder.
          */}
          <span className={`game__status game__status--${statusModifier(game)}`}>
            <span className="game__status-form">{statusLabel(game, t)}</span>
            <span className="game__status-date">{dateText(game, language, t)}</span>
            {shortPlanned && <span className="game__status-planned">{shortPlanned}</span>}
          </span>
        </div>
        {expandable && (
          <button
            className="game__more"
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-label={open ? t.games.hideDetails : t.games.showDetails}
          >
            {open ? (
              <ChevronUp size={13} strokeWidth={1.4} aria-hidden="true" />
            ) : (
              <ChevronDown size={13} strokeWidth={1.4} aria-hidden="true" />
            )}
          </button>
        )}
        <button
          className="game__remove"
          type="button"
          onClick={() => onRemove(idOf(game))}
          aria-label={t.games.remove(game.name)}
        >
          <Trash2 size={13} strokeWidth={1.4} aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div className="gamecard">
          {planned && <p className="gamecard__planned">{foundLabel(game, t)(planned)}</p>}
          {game.genre && <p className="gamecard__meta">{game.genre}</p>}
          {game.description && <p className="gamecard__text">{game.description}</p>}
          <Links game={game} />
          {canLookUp(game) && (
            <button
              className="hairline-button"
              type="button"
              disabled={webBusy}
              onClick={() => onLookUp(game)}
            >
              <Globe size={12} strokeWidth={1.5} aria-hidden="true" />
              {lookingUp
                ? t.games.lookupBusy
                : game.earlyAccess
                  ? t.games.lookup
                  : t.games.lookupDate}
            </button>
          )}
        </div>
      )}
    </li>
  )
}

export function Games() {
  const { t, language } = useLanguage()
  const [games, setGames] = usePersistentState<Game[]>('games.items', [])
  const [term, setTerm] = useState('')
  // null is "niets van Steam"; een lege lijst is "gezocht, niets gevonden".
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  // Los van `hits`, want ook een Steam die niet antwoordde is een gezochte
  // term — en juist dan moet de weg naar het web openstaan.
  const [searched, setSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  // Wat het web opleverde, nog niet in de lijst: een kaart om te bekijken.
  const [found, setFound] = useState<GameMeta | null>(null)
  const [onWeb, setOnWeb] = useState('')
  const [error, setError] = useState('')
  // Geen storing, maar ook geen resultaat — dat leest anders dan een fout.
  const [note, setNote] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Op naam, net als in de spreadsheet: de volgorde waarin je ze toevoegde
  // zegt niets, en dan is een spel steeds opnieuw zoeken in je eigen lijst.
  const sorted = [...games].sort((a, b) => a.name.localeCompare(b.name, language))

  function clearMessages() {
    setError('')
    setNote('')
  }

  async function search(event: React.FormEvent) {
    event.preventDefault()
    const query = term.trim()
    if (!query || searching) return

    setSearching(true)
    clearMessages()
    setHits(null)
    setFound(null)
    try {
      setHits(await searchGames(query))
    } catch {
      setError(t.games.searchFailed)
    } finally {
      setSearched(true)
      setSearching(false)
    }
  }

  /** Zet een spel in de lijst en ruimt het zoeken op. */
  function keep(meta: GameMeta) {
    setGames((current) =>
      current.some((game) => idOf(game) === meta.id)
        ? current
        : [...current, { ...meta, checkedAt: Date.now() }],
    )
    setTerm('')
    setHits(null)
    setSearched(false)
    setFound(null)
    inputRef.current?.focus()
  }

  async function add(hit: SearchHit) {
    if (adding) return

    // Al in de lijst: dan is de zoekopdracht al beantwoord.
    if (games.some((game) => game.appId === hit.appId)) {
      setTerm('')
      setHits(null)
      setSearched(false)
      setFound(null)
      return
    }

    setAdding(hit.appId)
    clearMessages()
    try {
      keep(await fetchGame(hit.appId))
    } catch {
      setError(t.games.metaFailed)
    } finally {
      setAdding(0)
    }
  }

  /**
   * Het web als tweede weg. Niet elk spel staat op Steam, en soms staat het er
   * wel maar zegt de studio ergens anders meer. Wat Claude vindt komt eerst als
   * kaart in beeld — je moet kunnen zien of het over het juiste spel gaat
   * voordat het in je lijst staat.
   */
  async function searchWeb() {
    const query = term.trim()
    if (!query || onWeb || refreshing) return

    setOnWeb(query)
    clearMessages()
    setFound(null)
    try {
      const meta = await fetchFromWeb(query)
      if (meta) setFound(meta)
      else setNote(t.games.webNothing(query))
    } catch {
      setError(t.games.webFailed)
    } finally {
      setOnWeb('')
    }
  }

  /**
   * Opzoeken waar een regel op wacht: bij early access de 1.0, bij een spel dat
   * nog moet verschijnen de release zelf — en die staat bij zo'n spel niet in de
   * 1.0 maar in de gewone datum van het web. Alleen wat daarbij hoort gaat mee:
   * de rest van de regel komt van Steam en dat blijft zo. De datum in de badge
   * dus ook: wat Steam zegt blijft staan, wat het web vond komt er in het kort
   * onder en helemaal in het uitklapbare stuk.
   */
  async function lookUp(game: Game) {
    if (onWeb || refreshing) return

    const id = idOf(game)
    setOnWeb(id)
    clearMessages()
    try {
      const meta = await fetchFromWeb(game.name)
      if (!meta) {
        setNote(t.games.webNothing(game.name))
        return
      }

      const when = (game.earlyAccess ? meta.fullRelease : meta.releaseDate) || ''
      const whenAt = (game.earlyAccess ? meta.fullReleaseAt : meta.releaseAt) ?? null
      // Bij een spel dat nog moet verschijnen vraagt de server geen korte vorm:
      // de datum die het web daar noemt is er zelf al een.
      const whenShort = (game.earlyAccess ? meta.fullReleaseShort : '') ?? ''
      if (!when) {
        setNote(game.earlyAccess ? t.games.noFullRelease(game.name) : t.games.noDate(game.name))
      }

      // Alleen overschrijven wat deze keer ook echt gevonden is. Een tweede
      // poging die minder oplevert dan de vorige hoort niet te wissen wat er
      // al stond; de datum en de tekst erbij gaan altijd samen.
      setGames((current) =>
        current.map((entry) =>
          idOf(entry) === id
            ? {
                ...entry,
                fullRelease: when || entry.fullRelease,
                fullReleaseAt: when ? whenAt : entry.fullReleaseAt,
                fullReleaseShort: when ? whenShort : entry.fullReleaseShort,
                links: meta.links?.length ? meta.links : entry.links,
                checkedAt: Date.now(),
              }
            : entry,
        ),
      )
    } catch {
      setError(t.games.webFailed)
    } finally {
      setOnWeb('')
    }
  }

  /**
   * Alles opnieuw ophalen. Eén voor één: Steam knijpt bij een reeks verzoeken
   * ineens, en een lijst van dertig spellen is zo geen haast. Een spel van het
   * web gaat langs Claude en duurt daarmee een stuk langer. Wat niet lukt
   * blijft staan zoals het was — een halve regel is erger dan een oude.
   */
  async function refreshAll() {
    if (refreshing || onWeb || games.length === 0) return

    setRefreshing(true)
    clearMessages()

    const fresh = new Map<string, Game>()
    let failed = 0
    for (const game of games) {
      const id = idOf(game)
      try {
        if (game.source === 'web') {
          const meta = await fetchFromWeb(game.name)
          // Het id blijft van de regel: een spel dat zijn naam anders gaat
          // schrijven hoort geen tweede keer in de lijst te komen.
          if (meta) fresh.set(id, { ...meta, id, checkedAt: Date.now() })
          else failed += 1
          continue
        }

        const meta = await fetchGame(game.appId as number)
        fresh.set(id, {
          ...meta,
          // Wat van het web kwam staat niet bij Steam, dus dat zou hier
          // verdwijnen. Na de 1.0 mag het weg: dan is de vraag beantwoord.
          ...(meta.released
            ? {}
            : {
                fullRelease: game.fullRelease,
                fullReleaseAt: game.fullReleaseAt,
                fullReleaseShort: game.fullReleaseShort,
                links: game.links,
              }),
          checkedAt: Date.now(),
        })
      } catch {
        failed += 1
      }
    }

    // Op id samenvoegen in plaats van de lijst vervangen: wat je tijdens het
    // ophalen weggooide blijft weg.
    setGames((current) => current.map((game) => fresh.get(idOf(game)) ?? game))
    if (failed > 0) setError(t.games.refreshFailed(failed))
    setRefreshing(false)
  }

  function remove(id: string) {
    setGames((current) => current.filter((game) => idOf(game) !== id))
  }

  return (
    <div className="games">
      <form className="games__add sticky-top" onSubmit={(event) => void search(event)}>
        <input
          ref={inputRef}
          className="games__input"
          type="text"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={t.games.placeholder}
          aria-label={t.games.inputLabel}
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="words"
        />
        <button
          className="games__submit"
          type="submit"
          disabled={!term.trim() || searching}
          aria-label={t.games.searchLabel}
        >
          <Search size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </form>

      {searching && <p className="games__note">{t.games.searching}</p>}
      {onWeb !== '' && <p className="games__note">{t.games.webBusy}</p>}
      {note && <p className="games__note">{note}</p>}
      {error && <p className="games__error">{error}</p>}

      {searched && !searching && (
        <div className="games__results">
          {hits !== null && hits.length === 0 && (
            <p className="games__note">{t.games.noResults}</p>
          )}
          {hits !== null && hits.length > 0 && (
            <ul className="hits">
              {hits.map((hit) => (
                <li key={hit.appId}>
                  <button
                    className="hits__pick"
                    type="button"
                    disabled={adding !== 0}
                    onClick={() => void add(hit)}
                  >
                    <span className="hits__name">{hit.name}</span>
                    <span className="hits__meta">
                      {adding === hit.appId ? t.games.fetching : t.games.pick}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Staat het spel er niet bij, of helemaal niet op Steam, dan is dit
              de tweede weg. Onder de resultaten en niet ernaast: Steam is
              sneller en gratis, dus die blijft voorgaan. */}
          <button
            className="hairline-button"
            type="button"
            disabled={!term.trim() || onWeb !== '' || refreshing}
            onClick={() => void searchWeb()}
          >
            <Globe size={12} strokeWidth={1.5} aria-hidden="true" />
            {/* Alleen "Zoeken…" als déze knop loopt: `onWeb` houdt ook de
                regel vast waarvan de 1.0 opgezocht wordt. */}
            {onWeb !== '' && onWeb === term.trim()
              ? t.games.webSearching
              : t.games.webSearch}
          </button>
        </div>
      )}

      {found && (
        <div className="gamecard gamecard--found">
          <p className="gamecard__label micro">{t.games.webSource}</p>
          <div className="gamecard__head">
            <span className="gamecard__name">{found.name}</span>
            <span className={`game__status game__status--${statusModifier(found)}`}>
              <span className="game__status-form">{statusLabel(found, t)}</span>
              <span className="game__status-date">{dateText(found, language, t)}</span>
            </span>
            <button
              className="gamecard__close"
              type="button"
              onClick={() => setFound(null)}
              aria-label={t.games.webClose}
            >
              <X size={13} strokeWidth={1.4} aria-hidden="true" />
            </button>
          </div>
          {fullReleaseText(found, language) && (
            <p className="gamecard__meta">
              {t.games.fullRelease(fullReleaseText(found, language))}
            </p>
          )}
          {found.genre && <p className="gamecard__meta">{found.genre}</p>}
          {found.description && <p className="gamecard__text">{found.description}</p>}
          <Links game={found} />
          <button className="hairline-button" type="button" onClick={() => keep(found)}>
            {t.games.pick}
          </button>
        </div>
      )}

      {games.length === 0 ? (
        <p className="games__empty">{t.games.empty}</p>
      ) : (
        <>
          <ul className="games__list">
            {sorted.map((game) => (
              <GameRow
                key={idOf(game)}
                game={game}
                language={language}
                t={t}
                lookingUp={onWeb === idOf(game)}
                webBusy={onWeb !== '' || refreshing}
                onLookUp={(entry) => void lookUp(entry)}
                onRemove={remove}
              />
            ))}
          </ul>

          <div className="games__foot">
            <button
              className="hairline-button"
              type="button"
              disabled={refreshing || onWeb !== ''}
              onClick={() => void refreshAll()}
            >
              <RefreshCw size={12} strokeWidth={1.5} aria-hidden="true" />
              {refreshing ? t.games.refreshing : t.games.refresh}
            </button>
            <p className="games__hint">{t.games.hint}</p>
          </div>
        </>
      )}
    </div>
  )
}
