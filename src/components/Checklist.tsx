import { useMemo, useRef, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { usePersistentState } from '../lib/storage'
import './Checklist.css'

type ChecklistItem = {
  id: string
  name: string
  done: boolean
  addedAt: number
}

type ChecklistProps = {
  /** Key under the `personal:` prefix in localStorage. */
  storageKey: string
  placeholder: string
  addLabel: string
  emptyText: string
}

export function Checklist({
  storageKey,
  placeholder,
  addLabel,
  emptyText,
}: ChecklistProps) {
  const [items, setItems] = usePersistentState<ChecklistItem[]>(storageKey, [])
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Unchecked first, then checked — each group oldest to newest.
  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) => Number(a.done) - Number(b.done) || a.addedAt - b.addedAt,
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
                <button
                  className="row__remove"
                  type="button"
                  onClick={() => removeItem(item.id)}
                  aria-label={`${item.name} verwijderen`}
                >
                  <X size={14} strokeWidth={1.4} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>

          <footer className="checklist__footer">
            <span>
              {doneCount} van {items.length} afgevinkt
            </span>
            {doneCount > 0 && (
              <button className="checklist__clear" type="button" onClick={clearDone}>
                Wis afgevinkte
              </button>
            )}
          </footer>
        </>
      )}
    </div>
  )
}
