import { useState } from 'react'
import { ArrowLeft, Check, SlidersHorizontal } from 'lucide-react'
import { summarise, SKIPS } from '../../lib/mail'
import type { Summary as SummaryResult, SummarySkip } from '../../lib/mail'
import { usePersistentState } from '../../lib/storage'
import { useLanguage } from '../../lib/language'
import { Markdown } from '../../components/Markdown'

type SummaryProps = {
  onClose: () => void
}

/** Welke periodes je kunt kiezen; 'day' vraagt er een datum bij. */
type RangeId = 'since' | 'today' | 'week' | 'lastWeek' | 'day'

const RANGES: RangeId[] = ['since', 'today', 'week', 'lastWeek', 'day']

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
function period(range: RangeId, lastAt: string | null, day: string): { from: Date; to: Date | null } | null {
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

/**
 * Een samenvatting van wat er binnenkwam, over een periode die jij kiest.
 *
 * Het moment van de laatste samenvatting staat in de gedeelde staat, dus
 * "sinds de vorige keer" klopt ook als je hem gisteren op je laptop opvroeg.
 * Het wordt pas bijgewerkt als er ook echt een samenvatting uitkwam — een
 * mislukte poging hoort geen mail over te slaan.
 */
export function Summary({ onClose }: SummaryProps) {
  const { t, language } = useLanguage()

  const [lastAt, setLastAt] = usePersistentState<string | null>('mail.summary.lastAt', null)
  const [skip, setSkip] = usePersistentState<SummarySkip[]>('mail.summary.skip', [
    'promotions',
    'updates',
  ])
  const [instructions, setInstructions] = usePersistentState('mail.summary.instructions', '')

  const [range, setRange] = useState<RangeId>(lastAt ? 'since' : 'today')
  const [day, setDay] = useState('')
  const [tweaking, setTweaking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SummaryResult | null>(null)

  const chosen = period(range, lastAt, day)

  function toggleSkip(item: SummarySkip) {
    setSkip((current) =>
      current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item],
    )
  }

  async function run() {
    if (!chosen) return
    setBusy(true)
    setError(null)
    setResult(null)

    try {
      const summary = await summarise(chosen.from, chosen.to, skip, instructions)
      setResult(summary)
      // Alleen als er echt gekeken is; anders zou een lege poging het venster
      // verschuiven en de mail ertussenuit vallen.
      if (summary.text) setLastAt(new Date().toISOString())
    } catch {
      setError(t.mail.summaryFailed)
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

      {tweaking && (
        <div className="summary__tweak">
          {SKIPS.map((item) => (
            <label key={item} className="summary__skip">
              <input
                className="tick-input"
                type="checkbox"
                checked={skip.includes(item)}
                onChange={() => toggleSkip(item)}
              />
              <span className="tick" aria-hidden="true">
                <Check size={11} strokeWidth={2.5} />
              </span>
              <span className="summary__skipName">{t.mail.skip[item]}</span>
            </label>
          ))}

          <textarea
            className="send__text"
            value={instructions}
            rows={4}
            maxLength={2000}
            placeholder={t.mail.instructionsPlaceholder}
            aria-label={t.mail.instructionsLabel}
            onChange={(event) => setInstructions(event.target.value)}
          />
          <p className="summary__hint">{t.mail.instructionsHint}</p>
        </div>
      )}

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

      {result && !result.text && <p className="mail__empty">{t.mail.summaryEmpty}</p>}

      {result && result.text && (
        <div className="summary__result">
          <p className="summary__meta micro">
            {t.mail.summaryMeta(result.messages, result.threads)}
            {result.skipped > 0 ? ` — ${t.mail.summarySkipped(result.skipped)}` : ''}
            {result.truncated ? ` — ${t.mail.summaryTruncated}` : ''}
          </p>
          <Markdown text={result.text} />
        </div>
      )}
    </div>
  )
}
