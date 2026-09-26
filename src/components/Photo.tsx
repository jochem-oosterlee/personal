import { useState } from 'react'
import { Camera, X } from 'lucide-react'
import { prepareImage } from '../lib/images'
import type { PreparedImage } from '../lib/images'
import { extractGroceries } from '../lib/groceries'
import { useLanguage } from '../lib/language'
import { Suggestions } from './Suggestions'
import type { ExtractedTask } from '../lib/tasks'
import './Photo.css'

type PhotoProps = {
  /** Zet de aangevinkte voorstellen op het lijstje. */
  onAdd: (items: ExtractedTask[]) => void
  /** Klapt het fotovak dicht; de knop ernaartoe staat bij het invoerveld. */
  onClose: () => void
}

/**
 * Een foto van een briefje, een schap of een lege verpakking, waar Claude de
 * boodschappen uit haalt. Wat eruit komt is een voorstel: pas als je het
 * aanvinkt en toevoegt staat het op het lijstje — hetzelfde als bij het
 * plakvak bij Taken.
 *
 * Zoeken is een aparte druk, zodat een foto die niet gelukt is niets kost en
 * je hem eerst opnieuw kunt maken.
 */
export function Photo({ onAdd, onClose }: PhotoProps) {
  const { t } = useLanguage()
  const [image, setImage] = useState<PreparedImage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<{ key: string; items: ExtractedTask[] } | null>(null)

  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Leegmaken, anders vuurt onChange niet als je dezelfde foto nog eens kiest.
    event.target.value = ''
    if (!file) return

    setError(null)
    setFound(null)
    try {
      setImage(await prepareImage(file))
    } catch {
      setImage(null)
      setError(t.photo.unreadable)
    }
  }

  async function find() {
    if (!image) return

    setBusy(true)
    setError(null)
    setFound(null)

    try {
      const items = await extractGroceries(image)
      if (items.length === 0) {
        setError(t.photo.nothing)
        return
      }
      setFound({ key: crypto.randomUUID(), items: items.map((name) => ({ name })) })
    } catch {
      setError(t.photo.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="photo">
      <div className="photo__head">
        <span className="micro photo__title">{t.photo.title}</span>
        <button
          className="photo__close"
          type="button"
          onClick={onClose}
          aria-label={t.photo.close}
        >
          <X size={14} strokeWidth={1.4} aria-hidden="true" />
        </button>
      </div>

      {image && (
        <img
          className="photo__preview"
          src={`data:${image.type};base64,${image.data}`}
          alt={t.photo.preview}
        />
      )}

      {/* Een label in plaats van een knop: het bestandsveld erin opent op een
          telefoon de camera, en op een laptop de bestandskiezer. */}
      <label className="hairline-button photo__pick">
        <Camera size={12} strokeWidth={1.4} aria-hidden="true" />
        {image ? t.photo.again : t.photo.take}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => void pick(event)}
        />
      </label>

      <button
        className="hairline-button"
        type="button"
        disabled={busy || !image}
        onClick={() => void find()}
      >
        {busy ? t.photo.busy : t.photo.find}
      </button>

      {error && <p className="photo__error">{error}</p>}

      {found && (
        <Suggestions
          key={found.key}
          tasks={found.items}
          addLabel={t.photo.add}
          onAdd={(items) => {
            onAdd(items)
            onClose()
          }}
        />
      )}
    </div>
  )
}
