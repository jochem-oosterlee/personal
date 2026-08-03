import { useEffect, useRef } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { usePersistentState } from '../../lib/storage'
import './Notes.css'

type Note = {
  id: string
  text: string
  createdAt: number
}

export function Notes() {
  const [notes, setNotes] = usePersistentState<Note[]>('notes.items', [])
  // Set when a note is created, so the fresh textarea can take focus.
  const focusId = useRef<string | null>(null)

  // Newest first, by creation — sorting on edit would yank a note out from
  // under the cursor while you type in it.
  const sorted = [...notes].sort((a, b) => b.createdAt - a.createdAt)

  function addNote() {
    const id = crypto.randomUUID()
    focusId.current = id
    setNotes((current) => [...current, { id, text: '', createdAt: Date.now() }])
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
      <button className="notes__add" type="button" onClick={addNote}>
        <Plus size={15} strokeWidth={1.5} aria-hidden="true" />
        Nieuwe notitie
      </button>

      {notes.length === 0 ? (
        <p className="notes__empty">Nog geen notities.</p>
      ) : (
        <ul className="notes__list">
          {sorted.map((note) => (
            <li key={note.id} className="note">
              <NoteEditor
                text={note.text}
                autoFocus={focusId.current === note.id}
                onChange={(text) => updateNote(note.id, text)}
              />
              <button
                className="note__remove"
                type="button"
                onClick={() => removeNote(note.id)}
                aria-label="Notitie verwijderen"
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
  autoFocus: boolean
  onChange: (text: string) => void
}

function NoteEditor({ text, autoFocus, onChange }: NoteEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Grow with the content instead of showing an inner scrollbar.
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [text])

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  return (
    <textarea
      ref={ref}
      className="note__text"
      value={text}
      rows={1}
      placeholder="Typ je notitie…"
      aria-label="Notitie"
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
