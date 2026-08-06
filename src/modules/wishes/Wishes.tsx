import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Plus, Send, X } from 'lucide-react'
import { usePersistentState } from '../../lib/storage'
import { createIssue, getIssueStatus, prefillUrl, DEFAULT_MODEL } from '../../lib/github'
import type { Issue, IssueStatus, ModelId } from '../../lib/github'
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

function statusLabel(status: IssueStatus): string {
  switch (statusKind(status)) {
    case 'progress':
      return 'Wordt opgepakt'
    case 'done':
      return 'Voltooid'
    case 'rejected':
      return 'Niet uitgevoerd'
    default:
      return 'Open'
  }
}

export function Wishes() {
  const [wishes, setWishes] = usePersistentState<Wish[]>('wishes.items', [])
  const [token] = usePersistentState('settings.githubToken', '')
  const [model] = usePersistentState<ModelId>('settings.model', DEFAULT_MODEL)
  const [draft, setDraft] = useState('')
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const inputRef = useRef<HTMLInputElement>(null)

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
          getIssueStatus(token, wish.issue!.number).catch(() => undefined),
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
  }, [token, setWishes])

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
      const issue = await createIssue(token, wish.title, wish.detail, model)
      const status = await getIssueStatus(token, issue.number).catch(() => undefined)
      setWishes((current) =>
        current.map((item) => (item.id === wish.id ? { ...item, issue, status } : item)),
      )
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [wish.id]: error instanceof Error ? error.message : 'Onbekende fout.',
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
          placeholder="Wat mist er?"
          aria-label="Nieuwe wens"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
        />
        <button
          className="wishes__submit"
          type="submit"
          disabled={!draft.trim()}
          aria-label="Wens toevoegen"
        >
          <Plus size={17} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </form>

      {wishes.length === 0 ? (
        <p className="wishes__empty">
          Nog geen wensen. Schrijf op wat je mist; versturen kan later, ook
          offline opgeschreven.
        </p>
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
                  aria-label={`${wish.title} verwijderen`}
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
                      Issue #{wish.issue.number}
                    </a>
                    {wish.status && (
                      <span
                        className={`wish__status wish__status--${statusKind(wish.status)}`}
                      >
                        {statusLabel(wish.status)}
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
                      ? 'Versturen…'
                      : token
                        ? 'Maak issue aan'
                        : 'Openen op GitHub'}
                  </button>
                )}

                {errors[wish.id] && (
                  <span className="wish__error" role="alert">
                    {errors[wish.id]}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
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
      placeholder={disabled ? '' : 'Toelichting (optioneel)…'}
      aria-label="Toelichting"
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
