import { useState } from 'react'
import { X } from 'lucide-react'
import { extractTasks, MAX_TEXT } from '../lib/tasks'
import type { ExtractedTask } from '../lib/tasks'
import { useLanguage } from '../lib/language'
import { Suggestions } from './Suggestions'
import './Extract.css'

type ExtractProps = {
  /** Zet de aangevinkte voorstellen als taken in de lijst. */
  onAdd: (tasks: ExtractedTask[]) => void
  /** Klapt het plakvak dicht; de knop ernaartoe staat bij het invoerveld. */
  onClose: () => void
}

/**
 * Plakvak dat Claude actiepunten uit lopende tekst laat halen. Wat eruit komt
 * is een voorstel: pas als je het aanvinkt en toevoegt staat het in de lijst.
 * Staat alleen op het scherm als het openstaat — het icoon bij het invoerveld
 * klapt het open, zodat een taak intypen het eerste blijft wat je ziet.
 */
export function Extract({ onAdd, onClose }: ExtractProps) {
  const { t } = useLanguage()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<{ key: string; tasks: ExtractedTask[] } | null>(null)

  async function find() {
    setBusy(true)
    setError(null)
    setFound(null)

    try {
      const tasks = await extractTasks(text.trim())
      if (tasks.length === 0) {
        setError(t.extract.nothing)
        return
      }
      setFound({ key: crypto.randomUUID(), tasks })
    } catch {
      setError(t.extract.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="extract">
      <div className="extract__head">
        <span className="micro extract__title">{t.extract.title}</span>
        <button
          className="extract__close"
          type="button"
          onClick={onClose}
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
        className="hairline-button"
        type="button"
        disabled={busy || !text.trim()}
        onClick={() => void find()}
      >
        {busy ? t.extract.busy : t.extract.find}
      </button>

      {error && <p className="extract__error">{error}</p>}

      {found && (
        <Suggestions
          key={found.key}
          tasks={found.tasks}
          onAdd={(tasks) => {
            onAdd(tasks)
            onClose()
          }}
        />
      )}
    </div>
  )
}
