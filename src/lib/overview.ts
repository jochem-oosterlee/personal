/**
 * Het overzicht: één levende lijst van draden die op iemand wachten.
 *
 * De server geeft wijzigingen terug, geen nieuwe lijst. Hier staat hoe die op
 * de lijst worden toegepast — los van React, zodat het te toetsen is. De
 * regels waar het om gaat:
 *
 * - Een draad is de identiteit. Twee regels over dezelfde draad bestaan niet.
 * - Weggekruist (dismissed) is weg: komt nooit terug, ook niet via toevoegen.
 * - Afgevinkt (done) is afgehandeld, maar nieuwe mail in die draad mag hem
 *   heropenen — dat is echt nieuwe informatie.
 * - Wat Claude sluit blijft even zichtbaar met de reden, en is terug te draaien.
 */

import { call } from './mail'

/**
 * Een eigen aanwijzing als vinkje. Uitzetten laat hem staan voor later;
 * weggooien is het kruisje. Zo hoef je "geen jira-onboardingtickets" niet
 * opnieuw te typen als je hem een keer wél wilt zien. Geldt voor de
 * samenvatting én het overzicht.
 */
export type SummaryRule = { id: string; text: string; on: boolean }

/** Wat aanstaat, als tekst voor het model. Uitgezette regels blijven bewaard. */
export function activeInstructions(rules: SummaryRule[]): string {
  return rules
    .filter((rule) => rule.on)
    .map((rule) => `- ${rule.text}`)
    .join('\n')
}

export type OverviewStatus = 'open' | 'waiting' | 'done' | 'dismissed'

export type OverviewItem = {
  id: string
  threadId: string
  title: string
  /** Wie er iets wil, of op wie je wacht. */
  who: string
  status: OverviewStatus
  /** Wanneer de regel in het overzicht kwam. */
  since: string
  /** Wat er het laatst gebeurde, één zin. */
  lastChange: string
  updatedAt: string
  /** Alleen bij done: waaruit bleek dat het klaar was, en wie dat besloot. */
  closedReason?: string
  closedBy?: 'claude' | 'you'
  closedAt?: string
}

export type OverviewChanges = {
  add: { threadId: string; title: string; who: string; status: 'open' | 'waiting'; lastChange: string }[]
  update: { id: string; title?: string; who?: string; status?: 'open' | 'waiting'; lastChange: string }[]
  close: { id: string; reason: string }[]
}

export type OverviewUpdate = {
  changes: OverviewChanges
  log: string
  from: string
  until: string
  messages: number
  threads: number
  skipped: number
  truncated: boolean
}

export type LogEntry = {
  at: string
  from: string
  text: string
  messages: number
  added: number
  updated: number
  closed: number
}

/** Zoveel afgevinkte regels onthouden we; de weggekruiste altijd, die zijn klein. */
const MAX_DONE = 100

const MAX_LOG = 30

/** Past wijzigingen toe. Geeft altijd een nieuwe lijst terug. */
export function applyChanges(
  items: OverviewItem[],
  changes: OverviewChanges,
  now: string,
  newId: () => string = () => crypto.randomUUID(),
): OverviewItem[] {
  let next = items.map((item) => ({ ...item }))
  const byId = () => new Map(next.map((item) => [item.id, item]))
  const byThread = () => new Map(next.map((item) => [item.threadId, item]))

  for (const add of changes.add) {
    const existing = byThread().get(add.threadId)

    if (existing?.status === 'dismissed') continue

    if (existing) {
      // Afgevinkt en er is nieuwe mail: weer open. Al open: gewoon bijwerken.
      Object.assign(existing, {
        title: add.title || existing.title,
        who: add.who || existing.who,
        status: add.status,
        lastChange: add.lastChange,
        updatedAt: now,
        closedReason: undefined,
        closedBy: undefined,
        closedAt: undefined,
      })
      continue
    }

    next.push({
      id: newId(),
      threadId: add.threadId,
      title: add.title,
      who: add.who,
      status: add.status,
      since: now,
      lastChange: add.lastChange,
      updatedAt: now,
    })
  }

  for (const update of changes.update) {
    const item = byId().get(update.id)
    if (!item || item.status === 'dismissed') continue
    Object.assign(item, {
      title: update.title ?? item.title,
      who: update.who ?? item.who,
      status: update.status ?? (item.status === 'done' ? 'open' : item.status),
      lastChange: update.lastChange || item.lastChange,
      updatedAt: now,
      closedReason: undefined,
      closedBy: undefined,
      closedAt: undefined,
    })
  }

  for (const close of changes.close) {
    const item = byId().get(close.id)
    if (!item || item.status === 'dismissed' || item.status === 'done') continue
    Object.assign(item, {
      status: 'done',
      closedReason: close.reason,
      closedBy: 'claude',
      closedAt: now,
      updatedAt: now,
    })
  }

  return prune(next)
}

/** Jij vinkt af: afgehandeld, maar mag terug als er iets nieuws gebeurt. */
export function markDone(items: OverviewItem[], id: string, now: string): OverviewItem[] {
  return prune(
    items.map((item) =>
      item.id === id
        ? { ...item, status: 'done', closedBy: 'you', closedAt: now, updatedAt: now, closedReason: undefined }
        : item,
    ),
  )
}

/** Jij kruist weg: nooit meer. */
export function dismiss(items: OverviewItem[], id: string, now: string): OverviewItem[] {
  return items.map((item) =>
    item.id === id ? { ...item, status: 'dismissed', updatedAt: now } : item,
  )
}

/** Terugzetten wat Claude (of jij) sloot. */
export function reopen(items: OverviewItem[], id: string, now: string): OverviewItem[] {
  return items.map((item) =>
    item.id === id
      ? {
          ...item,
          status: 'open',
          updatedAt: now,
          closedReason: undefined,
          closedBy: undefined,
          closedAt: undefined,
        }
      : item,
  )
}

/** Afgevinkte regels lopen anders eindeloos op; de oudste vallen eraf. */
function prune(items: OverviewItem[]): OverviewItem[] {
  const done = items
    .filter((item) => item.status === 'done')
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
  const drop = new Set(done.slice(MAX_DONE).map((item) => item.id))
  return items.filter((item) => !drop.has(item.id))
}

export function appendLog(log: LogEntry[], entry: LogEntry): LogEntry[] {
  return [entry, ...log].slice(0, MAX_LOG)
}

export async function fetchOverviewUpdate(body: {
  since: string | null
  items: Pick<OverviewItem, 'id' | 'threadId' | 'title' | 'who' | 'status' | 'lastChange' | 'since'>[]
  done: string[]
  dismissed: string[]
  skip: string[]
  instructions: string
}): Promise<OverviewUpdate> {
  // Via dezelfde aanroep als de rest van Mail, zodat "Gmail is druk" en "niet
  // gekoppeld" hier dezelfde fouten opleveren.
  const response = await call('/api/mail/overview', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return response.json()
}
