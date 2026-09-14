import { useState } from 'react'
import { ArrowLeft, Check, RefreshCw, RotateCcw, ScrollText, SlidersHorizontal, X } from 'lucide-react'
import {
  activeInstructions,
  appendLog,
  applyChanges,
  dismiss,
  fetchOverviewUpdate,
  markDone,
  reopen,
} from '../../lib/overview'
import type { LogEntry, OverviewItem, SummaryRule } from '../../lib/overview'
import { BusyError } from '../../lib/mail'
import type { SummarySkip } from '../../lib/mail'
import { usePersistentState } from '../../lib/storage'
import { useLanguage } from '../../lib/language'
import { Markdown } from '../../components/Markdown'
import { Tweaks } from './Tweaks'

type OverviewProps = {
  onClose: () => void
  /** Tik op een regel: de draad zelf openen. */
  onOpenThread: (threadId: string) => void
  /** De losse blik op een periode, buiten het overzicht. */
  onSummaries: () => void
}

function formatMoment(iso: string, language: string) {
  return new Date(iso).toLocaleString(language, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDay(iso: string, language: string) {
  return new Date(iso).toLocaleDateString(language, { day: 'numeric', month: 'short' })
}

/**
 * Eén levende lijst van draden die op iemand wachten, bijgewerkt met alleen
 * de mail sinds de vorige keer. Zie lib/overview.ts voor de regels; hier
 * staat alleen het scherm.
 *
 * Boven wat er nu van je wordt gevraagd en waarop jij wacht, daaronder wat er
 * sinds de vorige keer is gesloten (terug te draaien), en onderin het logboek:
 * per bijwerking wat er binnenkwam en veranderde. Zo is "toen en nu" één
 * scherm: boven de stand, onder hoe het zover kwam.
 */
export function Overview({ onClose, onOpenThread, onSummaries }: OverviewProps) {
  const { t, language } = useLanguage()

  const [items, setItems] = usePersistentState<OverviewItem[]>('mail.overview.items', [])
  const [lastAt, setLastAt] = usePersistentState<string | null>('mail.overview.lastAt', null)
  const [log, setLog] = usePersistentState<LogEntry[]>('mail.overview.log', [])
  const [skip] = usePersistentState<SummarySkip[]>('mail.summary.skip', ['promotions', 'updates'])
  const [rules] = usePersistentState<SummaryRule[]>('mail.summary.rules', [])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [tweaking, setTweaking] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [showHidden, setShowHidden] = useState(false)

  const open = items.filter((item) => item.status === 'open')
  const waiting = items.filter((item) => item.status === 'waiting')
  // Alleen wat Claude bij de laatste bijwerking sloot; wat jij zelf afvinkt
  // hoeft niet nog eens getoond.
  const closed = items.filter(
    (item) => item.status === 'done' && item.closedBy === 'claude' && item.closedAt === lastAt,
  )
  // Wat jij zelf wegdeed. "Voorgoed" moet je wel kunnen nakijken en herroepen.
  const dismissed = items.filter((item) => item.status === 'dismissed')
  const handled = items.filter((item) => item.status === 'done' && item.closedBy === 'you')

  async function refresh() {
    setBusy(true)
    setError(null)
    setNote(null)

    try {
      const update = await fetchOverviewUpdate({
        since: lastAt,
        items: items
          .filter((item) => item.status === 'open' || item.status === 'waiting')
          .map(({ id, threadId, title, who, status, lastChange, since }) => ({
            id,
            threadId,
            title,
            who,
            status,
            lastChange,
            since,
          })),
        done: items.filter((item) => item.status === 'done').map((item) => item.threadId),
        dismissed: items.filter((item) => item.status === 'dismissed').map((item) => item.threadId),
        skip,
        instructions: activeInstructions(rules),
      })

      const { changes } = update
      const touched = changes.add.length + changes.update.length + changes.close.length

      // Dezelfde tijd voor de lijst en voor "vorige keer", zodat wat net gesloten
      // is daaraan te herkennen blijft.
      setItems((current) => applyChanges(current, changes, update.until))
      setLastAt(update.until)

      if (update.messages === 0) {
        setNote(t.mail.overviewNothingNew)
      } else {
        setNote(t.mail.overviewChanged(changes.add.length, changes.update.length, changes.close.length))
        if (touched > 0 || update.log) {
          setLog((current) =>
            appendLog(current, {
              at: update.until,
              from: update.from,
              text: update.log,
              messages: update.messages,
              added: changes.add.length,
              updated: changes.update.length,
              closed: changes.close.length,
            }),
          )
        }
      }
    } catch (problem) {
      setError(problem instanceof BusyError ? t.mail.busy : t.mail.overviewFailed)
    } finally {
      setBusy(false)
    }
  }

  const now = () => new Date().toISOString()

  function row(item: OverviewItem) {
    return (
      <li key={item.id} className="item">
        <button type="button" className="item__main" onClick={() => onOpenThread(item.threadId)}>
          <span className="item__title">{item.title}</span>
          <span className="item__meta">
            {item.who}
            {item.lastChange ? ` · ${item.lastChange}` : ''}
          </span>
          <span className="item__since">{t.mail.overviewSinceLabel(formatDay(item.since, language))}</span>
        </button>
        <button
          type="button"
          className="item__act"
          aria-label={t.mail.overviewDone(item.title)}
          onClick={() => setItems((current) => markDone(current, item.id, now()))}
        >
          <Check size={14} strokeWidth={1.6} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="item__act item__act--dismiss"
          aria-label={t.mail.overviewDismiss(item.title)}
          onClick={() => setItems((current) => dismiss(current, item.id, now()))}
        >
          <X size={14} strokeWidth={1.4} aria-hidden="true" />
        </button>
      </li>
    )
  }

  /** Een verborgen regel: alleen terugzetten, verder niets. */
  function hiddenRow(item: OverviewItem) {
    return (
      <li key={item.id} className="item">
        <button type="button" className="item__main" onClick={() => onOpenThread(item.threadId)}>
          <span className="item__title">{item.title}</span>
          <span className="item__meta">{item.who}</span>
        </button>
        <button
          type="button"
          className="item__act"
          aria-label={t.mail.overviewReopen}
          onClick={() => setItems((current) => reopen(current, item.id, now()))}
        >
          <RotateCcw size={14} strokeWidth={1.4} aria-hidden="true" />
        </button>
      </li>
    )
  }

  return (
    <div className="mail">
      <div className="mail__top sticky-top">
        <div className="mail__boxes">
          <button type="button" className="hairline-button" onClick={onClose}>
            <ArrowLeft size={13} strokeWidth={1.4} aria-hidden="true" />
            {t.mail.back}
          </button>

          <button
            type="button"
            className="mail__icon"
            aria-label={t.mail.tweak}
            onClick={() => setTweaking((current) => !current)}
          >
            <SlidersHorizontal size={14} strokeWidth={1.4} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="mail__icon"
            aria-label={t.mail.overviewPeriod}
            onClick={onSummaries}
          >
            <ScrollText size={14} strokeWidth={1.4} aria-hidden="true" />
          </button>
        </div>
      </div>

      {tweaking && <Tweaks />}

      <div className="overview__update">
        <button
          type="button"
          className="hairline-button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={13} strokeWidth={1.4} aria-hidden="true" />
          {busy ? t.mail.overviewUpdating : t.mail.overviewUpdate}
        </button>
        <span className="overview__when">
          {lastAt ? t.mail.overviewSince(formatMoment(lastAt, language)) : t.mail.overviewFirstRun}
        </span>
      </div>

      {error && <p className="mail__error">{error}</p>}
      {note && <p className="mail__note">{note}</p>}

      {open.length === 0 && waiting.length === 0 && !busy && (
        <p className="mail__empty">{t.mail.overviewEmpty}</p>
      )}

      {open.length > 0 && (
        <>
          <p className="micro overview__head">{t.mail.overviewOpen}</p>
          <ul className="overview__list">{open.map(row)}</ul>
        </>
      )}

      {waiting.length > 0 && (
        <>
          <p className="micro overview__head">{t.mail.overviewWaiting}</p>
          <ul className="overview__list overview__list--waiting">{waiting.map(row)}</ul>
        </>
      )}

      {closed.length > 0 && (
        <>
          <p className="micro overview__head">{t.mail.overviewClosed}</p>
          <ul className="overview__list overview__list--closed">
            {closed.map((item) => (
              <li key={item.id} className="item">
                <button
                  type="button"
                  className="item__main"
                  onClick={() => onOpenThread(item.threadId)}
                >
                  <span className="item__title">{item.title}</span>
                  <span className="item__meta">{item.closedReason}</span>
                </button>
                <button
                  type="button"
                  className="item__act"
                  aria-label={t.mail.overviewReopen}
                  onClick={() => setItems((current) => reopen(current, item.id, now()))}
                >
                  <RotateCcw size={14} strokeWidth={1.4} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {dismissed.length + handled.length > 0 && (
        <div className="overview__log">
          <button
            type="button"
            className="hairline-button"
            onClick={() => setShowHidden((current) => !current)}
          >
            {showHidden
              ? t.mail.overviewHiddenHide
              : t.mail.overviewHidden(dismissed.length + handled.length)}
          </button>

          {showHidden && dismissed.length > 0 && (
            <>
              <p className="micro overview__head">{t.mail.overviewDismissed}</p>
              <ul className="overview__list overview__list--closed">{dismissed.map(hiddenRow)}</ul>
            </>
          )}

          {showHidden && handled.length > 0 && (
            <>
              <p className="micro overview__head">{t.mail.overviewHandled}</p>
              <ul className="overview__list overview__list--closed">{handled.map(hiddenRow)}</ul>
            </>
          )}
        </div>
      )}

      {log.length > 0 && (
        <div className="overview__log">
          <button
            type="button"
            className="hairline-button"
            onClick={() => setShowLog((current) => !current)}
          >
            {showLog ? t.mail.overviewLogHide : t.mail.overviewLog}
          </button>

          {showLog &&
            log.map((entry) => (
              <div key={entry.at} className="logEntry">
                <p className="micro logEntry__head">
                  {formatMoment(entry.at, language)} —{' '}
                  {t.mail.overviewLogMeta(entry.messages, entry.added, entry.updated, entry.closed)}
                </p>
                {entry.text && <Markdown text={entry.text} />}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
