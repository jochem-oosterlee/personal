import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Send, X } from 'lucide-react'
import { usePersistentState } from '../../lib/storage'
import { useLanguage } from '../../lib/language'
import { DEFAULT_MODEL } from '../../lib/models'
import type { ModelId } from '../../lib/models'
import { createWish, listWishes, removeWish, replyToWish } from '../../lib/wishes'
import type { Wish, WishStatus } from '../../lib/wishes'
import type { Translations } from '../../lib/translations'
import './Wishes.css'

// Kort genoeg om te volgen wat de agent doet, ruim genoeg om de eigen API niet
// onnodig te belasten. Er zit geen limiet meer op zoals bij de GitHub-API.
const POLL_INTERVAL_MS = 5_000

function statusLabel(status: WishStatus, t: Translations): string {
  switch (status) {
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

export function Wishes() {
  const { t } = useLanguage()
  const [model] = usePersistentState<ModelId>('settings.model', DEFAULT_MODEL)
  const [wishes, setWishes] = useState<Wish[]>([])
  const [draft, setDraft] = useState('')
  const [detail, setDetail] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

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

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const title = draft.trim()
    if (!title) return

    setSending(true)
    setError('')
    try {
      await createWish(title, detail.trim(), model)
      setDraft('')
      setDetail('')
      inputRef.current?.focus()
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.wishes.unknownError)
    } finally {
      setSending(false)
    }
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
          {wishes.map((wish) => (
            <li key={wish.id} className="wish">
              <div className="wish__head">
                <span className="wish__title">{wish.title}</span>
                <button
                  className="wish__remove"
                  type="button"
                  onClick={() => remove(wish.id)}
                  aria-label={t.wishes.remove(wish.title)}
                >
                  <X size={14} strokeWidth={1.4} aria-hidden="true" />
                </button>
              </div>

              {wish.detail && <p className="wish__detail-text">{wish.detail}</p>}

              <div className="wish__foot">
                <span className={`wish__status wish__status--${wish.status}`}>
                  {statusLabel(wish.status, t)}
                </span>
                {wish.commit && <span className="wish__commit">{wish.commit}</span>}
              </div>

              {wish.error && (
                <pre className="wish__failure">{wish.error.slice(-1200)}</pre>
              )}

              <Thread wish={wish} onReplied={refresh} />
            </li>
          ))}
        </ul>
      )}
    </div>
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
          <div className="note-block__body">{message.text}</div>
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
