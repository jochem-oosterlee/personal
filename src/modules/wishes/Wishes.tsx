import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ImagePlus, Plus, Send, X } from 'lucide-react'
import { Markdown } from '../../components/Markdown'
import { usePersistentState } from '../../lib/storage'
import { useAutoGrow } from '../../lib/autogrow'
import { useLanguage } from '../../lib/language'
import { DEFAULT_MODEL } from '../../lib/models'
import type { ModelId } from '../../lib/models'
import {
  STEPS,
  addAttachment,
  attachmentUrl,
  createWish,
  listWishes,
  removeAttachment,
  removeWish,
  replyToWish,
  submitWish,
  updateWish,
} from '../../lib/wishes'
import type { Attachment, Wish, WishStatus } from '../../lib/wishes'
import { prepareImage } from '../../lib/images'
import type { Translations } from '../../lib/translations'
import './Wishes.css'

// Kort genoeg om te volgen wat de agent doet, ruim genoeg om de eigen API niet
// onnodig te belasten. Er zit geen limiet meer op zoals bij de GitHub-API.
const POLL_INTERVAL_MS = 5_000

/** Statussen waarbij er echt een job draait die je zou onderbreken. */
function isRunning(status: WishStatus): boolean {
  return status === 'queued' || status === 'running'
}

function statusLabel(status: WishStatus, t: Translations): string {
  switch (status) {
    case 'draft':
      return t.wishes.statusDraft
    case 'running':
      return t.wishes.statusProgress
    case 'needs-answer':
      return t.wishes.statusNeedsAnswer
    case 'done':
      return t.wishes.statusDone
    case 'failed':
      return t.wishes.statusFailed
    default:
      return t.wishes.statusOpen
  }
}

/** De schermafdruk die schermvullend open staat, met de wens waar hij bij hoort. */
type Viewing = { wishId: string; attachment: Attachment }

export function Wishes() {
  const { t } = useLanguage()
  const [model] = usePersistentState<ModelId>('settings.model', DEFAULT_MODEL)
  const [wishes, setWishes] = useState<Wish[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  // Ingeklapt is de rusttoestand: een wens met toelichting en een draad vult
  // anders het hele scherm en dan is de lijst niet meer te overzien. Wat je
  // openzet blijft open, ook als de volgende poll de wensen vervangt.
  const [expanded, setExpanded] = useState<string[]>([])
  // De schermvullende schermafdruk hoort bij de lijst, niet bij de wens waar je
  // hem aantikte. Stond hij in de wens zelf — en bij een verstuurde wens staat
  // die inhoud alleen te lezen zolang hij openstaat — dan nam elk dichtklappen
  // de afbeelding meteen weer mee, en zag je hem dus niet.
  const [viewing, setViewing] = useState<Viewing | null>(null)
  const closeViewer = useCallback(() => setViewing(null), [])
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useAutoGrow(inputRef, draft)

  const refresh = useCallback(async () => {
    try {
      setWishes(await listWishes())
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.wishes.unknownError)
    }
  }, [t])

  useEffect(() => {
    void refresh()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    void add()
  }

  // Het veld is een textarea om te kunnen meegroeien, maar gedraagt zich als
  // een invoerregel: enter voegt toe, shift+enter maakt wel een nieuwe regel.
  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    void add()
  }

  async function add() {
    const title = draft.trim()
    if (!title || sending) return

    setSending(true)
    setError('')
    try {
      // Dit maakt een concept aan en start niets. Versturen is een aparte
      // handeling op de kaart hieronder.
      await createWish(title, '', model)
      setDraft('')
      inputRef.current?.focus()
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.wishes.unknownError)
    } finally {
      setSending(false)
    }
  }

  function toggle(id: string) {
    setExpanded((current) =>
      current.includes(id) ? current.filter((open) => open !== id) : [...current, id],
    )
  }

  async function remove(id: string) {
    try {
      await removeWish(id)
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.wishes.unknownError)
    }
  }

  return (
    <div className="wishes">
      <form className="wishes__add sticky-top" onSubmit={submit}>
        <textarea
          ref={inputRef}
          className="wishes__input"
          value={draft}
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t.wishes.placeholder}
          aria-label={t.wishes.inputLabel}
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
        />
        <button
          className="wishes__submit"
          type="submit"
          disabled={sending || !draft.trim()}
          aria-label={t.wishes.addLabel}
        >
          <Plus size={17} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </form>

      {error && (
        <p className="wish__error" role="alert">
          {error}
        </p>
      )}

      {wishes.length === 0 ? (
        <p className="wishes__empty">{t.wishes.empty}</p>
      ) : (
        <ul className="wishes__list">
          {wishes.map((wish) => {
            // Een concept is een formulier waar je in typt; dat inklappen zou
            // je eigen tekst wegstoppen.
            const isDraft = wish.status === 'draft'
            const open = isDraft || expanded.includes(wish.id)

            return (
              <li key={wish.id} className="wish">
                <div className="wish__head">
                  {!isDraft && (
                    <button
                      className="wish__toggle"
                      type="button"
                      onClick={() => toggle(wish.id)}
                      aria-expanded={open}
                    >
                      {open ? (
                        <ChevronDown
                          className="wish__chevron"
                          size={14}
                          strokeWidth={1.4}
                          aria-hidden="true"
                        />
                      ) : (
                        <ChevronRight
                          className="wish__chevron"
                          size={14}
                          strokeWidth={1.4}
                          aria-hidden="true"
                        />
                      )}
                      <span className="wish__title">{wish.title}</span>
                    </button>
                  )}
                  <RemoveButton wish={wish} onRemove={() => remove(wish.id)} />
                </div>

                {isDraft ? (
                  <Draft
                    wish={wish}
                    onChanged={refresh}
                    onView={(attachment) => setViewing({ wishId: wish.id, attachment })}
                  />
                ) : (
                  open && (
                    <>
                      {wish.detail && <p className="wish__detail-text">{wish.detail}</p>}
                      {(wish.attachments ?? []).length > 0 && (
                        <div className="wish__attachments">
                          {wish.attachments!.map((attachment) => (
                            <span key={attachment.key} className="wish__attachment">
                              <Screenshot
                                wishId={wish.id}
                                attachment={attachment}
                                onOpen={() => setViewing({ wishId: wish.id, attachment })}
                              />
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )
                )}

                {/* De status blijft staan: ingeklapt wil je nog steeds zien
                    waar een wens is, en de teller loopt gewoon door. */}
                <div className="wish__foot">
                  <span className={`wish__status wish__status--${wish.status}`}>
                    {statusLabel(wish.status, t)}
                  </span>
                  <Progress wish={wish} />
                  {wish.commit && <span className="wish__commit">{wish.commit}</span>}
                </div>

                {open && wish.error && (
                  <pre className="wish__failure">{wish.error.slice(-1200)}</pre>
                )}

                {open && <Thread wish={wish} onReplied={refresh} />}
              </li>
            )
          })}
        </ul>
      )}

      {viewing && (
        <Viewer
          wishId={viewing.wishId}
          attachment={viewing.attachment}
          onClose={closeViewer}
        />
      )}
    </div>
  )
}

/**
 * Een concept: hier maak je de wens af. Zolang je hier zit draait er niets, dus
 * je kunt rustig typen, bijschaven en pas versturen als het klopt.
 */
function Draft({
  wish,
  onChanged,
  onView,
}: {
  wish: Wish
  onChanged: () => Promise<void>
  onView: (attachment: Attachment) => void
}) {
  const { t } = useLanguage()
  const [title, setTitle] = useState(wish.title)
  const [detail, setDetail] = useState(wish.detail ?? '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  // Lokaal bijgehouden zodat een miniatuur meteen verschijnt, zonder te
  // wachten op de volgende poll.
  const [attachments, setAttachments] = useState<Attachment[]>(wish.attachments ?? [])
  const [attaching, setAttaching] = useState(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)

  useAutoGrow(titleRef, title)

  async function attach(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    // Leegmaken, anders vuurt onChange niet als je hetzelfde bestand nog eens
    // kiest.
    event.target.value = ''
    if (files.length === 0) return

    setAttaching(true)
    setError('')
    try {
      for (const file of files) {
        const added = await addAttachment(wish.id, await prepareImage(file))
        setAttachments((current) => [...current, added])
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.wishes.attachFailed)
    } finally {
      setAttaching(false)
    }
  }

  async function detach(key: string) {
    setAttachments((current) => current.filter((a) => a.key !== key))
    try {
      await removeAttachment(wish.id, key)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.wishes.unknownError)
    }
  }

  // Bewaren gebeurt bij verlaten van een veld: opslaan bij elke toetsaanslag
  // zou de server bestoken, en het polling-interval zou je tekst terugdraaien.
  async function save() {
    if (title.trim() === wish.title && detail === (wish.detail ?? '')) return
    try {
      await updateWish(wish.id, { title: title.trim() || wish.title, detail })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.wishes.unknownError)
    }
  }

  async function send() {
    setSending(true)
    setError('')
    try {
      await updateWish(wish.id, { title: title.trim() || wish.title, detail })
      await submitWish(wish.id)
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.wishes.unknownError)
      setSending(false)
    }
  }

  return (
    <div className="draft">
      {/* Een textarea om te kunnen meegroeien met een lange titel, maar het
          blijft één regel tekst: enter sluit het veld af in plaats van er een
          regel bij te zetten. */}
      <textarea
        ref={titleRef}
        className="draft__title"
        value={title}
        rows={1}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          event.currentTarget.blur()
        }}
        onBlur={save}
        aria-label={t.wishes.inputLabel}
        enterKeyHint="done"
        autoComplete="off"
      />
      <textarea
        className="draft__detail"
        value={detail}
        rows={3}
        placeholder={t.wishes.detailPlaceholder}
        aria-label={t.wishes.detailLabel}
        onChange={(event) => setDetail(event.target.value)}
        onBlur={save}
      />
      <div className="wish__attachments">
        {attachments.map((attachment) => (
          <span key={attachment.key} className="wish__attachment">
            <Screenshot
              wishId={wish.id}
              attachment={attachment}
              onOpen={() => onView(attachment)}
            />
            <button
              className="wish__attachment-remove"
              type="button"
              onClick={() => detach(attachment.key)}
              aria-label={t.wishes.removeScreenshot}
            >
              <X size={11} strokeWidth={1.4} aria-hidden="true" />
            </button>
          </span>
        ))}

        <label className="wish__attach">
          <ImagePlus size={13} strokeWidth={1.4} aria-hidden="true" />
          {attaching ? t.wishes.attaching : t.wishes.attachScreenshot}
          <input type="file" accept="image/*" multiple onChange={attach} />
        </label>
      </div>

      <button
        className="draft__send"
        type="button"
        onClick={send}
        disabled={sending || attaching || !title.trim()}
      >
        <Send size={12} strokeWidth={1.4} aria-hidden="true" />
        {sending ? t.wishes.sending : t.wishes.submit}
      </button>
      <p className="draft__hint">{t.wishes.draftHint}</p>
      {error && (
        <span className="wish__error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

/**
 * Een miniatuur van 3,5 rem is genoeg om te zien dát er een schermafdruk bij
 * zit, niet om te lezen wat erop staat. Een druk erop vraagt de lijst om hem
 * schermvullend te zetten.
 */
function Screenshot({
  wishId,
  attachment,
  onOpen,
}: {
  wishId: string
  attachment: Attachment
  onOpen: () => void
}) {
  const { t } = useLanguage()

  return (
    <button
      className="wish__attachment-open"
      type="button"
      onClick={onOpen}
      aria-label={t.wishes.openScreenshot(attachment.name)}
    >
      <img src={attachmentUrl(wishId, attachment.key)} alt={attachment.name} />
    </button>
  )
}

/**
 * De schermafdruk schermvullend. Escape of een druk ernaast klapt hem weer
 * dicht; hij hangt aan de lijst, dus wat er met de wens eronder gebeurt —
 * dichtklappen, een poll die de lijst vervangt — raakt hem niet.
 */
function Viewer({
  wishId,
  attachment,
  onClose,
}: {
  wishId: string
  attachment: Attachment
  onClose: () => void
}) {
  const { t } = useLanguage()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={attachment.name}
      onClick={onClose}
    >
      <button
        className="viewer__close"
        type="button"
        onClick={onClose}
        aria-label={t.wishes.closeScreenshot}
      >
        <X size={15} strokeWidth={1.4} aria-hidden="true" />
      </button>
      <img
        className="viewer__image"
        src={attachmentUrl(wishId, attachment.key)}
        alt={attachment.name}
      />
    </div>
  )
}

/**
 * Weggooien tijdens een run breekt die run af. Dat is ingrijpend genoeg om
 * eerst te vragen — en zonder waarschuwing lijkt het kruisje hetzelfde te doen
 * als bij een afgeronde wens.
 */
function RemoveButton({ wish, onRemove }: { wish: Wish; onRemove: () => void }) {
  const { t } = useLanguage()
  const [asking, setAsking] = useState(false)

  if (asking) {
    return (
      <span className="wish__confirm">
        <span className="wish__confirm-text">{t.wishes.stopConfirm}</span>
        <button className="wish__confirm-yes" type="button" onClick={onRemove}>
          {t.wishes.stopYes}
        </button>
        <button
          className="wish__confirm-no"
          type="button"
          onClick={() => setAsking(false)}
        >
          {t.wishes.stopNo}
        </button>
      </span>
    )
  }

  return (
    <button
      className="wish__remove"
      type="button"
      onClick={() => (isRunning(wish.status) ? setAsking(true) : onRemove())}
      aria-label={t.wishes.remove(wish.title)}
    >
      <X size={14} strokeWidth={1.4} aria-hidden="true" />
    </button>
  )
}

/**
 * Waar de agent nu is, met de tijd die deze stap al kost.
 *
 * "Wordt gebouwd" stond er van clonen tot pushen, dus minutenlang hetzelfde
 * zonder dat je kon zien of er nog iets gebeurde. De stappen om Claude heen
 * duren voorspelbaar kort; loopt er een op, dan is dat een signaal. Bij Claude
 * zelf valt geen duur te beloven, en daar is de teller het enige eerlijke
 * antwoord: je ziet dát hij bezig is, niet hoe lang het nog duurt.
 */
function Progress({ wish }: { wish: Wish }) {
  const { t } = useLanguage()
  const [now, setNow] = useState(() => Date.now())

  const index = wish.step ? STEPS.indexOf(wish.step) : -1

  useEffect(() => {
    if (index < 0) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [index])

  if (index < 0) return null

  const started = wish.stepAt ? Date.parse(wish.stepAt) : NaN
  const seconds = Number.isNaN(started) ? null : Math.max(0, Math.round((now - started) / 1000))

  return (
    <span className="wish__step">
      {t.wishes.stepOf(index + 1, STEPS.length)} · {t.wishes.step[wish.step!]}
      {seconds !== null && ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
    </span>
  )
}

function Thread({ wish, onReplied }: { wish: Wish; onReplied: () => Promise<void> }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const messages = wish.messages ?? []
  // Alleen antwoorden als de agent daadwerkelijk wacht; anders zou je hem
  // midden in een run opnieuw starten.
  const canReply = wish.status === 'needs-answer' || wish.status === 'failed'

  if (messages.length === 0 && !canReply) return null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return

    setSending(true)
    setError('')
    try {
      await replyToWish(wish.id, text)
      setDraft('')
      await onReplied()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.wishes.unknownError)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="thread">
      {messages.map((message, index) => (
        <article
          key={`${message.at}-${index}`}
          className={message.role === 'claude' ? 'note-block note-block--claude' : 'note-block'}
        >
          <header className="note-block__who">
            {message.role === 'claude' ? t.wishes.replyFrom : t.wishes.replyYou}
          </header>
          {/* Wat Claude terugschrijft is markdown; wat jij intikt is precies wat
              je intikte, dus dat blijft staan zoals het staat. */}
          <div className="note-block__body">
            {message.role === 'claude' ? <Markdown text={message.text} /> : message.text}
          </div>
        </article>
      ))}

      {canReply && (
        <form className="thread__reply" onSubmit={submit}>
          <textarea
            className="thread__input"
            value={draft}
            rows={2}
            placeholder={t.wishes.replyPlaceholder}
            aria-label={t.wishes.replyLabel}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            className="thread__send"
            type="submit"
            disabled={sending || !draft.trim()}
          >
            <Send size={12} strokeWidth={1.4} aria-hidden="true" />
            {sending ? t.wishes.replySending : t.wishes.replySend}
          </button>
          <p className="thread__hint">{t.wishes.replyHint}</p>
          {error && (
            <span className="wish__error" role="alert">
              {error}
            </span>
          )}
        </form>
      )}
    </div>
  )
}
