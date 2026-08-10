import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { usePersistentState } from '../../lib/storage'
import { useLanguage } from '../../lib/language'
import './Notes.css'

type Note = {
  id: string
  text: string
  createdAt: number
}

export function Notes() {
  const { t } = useLanguage()
  const [notes, setNotes] = usePersistentState<Note[]>('notes.items', [])
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Newest first, by creation — sorting on edit would yank a note out from
  // under the cursor while you type in it.
  const sorted = [...notes].sort((a, b) => b.createdAt - a.createdAt)

  function addNote(event: React.FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return

    setNotes((current) => [
      ...current,
      { id: crypto.randomUUID(), text, createdAt: Date.now() },
    ])
    setDraft('')
    inputRef.current?.focus()
  }

  function updateNote(id: string, text: string) {
    setNotes((current) =>
      current.map((note) => (note.id === id ? { ...note, text } : note)),
    )
  }

  function removeNote(id: string) {
    setNotes((current) => current.filter((note) => note.id !== id))
  }

  return (
    <div className="notes">
      <form className="notes__add sticky-top" onSubmit={addNote}>
        <input
          ref={inputRef}
          className="notes__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t.notes.placeholder}
          aria-label={t.notes.inputLabel}
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
        />
        <button
          className="notes__submit"
          type="submit"
          disabled={!draft.trim()}
          aria-label={t.notes.addLabel}
        >
          <Plus size={17} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </form>

      {notes.length === 0 ? (
        <p className="notes__empty">{t.notes.empty}</p>
      ) : (
        <ul className="notes__list">
          {sorted.map((note) => (
            <li key={note.id} className="note">
              <NoteEditor
                text={note.text}
                onChange={(text) => updateNote(note.id, text)}
              />
              <button
                className="note__remove"
                type="button"
                onClick={() => removeNote(note.id)}
                aria-label={t.notes.remove}
              >
                <Trash2 size={13} strokeWidth={1.4} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type NoteEditorProps = {
  text: string
  onChange: (text: string) => void
}

function NoteEditor({ text, onChange }: NoteEditorProps) {
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
      className="note__text"
      value={text}
      rows={1}
      placeholder={t.notes.placeholder}
      aria-label={t.notes.label}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
