import { useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, RefreshCw, Search, Trash2 } from 'lucide-react'
import { usePersistentState } from '../../lib/storage'
import { useLanguage } from '../../lib/language'
import { fetchGame, searchGames } from '../../lib/games'
import type { Game, SearchHit } from '../../lib/games'
import type { Language, Translations } from '../../lib/translations'
import './Games.css'

/** Wat er van de datum te maken valt: een hele datum leest netter dan Steam's tekst. */
function dateText(game: Game, language: Language, t: Translations): string {
  if (game.releaseAt) {
    return new Date(`${game.releaseAt}T00:00:00`).toLocaleDateString(language, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }
  return game.releaseDate || t.games.dateUnknown
}

function statusLabel(game: Game, t: Translations): string {
  if (game.comingSoon) return t.games.comingSoon
  if (game.earlyAccess) return t.games.earlyAccess
  return t.games.released
}

function statusModifier(game: Game): string {
  if (game.comingSoon) return 'soon'
  if (game.earlyAccess) return 'early'
  return 'released'
}

/** De datumregel zegt ook wát die datum is; anders staat er een jaartal zonder houvast. */
function whenText(game: Game, language: Language, t: Translations): string {
  const date = dateText(game, language, t)
  if (game.comingSoon) return t.games.expected(date)
  if (game.earlyAccess) return t.games.earlyAccessSince(date)
  return t.games.releasedOn(date)
}

/**
 * Een spel is twee regels hoog: de naam met zijn knoppen, en daaronder status,
 * genre en datum. Ingeklapt staat de omschrijving er helemaal niet — de naam,
 * de status en de datum zijn waar je de lijst voor doorloopt, en een paar
 * regels tekst per spel maken daar een muur van. De chevron die hem uitklapt
 * staat naast de naam in plaats van op een eigen regel: dat scheelt per spel
 * een regel, en bij een lijst van dertig spellen scrollt dat een stuk minder.
 */
function GameRow({
  game,
  language,
  t,
  onRemove,
}: {
  game: Game
  language: Language
  t: Translations
  onRemove: (appId: number) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <li className="game">
      <div className="game__head">
        <a className="game__name" href={game.storeUrl} target="_blank" rel="noreferrer">
          {game.name}
          <ExternalLink size={11} strokeWidth={1.4} aria-hidden="true" />
        </a>
        {game.description && (
          <button
            className="game__more"
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-label={open ? t.games.hideDescription : t.games.showDescription}
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
          onClick={() => onRemove(game.appId)}
          aria-label={t.games.remove(game.name)}
        >
          <Trash2 size={13} strokeWidth={1.4} aria-hidden="true" />
        </button>
      </div>

      {open && game.description && <p className="game__description">{game.description}</p>}

      <div className="game__meta">
        <span className={`game__status game__status--${statusModifier(game)}`}>
          {statusLabel(game, t)}
        </span>
        {game.genre && <span className="game__genre">{game.genre}</span>}
        <span className="game__when">{whenText(game, language, t)}</span>
      </div>
    </li>
  )
}

export function Games() {
  const { t, language } = useLanguage()
  const [games, setGames] = usePersistentState<Game[]>('games.items', [])
  const [term, setTerm] = useState('')
  // null is "niet gezocht"; een lege lijst is "gezocht, niets gevonden".
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Op naam, net als in de spreadsheet: de volgorde waarin je ze toevoegde
  // zegt niets, en dan is een spel steeds opnieuw zoeken in je eigen lijst.
  const sorted = [...games].sort((a, b) => a.name.localeCompare(b.name, language))

  async function search(event: React.FormEvent) {
    event.preventDefault()
    const query = term.trim()
    if (!query || searching) return

    setSearching(true)
    setError('')
    setHits(null)
    try {
      setHits(await searchGames(query))
    } catch {
      setError(t.games.searchFailed)
    } finally {
      setSearching(false)
    }
  }

  async function add(hit: SearchHit) {
    if (adding) return

    // Al in de lijst: dan is de zoekopdracht al beantwoord.
    if (games.some((game) => game.appId === hit.appId)) {
      setTerm('')
      setHits(null)
      return
    }

    setAdding(hit.appId)
    setError('')
    try {
      const meta = await fetchGame(hit.appId)
      setGames((current) =>
        current.some((game) => game.appId === meta.appId)
          ? current
          : [...current, { ...meta, checkedAt: Date.now() }],
      )
      setTerm('')
      setHits(null)
      inputRef.current?.focus()
    } catch {
      setError(t.games.metaFailed)
    } finally {
      setAdding(0)
    }
  }

  /**
   * Alles opnieuw ophalen. Eén voor één: Steam knijpt bij een reeks verzoeken
   * ineens, en een lijst van dertig spellen is zo geen haast. Wat niet lukt
   * blijft staan zoals het was — een halve regel is erger dan een oude.
   */
  async function refreshAll() {
    if (refreshing || games.length === 0) return

    setRefreshing(true)
    setError('')

    const fresh = new Map<number, Game>()
    let failed = 0
    for (const game of games) {
      try {
        fresh.set(game.appId, { ...(await fetchGame(game.appId)), checkedAt: Date.now() })
      } catch {
        failed += 1
      }
    }

    // Op appId samenvoegen in plaats van de lijst vervangen: wat je tijdens
    // het ophalen weggooide blijft weg.
    setGames((current) => current.map((game) => fresh.get(game.appId) ?? game))
    if (failed > 0) setError(t.games.refreshFailed(failed))
    setRefreshing(false)
  }

  function remove(appId: number) {
    setGames((current) => current.filter((game) => game.appId !== appId))
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
      {error && <p className="games__error">{error}</p>}

      {hits !== null && !searching && (
        hits.length === 0 ? (
          <p className="games__note">{t.games.noResults}</p>
        ) : (
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
        )
      )}

      {games.length === 0 ? (
        <p className="games__empty">{t.games.empty}</p>
      ) : (
        <>
          <ul className="games__list">
            {sorted.map((game) => (
              <GameRow
                key={game.appId}
                game={game}
                language={language}
                t={t}
                onRemove={remove}
              />
            ))}
          </ul>

          <div className="games__foot">
            <button
              className="hairline-button"
              type="button"
              disabled={refreshing}
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
