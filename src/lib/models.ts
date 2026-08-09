/**
 * Welk model een wens bouwt. Stond eerst in lib/github.ts omdat de keuze via
 * de issue-body meeging; nu gaat hij mee in de API-aanroep en heeft het niets
 * meer met GitHub te maken.
 *
 * Houd deze lijst gelijk aan die in agent/index.js — daar wordt de waarde
 * gecontroleerd voordat hij het model bepaalt.
 */
export type ModelId = 'claude-opus-5' | 'claude-sonnet-5' | 'claude-haiku-4-5'

export const DEFAULT_MODEL: ModelId = 'claude-opus-5'

type Hint = { nl: string; en: string }

export const MODELS: { id: ModelId; label: string; hint: Hint }[] = [
  {
    id: 'claude-opus-5',
    label: 'Opus 5',
    hint: { nl: 'Sterkst; voor grotere wensen', en: 'Strongest; for bigger wishes' },
  },
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    hint: { nl: 'Sneller en goedkoper', en: 'Faster and cheaper' },
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    hint: { nl: 'Alleen kleine klusjes', en: 'Small jobs only' },
  },
]
