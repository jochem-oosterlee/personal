import { useMemo, useRef, useState, type ReactNode } from 'react'
import { CalendarPlus, Check, ClipboardList, Plus, X } from 'lucide-react'
import { usePersistentState } from '../lib/storage'
import { useAutoGrow } from '../lib/autogrow'
import { useLanguage } from '../lib/language'
import { Extract } from './Extract'
import type { ExtractedTask } from '../lib/tasks'
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
  /** Show the icon next to the add button that opens the paste box. */
  extract?: boolean
  /** Rendered above the add field, inside the same sticky block. */
  tabs?: ReactNode
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
  extract = false,
  tabs,
}: ChecklistProps) {
  const { t, language } = useLanguage()
  const [items, setItems] = usePersistentState<ChecklistItem[]>(storageKey, [])
  const [draft, setDraft] = useState('')
  const [extractOpen, setExtractOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useAutoGrow(inputRef, draft)

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

  function addItem() {
    const name = draft.trim()
    if (!name) return

    setItems((current) => [
      ...current,
      { id: crypto.randomUUID(), name, done: false, addedAt: Date.now() },
    ])
    setDraft('')
    inputRef.current?.focus()
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    addItem()
  }

  // Het veld is een textarea om te kunnen meegroeien, maar gedraagt zich als
  // een invoerregel: enter voegt toe, shift+enter maakt wel een nieuwe regel.
  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    addItem()
  }

  /** Wat uit het plakvak komt, wordt hier een gewone taak als alle andere. */
  function addExtracted(tasks: ExtractedTask[]) {
    const at = Date.now()
    setItems((current) => [
      ...current,
      ...tasks.map((task, index) => ({
        id: crypto.randomUUID(),
        name: task.name,
        done: false,
        // Oplopend, zodat ze in de volgorde van de tekst blijven staan.
        addedAt: at + index,
        dueAt: task.dueAt,
      })),
    ])
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
      <div className="checklist__top sticky-top">
        {tabs}
        <form className="checklist__add" onSubmit={submit}>
          <textarea
            ref={inputRef}
            className="checklist__input"
            value={draft}
            rows={1}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
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
          {extract && (
            <button
              className={
                extractOpen
                  ? 'checklist__extract checklist__extract--open'
                  : 'checklist__extract'
              }
              type="button"
              aria-expanded={extractOpen}
              aria-label={extractOpen ? t.extract.close : t.extract.open}
              onClick={() => setExtractOpen((current) => !current)}
            >
              <ClipboardList size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
          )}
        </form>
      </div>

      {extract && extractOpen && (
        <Extract onAdd={addExtracted} onClose={() => setExtractOpen(false)} />
      )}

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
