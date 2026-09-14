/**
 * Mail via de eigen API. Net als bij wensen praat de app alleen met zijn eigen
 * backend: daar staat de Gmail-koppeling, hier blijft het verzoek over.
 *
 * Niets hiervan gaat naar localStorage. Een mailbox is geen lijstje dat je
 * offline bijhoudt — wat je ziet is wat er op dat moment staat.
 */

/** Gelijk aan wat de server accepteert. */
export const MAX_MAIL = 10000

export type MailThread = {
  id: string
  subject: string
  from: string
  /** ISO-tijd van het laatste bericht; null als de mail geen datum had. */
  date: string | null
  snippet: string
  count: number
  unread: boolean
  starred: boolean
}

export type MailMessage = {
  id: string
  from: string
  to: string
  date: string | null
  unread: boolean
  body: string
  attachments: { name: string; size: number }[]
}

export type MailDetail = {
  id: string
  subject: string
  messages: MailMessage[]
  /** Waar een antwoord heen gaat. `name` is voor het scherm, de rest weet de server. */
  reply: { name: string; subject: string }
}

export type MailBox = 'inbox' | 'unread' | 'starred'

/** Nog geen koppeling is iets anders dan een storing; de module zegt dat apart. */
export class NotLinkedError extends Error {}

/** Het secret staat er wel, maar de service mag er niet bij. */
export class NoAccessError extends Error {}

/** Gmail's quotum is vol. Geen storing: over een minuut lukt het weer. */
export class BusyError extends Error {}

export async function call(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })

  if (!response.ok) {
    if (response.status === 503 || response.status === 429) {
      const body = await response.json().catch(() => ({}))
      if (body?.code === 'gmail-niet-gekoppeld') throw new NotLinkedError()
      if (body?.code === 'gmail-geen-toegang') throw new NoAccessError()
      if (body?.code === 'gmail-druk') throw new BusyError()
    }
    throw new Error(`server antwoordde met ${response.status}`)
  }

  return response
}

export async function listThreads(box: MailBox, search: string): Promise<MailThread[]> {
  const params = new URLSearchParams(search.trim() ? { q: search.trim() } : { box })
  const { threads } = await (await call(`/api/mail/threads?${params}`)).json()
  return Array.isArray(threads) ? threads : []
}

export async function getThread(id: string): Promise<MailDetail> {
  return (await call(`/api/mail/threads/${encodeURIComponent(id)}`)).json()
}

/** Archiveren is INBOX weghalen, gelezen is UNREAD weghalen. */
export async function setLabels(
  id: string,
  change: { add?: string[]; remove?: string[] },
): Promise<void> {
  await call(`/api/mail/threads/${encodeURIComponent(id)}/labels`, {
    method: 'POST',
    body: JSON.stringify(change),
  })
}

export async function reply(id: string, text: string): Promise<void> {
  await call(`/api/mail/threads/${encodeURIComponent(id)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export async function send(to: string, subject: string, text: string): Promise<void> {
  await call('/api/mail/send', {
    method: 'POST',
    body: JSON.stringify({ to, subject, text }),
  })
}

/** Het adres dat verstuurt; de app zet het bij de verstuurknop. */
export async function senderAddress(): Promise<string> {
  const { address } = await (await call('/api/mail/profile')).json()
  return typeof address === 'string' ? address : ''
}

/** Wat je uit een samenvatting kunt weglaten. De server vertaalt het. */
export type SummarySkip = 'promotions' | 'updates' | 'cc'

export const SKIPS: SummarySkip[] = ['promotions', 'updates', 'cc']

export type Summary = {
  /** Markdown; leeg als er in die periode niets binnenkwam. */
  text: string
  threads: number
  messages: number
  /** Hoeveel berichten je vinkjes hebben weggelaten. */
  skipped: number
  /** De periode paste niet helemaal; er is ingekort. */
  truncated: boolean
}

/**
 * Duurt lang genoeg om op te wachten: elke draad wordt volledig opgehaald en
 * gaat daarna langs Claude. Alleen op verzoek dus, nooit vanzelf.
 */
export async function summarise(
  from: Date,
  to: Date | null,
  skip: SummarySkip[],
  instructions: string,
): Promise<Summary> {
  const response = await call('/api/mail/summary', {
    method: 'POST',
    body: JSON.stringify({
      from: from.toISOString(),
      to: to ? to.toISOString() : null,
      skip,
      instructions,
    }),
  })

  return response.json()
}
