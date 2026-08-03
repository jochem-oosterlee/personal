import { useMemo, useRef, useState } from 'react'
import { usePersistentState } from '../../lib/storage'
import './ShoppingList.css'

type ShoppingItem = {
  id: string
  name: string
  done: boolean
  addedAt: number
}

export function ShoppingList() {
  const [items, setItems] = usePersistentState<ShoppingItem[]>('shopping.items', [])
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
    <div className="shopping">
      <form className="shopping__add" onSubmit={addItem}>
        <input
          ref={inputRef}
          className="shopping__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Wat heb je nodig?"
          aria-label="Nieuwe boodschap"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
        />
        <button className="shopping__submit" type="submit" disabled={!draft.trim()}>
          Toevoegen
        </button>
      </form>

      {items.length === 0 ? (
        <p className="shopping__empty">
          Je lijstje is leeg. Typ hierboven wat je nodig hebt.
        </p>
      ) : (
        <ul className="shopping__list">
          {sorted.map((item) => (
            <li key={item.id} className={item.done ? 'item item--done' : 'item'}>
              <label className="item__label">
                <input
                  className="item__check"
                  type="checkbox"
                  checked={item.done}
                  onChange={() => toggleItem(item.id)}
                />
                <span className="item__name">{item.name}</span>
              </label>
              <button
                className="item__remove"
                type="button"
                onClick={() => removeItem(item.id)}
                aria-label={`${item.name} verwijderen`}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <footer className="shopping__footer">
          <span>
            {doneCount} van {items.length} afgevinkt
          </span>
          <button
            className="shopping__clear"
            type="button"
            onClick={clearDone}
            disabled={doneCount === 0}
          >
            Afgevinkte wissen
          </button>
        </footer>
      )}
    </div>
  )
}
