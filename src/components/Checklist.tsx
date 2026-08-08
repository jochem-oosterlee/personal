import { useMemo, useRef, useState } from 'react'
import { CalendarPlus, Check, Plus, X } from 'lucide-react'
import { usePersistentState } from '../lib/storage'
import { useLanguage } from '../lib/language'
import './Checklist.css'

type ChecklistItem = {
  id: string
  name: string
  done: boolean
  addedAt: number
  /** Day-precise deadline as `YYYY-MM-DD`, absent when the item has none. */
  dueAt?: string
}

type ChecklistProps = {
  /** Key under the `personal:` prefix in localStorage. */
  storageKey: string
  placeholder: string
  addLabel: string
  emptyText: string
  /** Show a deadline control per item. */
  deadlines?: boolean
}

/** Today in the same local `YYYY-MM-DD` shape a date input produces. */
function todayKey() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function formatDue(dueAt: string, language: string, today: string) {
  return new Date(`${dueAt}T00:00:00`).toLocaleDateString(language, {
    day: 'numeric',
    month: 'short',
    year: dueAt.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
  })
}

function dueClass(item: ChecklistItem, today: string) {
  if (!item.dueAt) return 'row__due row__due--empty'
  if (!item.done && item.dueAt < today) return 'row__due row__due--overdue'
  return 'row__due'
}

// A deadline sorts before one that is absent; the strings compare as dates.
function byDue(a: ChecklistItem, b: ChecklistItem) {
  if (a.dueAt === b.dueAt) return 0
  if (!a.dueAt) return 1
  if (!b.dueAt) return -1
  return a.dueAt < b.dueAt ? -1 : 1
}

export function Checklist({
  storageKey,
  placeholder,
  addLabel,
  emptyText,
  deadlines = false,
}: ChecklistProps) {
  const { t, language } = useLanguage()
  const [items, setItems] = usePersistentState<ChecklistItem[]>(storageKey, [])
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const today = todayKey()

  // Unchecked first, then checked — each group by deadline, then oldest to newest.
  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          Number(a.done) - Number(b.done) || byDue(a, b) || a.addedAt - b.addedAt,
      ),
    [items],
  )
  const doneCount = items.filter((item) => item.done).length

  function addItem(event: React.FormEvent) {
    event.preventDefault()
    const name = draft.trim()
    if (!name) return

    setItems((current) => [
      ...current,
      { id: crypto.randomUUID(), name, done: false, addedAt: Date.now() },
    ])
    setDraft('')
    inputRef.current?.focus()
  }

  function toggleItem(id: string) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
    )
  }

  function setDue(id: string, dueAt: string) {
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, dueAt: dueAt || undefined } : item,
      ),
    )
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id))
  }

  function clearDone() {
    setItems((current) => current.filter((item) => !item.done))
  }

  return (
    <div className="checklist">
      <form className="checklist__add sticky-top" onSubmit={addItem}>
        <input
          ref={inputRef}
          className="checklist__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          aria-label={addLabel}
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
        />
        <button
          className="checklist__submit"
          type="submit"
          disabled={!draft.trim()}
          aria-label={addLabel}
        >
          <Plus size={17} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </form>

      {items.length === 0 ? (
        <p className="checklist__empty">{emptyText}</p>
      ) : (
        <>
          <ul className="checklist__list">
            {sorted.map((item) => (
              <li key={item.id} className={item.done ? 'row row--done' : 'row'}>
                <label className="row__label">
                  <input
                    className="row__input"
                    type="checkbox"
                    checked={item.done}
                    onChange={() => toggleItem(item.id)}
                  />
                  <span className="row__box" aria-hidden="true">
                    <Check size={11} strokeWidth={2.5} />
                  </span>
                  <span className="row__name">{item.name}</span>
                </label>
                {deadlines && (
                  <div className={dueClass(item, today)}>
                    {/* The date input covers the face, so a tap opens the picker. */}
                    <span className="row__due-face">
                      {item.dueAt ? (
                        formatDue(item.dueAt, language, today)
                      ) : (
                        <CalendarPlus size={14} strokeWidth={1.4} aria-hidden="true" />
                      )}
                      <input
                        className="row__due-input"
                        type="date"
                        value={item.dueAt ?? ''}
                        onChange={(event) => setDue(item.id, event.target.value)}
                        aria-label={t.checklist.due(item.name)}
                      />
                    </span>
                  </div>
                )}
                <button
                  className="row__remove"
                  type="button"
                  onClick={() => removeItem(item.id)}
                  aria-label={t.checklist.remove(item.name)}
                >
                  <X size={14} strokeWidth={1.4} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>

          <footer className="checklist__footer">
            <span>{t.checklist.doneOf(doneCount, items.length)}</span>
            {doneCount > 0 && (
              <button className="checklist__clear" type="button" onClick={clearDone}>
                {t.checklist.clearDone}
              </button>
            )}
          </footer>
        </>
      )}
    </div>
  )
}
