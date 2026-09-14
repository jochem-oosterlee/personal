/**
 * Eenmalige verhuizingen van opgeslagen gegevens. Draaien na de eerste
 * synchronisatie, zodat ze op de staat werken die de app ook echt toont.
 *
 * Elke migratie zet zijn eigen vlaggetje als laatste: breekt hij halverwege af
 * — tab dicht, opslag vol — dan draait hij de volgende keer opnieuw. Daarom
 * moet het resultaat ook bij een tweede run kloppen.
 */

import { readStored, writeStored } from './storage'

/** Meer dan het id is hier niet nodig; de rest van een taak gaat mee zoals hij is. */
type StoredTask = { id: string }

/**
 * De lijst onder Persoonlijk bleek werk te zijn. Die gaat eenmalig naar Werk,
 * achter de taken die daar al stonden, samengevoegd op id zodat een tweede run
 * niets dubbel zet.
 */
function moveTasksToWork() {
  if (readStored('tasks.movedToWork', false)) return

  const personal = readStored<StoredTask[]>('tasks.items', [])
  const work = readStored<StoredTask[]>('tasks.work.items', [])

  if (personal.length > 0) {
    const known = new Set(work.map((task) => task.id))
    writeStored('tasks.work.items', [
      ...work,
      ...personal.filter((task) => !known.has(task.id)),
    ])
    writeStored('tasks.items', [])

    // Anders opent Taken op een leeg Persoonlijk en lijkt alles weg.
    if (readStored('tasks.scope', 'personal') === 'personal') {
      writeStored('tasks.scope', 'work')
    }
  }

  writeStored('tasks.movedToWork', true)
}

/** Zoals de samenvatting ze bewaart; de tekst is wat Claude te lezen krijgt. */
type SummaryRule = { id: string; text: string; on: boolean }

/**
 * De aanwijzingen bij de samenvatting waren één tekstvak. Elke regel daaruit
 * wordt een eigen vinkje, zodat je "geen jira-onboardingtickets" even uit kunt
 * zetten in plaats van hem weg te halen en later opnieuw te typen.
 *
 * Regels die er al staan blijven staan en de tekst wordt pas leeggemaakt als
 * de regels geschreven zijn, zodat een halve run niets kost.
 */
function instructionsToRules() {
  if (readStored('mail.summary.rulesMigrated', false)) return

  const text = readStored('mail.summary.instructions', '')
  const lines = text
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)

  if (lines.length > 0) {
    const existing = readStored<SummaryRule[]>('mail.summary.rules', [])
    const known = new Set(existing.map((rule) => rule.text))

    writeStored('mail.summary.rules', [
      ...existing,
      ...lines
        .filter((line) => !known.has(line))
        .map((line) => ({ id: crypto.randomUUID(), text: line, on: true })),
    ])
    writeStored('mail.summary.instructions', '')
  }

  writeStored('mail.summary.rulesMigrated', true)
}

export function runMigrations(): void {
  moveTasksToWork()
  instructionsToRules()
}
