import { useState } from 'react'
import { ArrowLeft, SlidersHorizontal } from 'lucide-react'
import { BusyError, summarise } from '../../lib/mail'
import type { SummarySkip } from '../../lib/mail'
import { activeInstructions } from '../../lib/overview'
import type { SummaryRule } from '../../lib/overview'
import { usePersistentState } from '../../lib/storage'
import { useLanguage } from '../../lib/language'
import { Markdown } from '../../components/Markdown'
import { Tweaks } from './Tweaks'

type SummaryProps = {
  onClose: () => void
}

/** Welke periodes je kunt kiezen; 'day' vraagt er een datum bij. */
type RangeId = 'since' | 'today' | 'week' | 'lastWeek' | 'day'

const RANGES: RangeId[] = ['since', 'today', 'week', 'lastWeek', 'day']

/**
 * Een bewaarde samenvatting. Ze blijven staan omdat "sinds vorige keer" je
 * anders in de steek laat: druk je hem twee keer, dan is de tweede leeg — wat
 * klopt, maar het haalt wel je enige exemplaar van het scherm.
 */
type StoredSummary = {
  /** Wanneer hij gemaakt is; tevens de sleutel in de lijst. */
  at: string
  from: string
  to: string | null
  text: string
  messages: number
  threads: number
  skipped: number
  truncated: boolean
}

/** Zoveel bewaren we. De hele lijst gaat als één sleutel naar de server. */
const MAX_KEPT = 10

/** En niet meer dan dit aan tekens, ruim onder wat een Firestore-document mag. */
const MAX_KEPT_CHARS = 300000

function startOfDay(date: Date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

/** Maandag als eerste dag; zondag hoort bij de week die aan het aflopen is. */
function startOfWeek(date: Date) {
  const start = startOfDay(date)
  const weekday = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - weekday)
  return start
}

function addDays(date: Date, days: number) {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

/**
 * Van keuze naar periode. Alles in lokale tijd: "vandaag" is de dag zoals hij
 * op dit toestel heet, niet zoals de server hem in UTC zou tellen.
 */
function period(
  range: RangeId,
  lastAt: string | null,
  day: string,
): { from: Date; to: Date | null } | null {
  const now = new Date()

  if (range === 'since') {
    if (!lastAt) return null
    return { from: new Date(lastAt), to: null }
  }
  if (range === 'today') return { from: startOfDay(now), to: null }
  if (range === 'week') return { from: startOfWeek(now), to: null }
  if (range === 'lastWeek') {
    const thisWeek = startOfWeek(now)
    return { from: addDays(thisWeek, -7), to: thisWeek }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const chosen = new Date(`${day}T00:00:00`)
  return { from: chosen, to: addDays(chosen, 1) }
}

function formatMoment(iso: string, language: string) {
  return new Date(iso).toLocaleString(language, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Houdt de lijst binnen zowel het aantal als het aantal tekens. */
function trim(list: StoredSummary[]): StoredSummary[] {
  const kept = list.slice(0, MAX_KEPT)
  while (kept.length > 1 && JSON.stringify(kept).length > MAX_KEPT_CHARS) kept.pop()
  return kept
}

/**
 * Een samenvatting van wat er binnenkwam, over een periode die jij kiest.
 *
 * Het moment van de laatste samenvatting staat in de gedeelde staat, dus
 * "sinds de vorige keer" klopt ook als je hem gisteren op je laptop opvroeg.
 * Het wordt pas bijgewerkt als er ook echt een samenvatting uitkwam — een
 * mislukte of lege poging hoort geen mail over te slaan.
 */
export function Summary({ onClose }: SummaryProps) {
  const { t, language } = useLanguage()

  const [lastAt, setLastAt] = usePersistentState<string | null>('mail.summary.lastAt', null)
  const [history, setHistory] = usePersistentState<StoredSummary[]>('mail.summary.history', [])
  // Alleen lezen; bewerken gebeurt in Tweaks, op dezelfde sleutels.
  const [skip] = usePersistentState<SummarySkip[]>('mail.summary.skip', ['promotions', 'updates'])
  const [rules] = usePersistentState<SummaryRule[]>('mail.summary.rules', [])

  const [range, setRange] = useState<RangeId>(lastAt ? 'since' : 'today')
  const [day, setDay] = useState('')
  const [tweaking, setTweaking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nothingNew, setNothingNew] = useState(false)
  const [openAt, setOpenAt] = useState<string | null>(null)

  const chosen = period(range, lastAt, day)
  // Zonder keuze de nieuwste: je komt binnen op wat je het laatst las.
  const shown = history.find((item) => item.at === openAt) ?? history[0] ?? null
  const others = history.filter((item) => item.at !== shown?.at)

  async function run() {
    if (!chosen) return
    setBusy(true)
    setError(null)
    setNothingNew(false)

    try {
      const summary = await summarise(chosen.from, chosen.to, skip, activeInstructions(rules))

      if (!summary.text) {
        // Niets nieuws is geen reden om de vorige van het scherm te halen.
        setNothingNew(true)
        return
      }

      const stored: StoredSummary = {
        at: new Date().toISOString(),
        from: chosen.from.toISOString(),
        to: chosen.to ? chosen.to.toISOString() : null,
        text: summary.text,
        messages: summary.messages,
        threads: summary.threads,
        skipped: summary.skipped,
        truncated: summary.truncated,
      }

      setHistory((current) => trim([stored, ...current]))
      setOpenAt(stored.at)
      // Alleen een periode die tot nú loopt schuift "sinds vorige keer" op. Na
      // "vorige week" zou het punt anders bij nu komen te liggen en viel deze
      // hele week tussen wal en schip.
      if (!chosen.to) setLastAt(stored.at)
    } catch (problem) {
      setError(problem instanceof BusyError ? t.mail.busy : t.mail.summaryFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mail">
      <div className="mail__top sticky-top">
        <button type="button" className="hairline-button" onClick={onClose}>
          <ArrowLeft size={13} strokeWidth={1.4} aria-hidden="true" />
          {t.mail.back}
        </button>
      </div>

      <div className="summary__ranges">
        {RANGES.map((id) => (
          <button
            key={id}
            type="button"
            className={id === range ? 'mail__box mail__box--active' : 'mail__box'}
            disabled={id === 'since' && !lastAt}
            onClick={() => setRange(id)}
          >
            {t.mail.range[id]}
          </button>
        ))}
      </div>

      {range === 'day' && (
        <input
          className="send__field summary__day"
          type="date"
          value={day}
          aria-label={t.mail.range.day}
          onChange={(event) => setDay(event.target.value)}
        />
      )}

      <p className="summary__since">
        {range === 'since' && lastAt
          ? t.mail.sinceLast(formatMoment(lastAt, language))
          : t.mail.sinceNever}
      </p>

      <button
        type="button"
        className="hairline-button"
        onClick={() => setTweaking((current) => !current)}
      >
        <SlidersHorizontal size={13} strokeWidth={1.4} aria-hidden="true" />
        {t.mail.tweak}
      </button>

      {tweaking && <Tweaks />}

      <button
        type="button"
        className="hairline-button summary__go"
        disabled={busy || !chosen}
        onClick={() => void run()}
      >
        {busy ? t.mail.summarising : t.mail.summarise}
      </button>

      {busy && <p className="summary__hint">{t.mail.summaryWait}</p>}

      {error && <p className="mail__error">{error}</p>}

      {nothingNew && <p className="mail__note">{t.mail.summaryNothingNew}</p>}

      {shown && (
        <div className="summary__result">
          <p className="summary__meta micro">
            {t.mail.summaryMadeAt(formatMoment(shown.at, language))} —{' '}
            {t.mail.summaryMeta(shown.messages, shown.threads)}
            {shown.skipped > 0 ? ` — ${t.mail.summarySkipped(shown.skipped)}` : ''}
            {shown.truncated ? ` — ${t.mail.summaryTruncated}` : ''}
          </p>
          <Markdown text={shown.text} />
        </div>
      )}

      {others.length > 0 && (
        <div className="summary__earlier">
          <p className="micro summary__earlierTitle">{t.mail.summaryEarlier}</p>
          {others.map((item) => (
            <button
              key={item.at}
              type="button"
              className="summary__old"
              onClick={() => setOpenAt(item.at)}
            >
              <span className="summary__oldWhen">{formatMoment(item.at, language)}</span>
              <span className="summary__oldWhat">
                {t.mail.summaryMeta(item.messages, item.threads)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
