/**
 * Actiepunten uit een geplakt stuk tekst. De server praat met Claude — hier
 * blijft alleen het verzoek over, net als bij wensen.
 */

/** Ruim boven een lange e-mail; de server weigert alles daarboven. */
export const MAX_TEXT = 20000

export type ExtractedTask = {
  name: string
  /** Day-precise deadline as `YYYY-MM-DD`, absent when the text names none. */
  dueAt?: string
}

/** Today in the same local `YYYY-MM-DD` shape the checklist uses. */
function todayKey(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export async function extractTasks(text: string): Promise<ExtractedTask[]> {
  const response = await fetch('/api/extract-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // De datum gaat mee: de server draait in UTC en zou "morgen" rond
    // middernacht een dag mis kunnen rekenen.
    body: JSON.stringify({ text, today: todayKey() }),
    cache: 'no-store',
  })

  if (!response.ok) throw new Error(`server antwoordde met ${response.status}`)

  const { tasks } = await response.json()
  return Array.isArray(tasks) ? tasks : []
}
