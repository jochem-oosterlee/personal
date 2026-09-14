import { useCallback, useEffect, useState } from 'react'
import {
  ArchiveX,
  ArrowLeft,
  ClipboardList,
  Mail as MailIcon,
  MailOpen,
  PenLine,
  RefreshCw,
  ScrollText,
  Reply,
  Star,
} from 'lucide-react'
import {
  getThread,
  listThreads,
  NoAccessError,
  NotLinkedError,
  reply as sendReply,
  senderAddress,
  send as sendNew,
  setLabels,
  MAX_MAIL,
} from '../../lib/mail'
import type { MailBox, MailDetail, MailThread } from '../../lib/mail'
import { extractTasks } from '../../lib/tasks'
import type { ExtractedTask } from '../../lib/tasks'
import { readStored, writeStored } from '../../lib/storage'
import { useLanguage } from '../../lib/language'
import { useBackLayer } from '../../lib/back'
import { Suggestions } from '../../components/Suggestions'
import { Summary } from './Summary'
import { Overview } from './Overview'
import './Mail.css'

/** Dezelfde vorm als de rijen in Taken; hier komen ze alleen ergens anders vandaan. */
type ChecklistItem = {
  id: string
  name: string
  done: boolean
  addedAt: number
  dueAt?: string
}

/**
 * Taken staat op Persoonlijk of op Werk; een actiepunt uit een mail hoort in de
 * lijst die daar openstaat. Buiten een hook om gelezen, zodat het de stand van
 * dat moment is en niet die van toen dit scherm opende.
 */
function taskTarget() {
  const scope = readStored<'personal' | 'work'>('tasks.scope', 'personal')
  return {
    key: scope === 'work' ? 'tasks.work.items' : 'tasks.items',
    scope,
  }
}

const BOXES: MailBox[] = ['inbox', 'unread', 'starred']

/** Vandaag alleen de tijd, dit jaar dag en maand, daarvoor met jaartal. */
function formatDate(iso: string | null, language: string) {
  if (!iso) return ''
  const date = new Date(iso)
  const now = new Date()

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString(language, {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

/** Wat Claude te lezen krijgt: de draad als lopende tekst, afzender erbij. */
function threadText(detail: MailDetail) {
  return detail.messages
    .map((message) => `Van: ${message.from}\n\n${message.body}`)
    .join('\n\n---\n\n')
}

/**
 * Mail uit Gmail, via de eigen backend.
 *
 * Bewust geen kopie in localStorage zoals de lijstjes: een mailbox is geen
 * lijst die je zelf bijhoudt, en een oude kopie tonen is hier erger dan even
 * niets tonen. Offline is dit onderdeel dus leeg — de rest van de app werkt door.
 */
export function Mail() {
  const { t, language } = useLanguage()

  const [box, setBox] = useState<MailBox>('inbox')
  // Wat je typt, en wat je hebt ingediend: zoeken gebeurt pas bij enter, niet
  // bij elke toets — elke aanroep is een rondje langs Gmail.
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [threads, setThreads] = useState<MailThread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 'ok' zolang er niets aan de koppeling mankeert; de andere twee hebben elk
  // een eigen uitleg, want ze vragen om iets anders van je.
  const [link, setLink] = useState<'ok' | 'not-linked' | 'no-access'>('ok')

  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<MailDetail | null>(null)
  const [composing, setComposing] = useState(false)
  const [summarising, setSummarising] = useState(false)
  const [overviewing, setOverviewing] = useState(false)

  const load = useCallback(
    async (nextBox: MailBox, query: string) => {
      setLoading(true)
      setError(null)
      try {
        setThreads(await listThreads(nextBox, query))
        setLink('ok')
      } catch (problem) {
        if (problem instanceof NotLinkedError) setLink('not-linked')
        else if (problem instanceof NoAccessError) setLink('no-access')
        else setError(t.mail.failed)
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  useEffect(() => {
    void load(box, query)
  }, [box, query, load])

  /** Ook vanuit het overzicht: daar is alleen het id bekend, en of hij ongelezen is niet. */
  async function open(id: string, unread: boolean) {
    setOpenId(id)
    setDetail(null)
    setError(null)

    try {
      setDetail(await getThread(id))
    } catch {
      setError(t.mail.failed)
      return
    }

    // Openen is lezen. Lukt het label niet, dan blijft het bericht ongelezen —
    // vervelender is een lijst die iets anders beweert dan Gmail.
    if (unread) {
      try {
        await setLabels(id, { remove: ['UNREAD'] })
        setThreads((current) =>
          current.map((item) => (item.id === id ? { ...item, unread: false } : item)),
        )
      } catch {
        // Stil: het bericht staat al open.
      }
    }
  }

  function back() {
    setOpenId(null)
    setDetail(null)
  }

  // De terugknop van het toestel sluit eerst wat er openstaat.
  useBackLayer(openId !== null, back)
  useBackLayer(composing, () => setComposing(false))
  useBackLayer(overviewing, () => setOverviewing(false))
  useBackLayer(summarising, () => setSummarising(false))

  if (link !== 'ok') {
    return (
      <div className="mail__notice">
        <p className="mail__noticeText">
          {link === 'no-access' ? t.mail.noAccess : t.mail.notLinked}
        </p>
      </div>
    )
  }

  if (openId) {
    return (
      <Thread
        id={openId}
        detail={detail}
        error={error}
        onBack={back}
        onChanged={() => void load(box, query)}
      />
    )
  }

  if (summarising) return <Summary onClose={() => setSummarising(false)} />

  if (overviewing) {
    return (
      <Overview
        onClose={() => setOverviewing(false)}
        onOpenThread={(threadId) => void open(threadId, false)}
        onSummaries={() => setSummarising(true)}
      />
    )
  }

  return (
    <div className="mail">
      <div className="mail__top sticky-top">
        <div className="mail__boxes">
          {BOXES.map((name) => (
            <button
              key={name}
              type="button"
              className={name === box ? 'mail__box mail__box--active' : 'mail__box'}
              onClick={() => {
                setSearch('')
                setQuery('')
                setBox(name)
              }}
            >
              {t.mail.box[name]}
            </button>
          ))}

          <button
            type="button"
            className="mail__icon"
            aria-label={t.mail.refresh}
            onClick={() => void load(box, query)}
          >
            <RefreshCw size={14} strokeWidth={1.4} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="mail__icon"
            aria-label={t.mail.overview}
            onClick={() => setOverviewing(true)}
          >
            <ScrollText size={14} strokeWidth={1.4} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="mail__icon"
            aria-label={t.mail.compose}
            onClick={() => setComposing(true)}
          >
            <PenLine size={14} strokeWidth={1.4} aria-hidden="true" />
          </button>
        </div>

        <form
          className="mail__search"
          onSubmit={(event) => {
            event.preventDefault()
            setQuery(search)
          }}
        >
          <input
            className="mail__searchInput"
            value={search}
            placeholder={t.mail.searchPlaceholder}
            aria-label={t.mail.search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </form>
      </div>

      {composing && <Compose onClose={() => setComposing(false)} />}

      {error && <p className="mail__error">{error}</p>}

      {loading && <p className="mail__empty">{t.mail.loading}</p>}

      {!loading && threads.length === 0 && <p className="mail__empty">{t.mail.empty}</p>}

      <ul className="mail__list">
        {threads.map((thread) => (
          <li key={thread.id}>
            <button
              type="button"
              className={thread.unread ? 'thread thread--unread' : 'thread'}
              onClick={() => void open(thread.id, thread.unread)}
            >
              <span className="thread__head">
                <span className="thread__from">{thread.from}</span>
                <span className="thread__date">{formatDate(thread.date, language)}</span>
              </span>
              <span className="thread__subject">
                {thread.starred && (
                  <Star size={11} strokeWidth={1.6} className="thread__star" aria-hidden="true" />
                )}
                {thread.subject}
                {thread.count > 1 && <span className="thread__count">{thread.count}</span>}
              </span>
              <span className="thread__snippet">{thread.snippet}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

type ThreadProps = {
  id: string
  detail: MailDetail | null
  error: string | null
  onBack: () => void
  /** De lijst opnieuw ophalen nadat er een label is gezet. */
  onChanged: () => void
}

function Thread({ id, detail, error, onBack, onChanged }: ThreadProps) {
  const { t, language } = useLanguage()

  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [found, setFound] = useState<{ key: string; tasks: ExtractedTask[] } | null>(null)
  const [replying, setReplying] = useState(false)

  async function label(change: { add?: string[]; remove?: string[] }, message: string) {
    setBusy(true)
    try {
      await setLabels(id, change)
      setNote(message)
      onChanged()
    } catch {
      setNote(t.mail.failed)
    } finally {
      setBusy(false)
    }
  }

  async function findTasks() {
    if (!detail) return
    setBusy(true)
    setNote(null)
    setFound(null)

    try {
      const tasks = await extractTasks(threadText(detail).slice(0, 20000))
      if (tasks.length === 0) setNote(t.extract.nothing)
      else setFound({ key: crypto.randomUUID(), tasks })
    } catch {
      setNote(t.extract.failed)
    } finally {
      setBusy(false)
    }
  }

  function addTasks(tasks: ExtractedTask[]) {
    const { key, scope } = taskTarget()

    writeStored(key, [
      ...readStored<ChecklistItem[]>(key, []),
      ...tasks.map((task) => ({
        id: crypto.randomUUID(),
        name: task.name,
        done: false,
        addedAt: Date.now(),
        dueAt: task.dueAt,
      })),
    ])

    setFound(null)
    // Welke lijst erbij staat: met twee lijsten is "toegevoegd" niet genoeg.
    setNote(t.mail.tasksAdded(tasks.length, scope === 'work' ? t.tasks.work : t.tasks.personal))
  }

  return (
    <div className="mail">
      <div className="mail__top sticky-top">
        <button type="button" className="hairline-button" onClick={onBack}>
          <ArrowLeft size={13} strokeWidth={1.4} aria-hidden="true" />
          {t.mail.back}
        </button>
      </div>

      {error && <p className="mail__error">{error}</p>}
      {!detail && !error && <p className="mail__empty">{t.mail.loading}</p>}

      {detail && (
        <>
          <h2 className="mail__subject">{detail.subject}</h2>

          <div className="mail__actions">
            <button
              type="button"
              className="hairline-button"
              disabled={busy}
              onClick={() => void label({ remove: ['INBOX'] }, t.mail.archived)}
            >
              <ArchiveX size={13} strokeWidth={1.4} aria-hidden="true" />
              {t.mail.archive}
            </button>

            <button
              type="button"
              className="hairline-button"
              disabled={busy}
              onClick={() => void label({ add: ['UNREAD'] }, t.mail.markedUnread)}
            >
              <MailIcon size={13} strokeWidth={1.4} aria-hidden="true" />
              {t.mail.markUnread}
            </button>

            <button
              type="button"
              className="hairline-button"
              disabled={busy}
              onClick={() => void label({ add: ['STARRED'] }, t.mail.starred)}
            >
              <Star size={13} strokeWidth={1.4} aria-hidden="true" />
              {t.mail.star}
            </button>

            <button
              type="button"
              className="hairline-button"
              disabled={busy}
              onClick={() => void findTasks()}
            >
              <ClipboardList size={13} strokeWidth={1.4} aria-hidden="true" />
              {t.mail.tasks}
            </button>

            <button
              type="button"
              className="hairline-button"
              disabled={busy}
              onClick={() => setReplying((open) => !open)}
            >
              <Reply size={13} strokeWidth={1.4} aria-hidden="true" />
              {t.mail.reply}
            </button>
          </div>

          {note && <p className="mail__note">{note}</p>}

          {found && <Suggestions key={found.key} tasks={found.tasks} onAdd={addTasks} />}

          {replying && (
            <Send
              to={detail.reply.name}
              subject={detail.reply.subject}
              onSend={(text) => sendReply(id, text)}
              onDone={() => {
                setReplying(false)
                setNote(t.mail.sent)
              }}
            />
          )}

          <ol className="mail__messages">
            {detail.messages.map((message) => (
              <li key={message.id} className="message">
                <div className="message__head">
                  <span className="message__from">
                    <MailOpen size={11} strokeWidth={1.4} aria-hidden="true" />
                    {message.from}
                  </span>
                  <span className="message__date">{formatDate(message.date, language)}</span>
                </div>
                <p className="message__body">{message.body}</p>
                {message.attachments.length > 0 && (
                  <p className="message__attachments">
                    {message.attachments.map((file) => file.name).join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

type SendProps = {
  to: string
  subject: string
  onSend: (text: string) => Promise<void>
  onDone: () => void
  /** Bij een antwoord staat er nog nergens naar wie het gaat; bij een nieuw bericht wel. */
  heading?: boolean
}

/**
 * Versturen in twee klikken. Een mail is niet terug te halen, en dit is de
 * enige plek in de app waar iets naar buiten gaat dat niet van jou zelf komt.
 */
function Send({ to, subject, onSend, onDone, heading = true }: SendProps) {
  const { t } = useLanguage()
  const [text, setText] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    setBusy(true)
    setError(null)
    try {
      await onSend(text.trim())
      onDone()
    } catch {
      setError(t.mail.sendFailed)
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="send">
      {heading && (
        <>
          <p className="send__to micro">{t.mail.to(to)}</p>
          <p className="send__subject">{subject}</p>
        </>
      )}

      <textarea
        className="send__text"
        value={text}
        rows={5}
        maxLength={MAX_MAIL}
        placeholder={t.mail.replyPlaceholder}
        aria-label={t.mail.reply}
        onChange={(event) => setText(event.target.value)}
      />

      {error && <p className="mail__error">{error}</p>}

      {confirming ? (
        <div className="send__confirm">
          <span className="send__ask">{t.mail.sendConfirm}</span>
          <button
            type="button"
            className="hairline-button"
            disabled={busy}
            onClick={() => void go()}
          >
            {busy ? t.mail.sending : t.mail.sendYes}
          </button>
          <button
            type="button"
            className="hairline-button"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            {t.mail.sendNo}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="hairline-button"
          disabled={!text.trim()}
          onClick={() => setConfirming(true)}
        >
          {t.mail.send}
        </button>
      )}
    </div>
  )
}

/** Nieuw bericht: hetzelfde verstuurvak, met een adres en onderwerp erboven. */
function Compose({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [from, setFrom] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    void senderAddress()
      .then(setFrom)
      .catch(() => setFrom(''))
  }, [])

  if (done) {
    return (
      <div className="send">
        <p className="mail__note">{t.mail.sent}</p>
        <button type="button" className="hairline-button" onClick={onClose}>
          {t.mail.close}
        </button>
      </div>
    )
  }

  return (
    <div className="send">
      <div className="send__head">
        <span className="micro send__title">{from ? t.mail.from(from) : t.mail.compose}</span>
        <button type="button" className="hairline-button" onClick={onClose}>
          {t.mail.close}
        </button>
      </div>

      <input
        className="send__field"
        value={to}
        type="email"
        placeholder={t.mail.toPlaceholder}
        aria-label={t.mail.toLabel}
        onChange={(event) => setTo(event.target.value)}
      />

      <input
        className="send__field"
        value={subject}
        placeholder={t.mail.subjectPlaceholder}
        aria-label={t.mail.subjectLabel}
        onChange={(event) => setSubject(event.target.value)}
      />

      {to.includes('@') && (
        <Send
          to={to}
          subject={subject || t.mail.noSubject}
          heading={false}
          onSend={(text) => sendNew(to, subject, text)}
          onDone={() => setDone(true)}
        />
      )}
    </div>
  )
}
