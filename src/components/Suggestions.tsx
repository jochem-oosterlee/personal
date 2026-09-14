import { useState } from 'react'
import { Check } from 'lucide-react'
import { useLanguage } from '../lib/language'
import type { ExtractedTask } from '../lib/tasks'
import './Suggestions.css'

type SuggestionsProps = {
  /** Wat Claude voorstelt; pas na toevoegen staat het in de lijst. */
  tasks: ExtractedTask[]
  onAdd: (tasks: ExtractedTask[]) => void
}

type Picked = ExtractedTask & { id: string; picked: boolean }

/** Kort en zonder jaartal: een voorstel staat maar even op het scherm. */
function formatDue(dueAt: string, language: string) {
  return new Date(`${dueAt}T00:00:00`).toLocaleDateString(language, {
    day: 'numeric',
    month: 'short',
  })
}

/**
 * De keuzelijst tussen "Claude heeft dit gevonden" en "het staat in Taken".
 * Zowel het plakvak als Mail komen hier uit, dus staat hij los.
 *
 * De aankruisstand hoort bij één ronde voorstellen: geef de component een
 * `key` die per ronde verandert, dan begint hij schoon.
 */
export function Suggestions({ tasks, onAdd }: SuggestionsProps) {
  const { t, language } = useLanguage()
  const [items, setItems] = useState<Picked[]>(() =>
    tasks.map((task) => ({ ...task, id: crypto.randomUUID(), picked: true })),
  )

  const pickedCount = items.filter((item) => item.picked).length

  function toggle(id: string) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, picked: !item.picked } : item)),
    )
  }

  function add() {
    const picked = items.filter((item) => item.picked)
    if (picked.length === 0) return
    onAdd(picked.map(({ name, dueAt }) => ({ name, dueAt })))
  }

  return (
    <div className="suggestions">
      <ul className="suggestions__list">
        {items.map((item) => (
          <li key={item.id} className="suggestion">
            <label className="suggestion__label">
              <input
                className="tick-input"
                type="checkbox"
                checked={item.picked}
                onChange={() => toggle(item.id)}
              />
              <span className="tick" aria-hidden="true">
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
        className="hairline-button"
        type="button"
        disabled={pickedCount === 0}
        onClick={add}
      >
        {t.extract.add(pickedCount)}
      </button>
    </div>
  )
}
