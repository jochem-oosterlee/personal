import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Plus, Send, X } from 'lucide-react'
import { usePersistentState } from '../../lib/storage'
import { useLanguage } from '../../lib/language'
import {
  addComment,
  createIssue,
  getComments,
  getIssueStatus,
  prefillUrl,
  DEFAULT_MODEL,
} from '../../lib/github'
import type { Issue, IssueComment, IssueStatus, ModelId } from '../../lib/github'
import type { Translations } from '../../lib/translations'
import './Wishes.css'

type Wish = {
  id: string
  title: string
  detail: string
  createdAt: number
  issue?: Issue
  status?: IssueStatus
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

  async function send(wish: Wish) {
    // Without a token there is nothing to authenticate with, so hand the
    // request to GitHub's own form with everything filled in.
    if (!token) {
      window.open(prefillUrl(wish.title, wish.detail, model), '_blank', 'noopener')
      return
    }

    setSendingId(wish.id)
    setErrors((current) => ({ ...current, [wish.id]: '' }))

    try {
      const issue = await createIssue(token, wish.title, wish.detail, model, t.github)
      const status = await getIssueStatus(token, issue.number, t.github).catch(() => undefined)
      setWishes((current) =>
        current.map((item) => (item.id === wish.id ? { ...item, issue, status } : item)),
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
