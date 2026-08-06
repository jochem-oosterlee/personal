import { useEffect, useRef, useState } from 'react'
import { ExternalLink, ImagePlus, Plus, Send, X } from 'lucide-react'
import { usePersistentState } from '../../lib/storage'
import { useLanguage } from '../../lib/language'
import {
  addComment,
  createIssue,
  getComments,
  getIssueStatus,
  prefillUrl,
  screenshotSection,
  uploadScreenshots,
  DEFAULT_MODEL,
} from '../../lib/github'
import type { Issue, IssueComment, IssueStatus, ModelId, Screenshot } from '../../lib/github'
import type { Translations } from '../../lib/translations'
import './Wishes.css'

type Attachment = Screenshot & { id: string }

type Wish = {
  id: string
  title: string
  detail: string
  createdAt: number
  issue?: Issue
  status?: IssueStatus
  attachments?: Attachment[]
}

// Big enough to keep detail readable in a screenshot, small enough to stay a
// modest file in the repo once base64-encoded.
const MAX_SCREENSHOT_DIMENSION = 1440

function compressScreenshot(file: File): Promise<Screenshot> {
  return new Promise((resolve, reject) => {
    // Een object-URL, geen data:-URL: een foto van 12 MB wordt als base64 een
    // string van zo'n 16 MB, en daar loopt Safari in een PWA op stuk voordat
    // het plaatje ook maar gedecodeerd is. Hier houdt de browser de bytes
    // gewoon vast en lezen we er alleen naar.
    const source = URL.createObjectURL(file)
    const image = new Image()

    image.onerror = () => {
      URL.revokeObjectURL(source)
      reject(new Error('image decode failed'))
    }

    image.onload = () => {
      try {
        const scale = Math.min(1, MAX_SCREENSHOT_DIMENSION / Math.max(image.width, image.height))
        const width = Math.round(image.width * scale)
        const height = Math.round(image.height * scale)

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('canvas unavailable')

        context.drawImage(image, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72)
        // Safari gooit geen fout als het exporteren niet lukt, maar geeft
        // "data:," terug — dat zou als lege bijlage doorgaan.
        if (!dataUrl.startsWith('data:image/jpeg')) throw new Error('canvas export failed')

        resolve({ dataUrl })
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(source)
      }
    }

    image.src = source
  })
}

// How often to poll while a wish's issue is still open — tight enough to feel
// live, loose enough to stay well under GitHub's rate limit.
const POLL_INTERVAL_MS = 30_000

function statusKind(status: IssueStatus): 'open' | 'progress' | 'done' | 'rejected' {
  if (status.state === 'open') return status.comments > 0 ? 'progress' : 'open'
  return status.reason === 'not_planned' ? 'rejected' : 'done'
}

function statusLabel(status: IssueStatus, t: Translations): string {
  switch (statusKind(status)) {
    case 'progress':
      return t.wishes.statusProgress
    case 'done':
      return t.wishes.statusDone
    case 'rejected':
      return t.wishes.statusRejected
    default:
      return t.wishes.statusOpen
  }
}

export function Wishes() {
  const { t } = useLanguage()
  const [wishes, setWishes] = usePersistentState<Wish[]>('wishes.items', [])
  const [token] = usePersistentState('settings.githubToken', '')
  const [model] = usePersistentState<ModelId>('settings.model', DEFAULT_MODEL)
  const [draft, setDraft] = useState('')
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  // Threads live in component state, not in the wish: they are a view of the
  // issue, and the tracking comments are far too long to keep in localStorage.
  const [threads, setThreads] = useState<Record<number, IssueComment[]>>({})
  const [openThreads, setOpenThreads] = useState<Record<number, boolean>>({})

  // Newest first, by creation — sorting on edit would yank a wish out from
  // under the cursor while you type in it.
  const sorted = [...wishes].sort((a, b) => b.createdAt - a.createdAt)

  // Read through a ref instead of depending on `wishes` directly, so editing
  // a wish's text doesn't tear down and restart the poll timer.
  const wishesRef = useRef(wishes)
  wishesRef.current = wishes

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      const pending = wishesRef.current.filter(
        (wish) => wish.issue && wish.status?.state !== 'closed',
      )
      if (pending.length === 0) return

      const statuses = await Promise.all(
        pending.map((wish) =>
          getIssueStatus(token, wish.issue!.number, t.github).catch(() => undefined),
        ),
      )
      if (cancelled) return

      setWishes((current) =>
        current.map((wish) => {
          const index = pending.findIndex((item) => item.id === wish.id)
          const status = index === -1 ? undefined : statuses[index]
          return status ? { ...wish, status } : wish
        }),
      )

      // Only where there is something to fetch, so an untouched wish costs one
      // request per cycle instead of two.
      const withComments = pending.filter((_, index) => (statuses[index]?.comments ?? 0) > 0)
      if (withComments.length === 0) return

      const fetched = await Promise.all(
        withComments.map((wish) =>
          getComments(token, wish.issue!.number, t.github).catch(() => undefined),
        ),
      )
      if (cancelled) return

      setThreads((current) => {
        const next = { ...current }
        withComments.forEach((wish, index) => {
          const comments = fetched[index]
          if (comments) next[wish.issue!.number] = comments
        })
        return next
      })
    }

    refresh()
    const interval = setInterval(refresh, POLL_INTERVAL_MS)
    function onVisible() {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [token, setWishes, t])

  function addWish(event: React.FormEvent) {
    event.preventDefault()
    const title = draft.trim()
    if (!title) return

    setWishes((current) => [
      ...current,
      { id: crypto.randomUUID(), title, detail: '', createdAt: Date.now() },
    ])
    setDraft('')
    inputRef.current?.focus()
  }

  function updateDetail(id: string, detail: string) {
    setWishes((current) =>
      current.map((wish) => (wish.id === id ? { ...wish, detail } : wish)),
    )
  }

  function removeWish(id: string) {
    setWishes((current) => current.filter((wish) => wish.id !== id))
  }

  async function addAttachments(id: string, files: File[]) {
    if (files.length === 0) return
    let failed = 0

    for (const file of files) {
      try {
        const screenshot = await compressScreenshot(file)
        setWishes((current) =>
          current.map((wish) =>
            wish.id === id
              ? {
                  ...wish,
                  attachments: [
                    ...(wish.attachments ?? []),
                    { ...screenshot, id: crypto.randomUUID() },
                  ],
                }
              : wish,
          ),
        )
      } catch {
        // Doorgaan met de rest van de selectie, maar het wél melden: hier
        // zwijgen betekent dat je een foto kiest en er niets gebeurt.
        failed += 1
      }
    }

    setErrors((current) => ({ ...current, [id]: failed ? t.wishes.attachFailed : '' }))
  }

  function removeAttachment(wishId: string, attachmentId: string) {
    setWishes((current) =>
      current.map((wish) =>
        wish.id === wishId
          ? { ...wish, attachments: wish.attachments?.filter((att) => att.id !== attachmentId) }
          : wish,
      ),
    )
  }

  async function send(wish: Wish) {
    // Without a token there is nothing to authenticate with, so hand the
    // request to GitHub's own form with everything filled in. Attachments
    // stay behind — that form takes screenshots via drag-and-drop instead.
    if (!token) {
      window.open(prefillUrl(wish.title, wish.detail, model), '_blank', 'noopener')
      return
    }

    setSendingId(wish.id)
    setErrors((current) => ({ ...current, [wish.id]: '' }))

    try {
      const uploaded = await uploadScreenshots(token, wish.attachments ?? [], t.github)
      const detail = uploaded.length
        ? `${wish.detail}\n\n${screenshotSection(uploaded)}`
        : wish.detail
      const issue = await createIssue(token, wish.title, detail, model, t.github)
      const status = await getIssueStatus(token, issue.number, t.github).catch(() => undefined)
      setWishes((current) =>
        current.map((item) =>
          item.id === wish.id ? { ...item, issue, status, attachments: undefined } : item,
        ),
      )
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [wish.id]: error instanceof Error ? error.message : t.wishes.unknownError,
      }))
    } finally {
      setSendingId(null)
    }
  }

  return (
    <div className="wishes">
      <form className="wishes__add sticky-top" onSubmit={addWish}>
        <input
          ref={inputRef}
          className="wishes__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t.wishes.placeholder}
          aria-label={t.wishes.inputLabel}
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
        />
        <button
          className="wishes__submit"
          type="submit"
          disabled={!draft.trim()}
          aria-label={t.wishes.addLabel}
        >
          <Plus size={17} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </form>

      {wishes.length === 0 ? (
        <p className="wishes__empty">{t.wishes.empty}</p>
      ) : (
        <ul className="wishes__list">
          {sorted.map((wish) => (
            <li key={wish.id} className="wish">
              <div className="wish__head">
                <span className="wish__title">{wish.title}</span>
                <button
                  className="wish__remove"
                  type="button"
                  onClick={() => removeWish(wish.id)}
                  aria-label={t.wishes.remove(wish.title)}
                >
                  <X size={14} strokeWidth={1.4} aria-hidden="true" />
                </button>
              </div>

              <DetailEditor
                text={wish.detail}
                disabled={Boolean(wish.issue)}
                onChange={(detail) => updateDetail(wish.id, detail)}
              />

              {token && !wish.issue && (
                <div className="wish__attachments">
                  {wish.attachments?.map((attachment) => (
                    <div className="wish__attachment" key={attachment.id}>
                      <img src={attachment.dataUrl} alt="" />
                      <button
                        className="wish__attachment-remove"
                        type="button"
                        onClick={() => removeAttachment(wish.id, attachment.id)}
                        aria-label={t.wishes.removeScreenshot}
                      >
                        <X size={12} strokeWidth={1.4} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  <label className="wish__attach">
                    <ImagePlus size={14} strokeWidth={1.5} aria-hidden="true" />
                    {t.wishes.attachScreenshot}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(event) => {
                        // Eerst de selectie vastleggen, dan pas het veld
                        // leegmaken — anders is er niets meer te lezen als
                        // je dezelfde foto nog eens kiest.
                        const files = Array.from(event.target.files ?? [])
                        event.target.value = ''
                        addAttachments(wish.id, files)
                      }}
                    />
                  </label>
                </div>
              )}

              <div className="wish__foot">
                {wish.issue ? (
                  <>
                    <a
                      className="wish__issue"
                      href={wish.issue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink size={12} strokeWidth={1.4} aria-hidden="true" />
                      {t.wishes.issue(wish.issue.number)}
                    </a>
                    {wish.status && (
                      <span
                        className={`wish__status wish__status--${statusKind(wish.status)}`}
                      >
                        {statusLabel(wish.status, t)}
                      </span>
                    )}
                  </>
                ) : (
                  <button
                    className="wish__send"
                    type="button"
                    disabled={sendingId === wish.id}
                    onClick={() => send(wish)}
                  >
                    <Send size={12} strokeWidth={1.4} aria-hidden="true" />
                    {sendingId === wish.id
                      ? t.wishes.sending
                      : token
                        ? t.wishes.createIssue
                        : t.wishes.openOnGithub}
                  </button>
                )}

                {errors[wish.id] && (
                  <span className="wish__error" role="alert">
                    {errors[wish.id]}
                  </span>
                )}
              </div>

              {wish.issue && (threads[wish.issue.number]?.length ?? 0) > 0 && (
                <Thread
                  comments={threads[wish.issue.number]}
                  open={openThreads[wish.issue.number] ?? true}
                  canReply={Boolean(token)}
                  onToggle={() =>
                    setOpenThreads((current) => ({
                      ...current,
                      [wish.issue!.number]: !(current[wish.issue!.number] ?? true),
                    }))
                  }
                  onReply={async (text) => {
                    const posted = await addComment(
                      token,
                      wish.issue!.number,
                      text,
                      t.github,
                    )
                    setThreads((current) => ({
                      ...current,
                      [wish.issue!.number]: [
                        ...(current[wish.issue!.number] ?? []),
                        posted,
                      ],
                    }))
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type ThreadProps = {
  comments: IssueComment[]
  open: boolean
  canReply: boolean
  onToggle: () => void
  onReply: (text: string) => Promise<void>
}

function Thread({ comments, open, canReply, onToggle, onReply }: ThreadProps) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return

    setSending(true)
    setError('')
    try {
      await onReply(text)
      setDraft('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.wishes.unknownError)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="thread">
      <button className="thread__toggle" type="button" onClick={onToggle}>
        {open ? t.wishes.hideThread : t.wishes.showThread(comments.length)}
      </button>

      {open && (
        <>
          {comments.map((comment) => (
            <article
              key={comment.id}
              className={comment.fromClaude ? 'note-block note-block--claude' : 'note-block'}
            >
              <header className="note-block__who">
                {comment.fromClaude ? t.wishes.replyFrom : comment.author}
              </header>
              <div className="note-block__body">{comment.body}</div>
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
        </>
      )}
    </div>
  )
}

type DetailEditorProps = {
  text: string
  disabled: boolean
  onChange: (text: string) => void
}

function DetailEditor({ text, disabled, onChange }: DetailEditorProps) {
  const { t } = useLanguage()
  const ref = useRef<HTMLTextAreaElement>(null)

  // Grow with the content instead of showing an inner scrollbar.
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [text])

  return (
    <textarea
      ref={ref}
      className="wish__detail"
      value={text}
      rows={1}
      disabled={disabled}
      placeholder={disabled ? '' : t.wishes.detailPlaceholder}
      aria-label={t.wishes.detailLabel}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
