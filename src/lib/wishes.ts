/**
 * Wensen via de eigen API in plaats van GitHub-issues.
 *
 * Hiervoor liep dit over de GitHub-API met een persoonlijk token in
 * localStorage: issues aanmaken, comments pollen, labels zetten. Dat token is
 * hiermee overbodig — de app praat alleen nog met zijn eigen backend, en die
 * zit achter IAP.
 */

export type WishStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'needs-answer'
  | 'done'
  | 'failed'

export type WishMessage = {
  role: 'claude' | 'user'
  text: string
  at: string
}

/** In volgorde; alleen 'claude' heeft geen voorspelbare duur. */
export const STEPS = ['clone', 'claude', 'install', 'build', 'lint', 'push'] as const

export type WishStep = (typeof STEPS)[number]

export type Attachment = {
  key: string
  name: string
  type: string
  size: number
}

export type Wish = {
  id: string
  title: string
  detail: string
  attachments?: Attachment[]
  model: string
  status: WishStatus
  messages?: WishMessage[]
  /** Waar de agent nu is. Alleen gevuld zolang hij draait. */
  step?: WishStep
  /** ISO-tijd waarop die stap begon, voor de verstreken tijd. */
  stepAt?: string
  commit?: string
  branch?: string
  error?: string
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(body || `server antwoordde met ${response.status}`)
  }
  return response
}

export async function listWishes(): Promise<Wish[]> {
  return (await call('/api/wishes')).json()
}

export async function createWish(
  title: string,
  detail: string,
  model: string,
): Promise<string> {
  const response = await call('/api/wishes', {
    method: 'POST',
    body: JSON.stringify({ title, detail, model }),
  })
  const { id } = await response.json()
  return id
}

/** Bijwerken kan zolang de wens een concept is; daarna weigert de server het. */
export async function updateWish(
  id: string,
  fields: { title?: string; detail?: string; model?: string },
): Promise<void> {
  await call(`/api/wishes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

/** Pas hier vertrekt de agent. */
export async function submitWish(id: string): Promise<void> {
  await call(`/api/wishes/${id}/submit`, { method: 'POST' })
}

/** Antwoord op een vraag; zet de agent opnieuw aan het werk. */
export async function replyToWish(id: string, text: string): Promise<void> {
  await call(`/api/wishes/${id}/reply`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

/** De bucket staat dicht, dus de afbeelding komt via de eigen API en dus langs IAP. */
export function attachmentUrl(wishId: string, key: string): string {
  return `/api/wishes/${wishId}/attachments/${key}`
}

export async function addAttachment(
  wishId: string,
  image: { data: string; type: string; name: string },
): Promise<Attachment> {
  const response = await call(`/api/wishes/${wishId}/attachments`, {
    method: 'POST',
    body: JSON.stringify(image),
  })
  return response.json()
}

export async function removeAttachment(wishId: string, key: string): Promise<void> {
  await call(`/api/wishes/${wishId}/attachments/${key}`, { method: 'DELETE' })
}

export async function removeWish(id: string): Promise<void> {
  await call(`/api/wishes/${id}`, { method: 'DELETE' })
}
