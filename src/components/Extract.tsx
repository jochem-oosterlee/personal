import { useState } from 'react'
import { Check, ClipboardList, X } from 'lucide-react'
import { extractTasks, MAX_TEXT } from '../lib/tasks'
import type { ExtractedTask } from '../lib/tasks'
import { useLanguage } from '../lib/language'
import './Extract.css'

type Suggestion = ExtractedTask & { id: string; picked: boolean }

type ExtractProps = {
  /** Zet de aangevinkte voorstellen als taken in de lijst. */
  onAdd: (tasks: ExtractedTask[]) => void
}

/** Kort en zonder jaartal: een voorstel staat maar even op het scherm. */
function formatDue(dueAt: string, language: string) {
  return new Date(`${dueAt}T00:00:00`).toLocaleDateString(language, {
    day: 'numeric',
    month: 'short',
  })
}

/**
 * Plakvak dat Claude actiepunten uit lopende tekst laat halen. Wat eruit komt
 * is een voorstel: pas als je het aanvinkt en toevoegt staat het in de lijst.
 * Dichtgeklapt is het één regel, zodat een taak intypen het eerste blijft wat
 * je ziet.
 */
export function Extract({ onAdd }: ExtractProps) {
  const { t, language } = useLanguage()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)

  function close() {
    setOpen(false)
    setText('')
    setBusy(false)
    setError(null)
    setSuggestions(null)
  }

  async function find() {
    setBusy(true)
    setError(null)
    setSuggestions(null)

    try {
      const found = await extractTasks(text.trim())
      if (found.length === 0) {
        setError(t.extract.nothing)
        return
      }
      setSuggestions(
        found.map((task) => ({ ...task, id: crypto.randomUUID(), picked: true })),
      )
    } catch {
      setError(t.extract.failed)
    } finally {
      setBusy(false)
    }
  }

  function toggle(id: string) {
    setSuggestions((current) =>
      (current ?? []).map((item) =>
        item.id === id ? { ...item, picked: !item.picked } : item,
      ),
    )
  }

  function add() {
    const picked = (suggestions ?? []).filter((item) => item.picked)
    if (picked.length === 0) return
    onAdd(picked.map(({ name, dueAt }) => ({ name, dueAt })))
    close()
  }

  if (!open) {
    return (
      <button className="extract__open" type="button" onClick={() => setOpen(true)}>
        <ClipboardList size={13} strokeWidth={1.4} aria-hidden="true" />
        {t.extract.open}
      </button>
    )
  }

  const pickedCount = (suggestions ?? []).filter((item) => item.picked).length

  return (
    <div className="extract">
      <div className="extract__head">
        <span className="micro extract__title">{t.extract.title}</span>
        <button
          className="extract__close"
          type="button"
          onClick={close}
          aria-label={t.extract.close}
        >
          <X size={14} strokeWidth={1.4} aria-hidden="true" />
        </button>
      </div>

      <textarea
        className="extract__text"
        value={text}
        rows={4}
        maxLength={MAX_TEXT}
        placeholder={t.extract.placeholder}
        aria-label={t.extract.title}
        onChange={(event) => setText(event.target.value)}
      />

      <button
        className="extract__button"
        type="button"
        disabled={busy || !text.trim()}
        onClick={() => void find()}
      >
        {busy ? t.extract.busy : t.extract.find}
      </button>

      {error && <p className="extract__error">{error}</p>}

      {suggestions && (
        <>
          <ul className="extract__list">
            {suggestions.map((item) => (
              <li key={item.id} className="suggestion">
                <label className="suggestion__label">
                  <input
                    className="suggestion__input"
                    type="checkbox"
                    checked={item.picked}
                    onChange={() => toggle(item.id)}
                  />
                  <span className="suggestion__box" aria-hidden="true">
                    <Check size={11} strokeWidth={2.5} />
                  </span>
                  <span className="suggestion__name">{item.name}</span>
                </label>
                {item.dueAt && (
                  <span className="suggestion__due">{formatDue(item.dueAt, language)}</span>
                )}
              </li>
            ))}
          </ul>

          <button
            className="extract__button"
            type="button"
            disabled={pickedCount === 0}
            onClick={add}
          >
            {t.extract.add(pickedCount)}
          </button>
        </>
      )}
    </div>
  )
}
