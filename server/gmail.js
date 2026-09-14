/**
 * Gmail via de eigen backend.
 *
 * De Gmail-connector van claude.ai is hier niet te gebruiken: dat is een door
 * Anthropic gehoste MCP-server (`gmail.mcp.claude.com`) waarvan de toestemming
 * aan het claude.ai-account hangt, niet aan iets wat deze service kan tonen.
 * Het `claude-oauth-token` geeft toegang tot het model, niet tot connectors.
 * Dus praat de server rechtstreeks met Gmail, met een eigen OAuth-client.
 *
 * Er is één gebruiker en die zit al achter IAP, dus is er geen consent-flow in
 * de app. Het refresh token wordt eenmalig lokaal opgehaald met
 * `infra/gmail-consent.mjs` en staat als JSON in Secret Manager onder
 * `gmail-oauth` — net als `claude-oauth-token` bij de eerste aanroep gelezen,
 * niet als env-var gemount.
 */

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? 'jochem-personal-pwa'
const SECRET = process.env.GMAIL_SECRET ?? 'gmail-oauth'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** Zo ver leest de app een bericht; daarboven is het een archiefstuk. */
const MAX_BODY_CHARS = 20000

/** Fout met deze code betekent: nog niet gekoppeld, geen storing. */
export const NOT_LINKED = 'gmail-niet-gekoppeld'

let credentials = null
let access = null

async function googleClient() {
  const { GoogleAuth } = await import('google-auth-library')
  const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' })
  return auth.getClient()
}

async function fetchCredentials() {
  if (credentials) return credentials

  let raw
  try {
    const client = await googleClient()
    const { data } = await client.request({
      url: `https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${SECRET}/versions/latest:access`,
    })
    raw = Buffer.from(data?.payload?.data ?? '', 'base64').toString('utf8').trim()
  } catch (error) {
    // Bestaat het secret niet, dan is Gmail simpelweg nog niet ingericht.
    const status = error?.response?.status
    if (status === 403 || status === 404) {
      throw Object.assign(new Error(`${SECRET} ontbreekt`), { code: NOT_LINKED })
    }
    throw error
  }

  if (!raw) throw Object.assign(new Error(`${SECRET} is leeg`), { code: NOT_LINKED })

  const parsed = JSON.parse(raw)
  for (const field of ['client_id', 'client_secret', 'refresh_token']) {
    if (!parsed?.[field]) throw new Error(`${SECRET} mist ${field}`)
  }

  credentials = parsed
  return parsed
}

/**
 * Een refresh token is lang houdbaar, een access token een uur. Bewaren scheelt
 * een rondje naar Google bij elke lijstweergave; een minuut marge vangt de
 * klokverschillen op.
 */
async function accessToken() {
  if (access && access.expiresAt > Date.now()) return access.token

  const { client_id, client_secret, refresh_token } = await fetchCredentials()

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id,
      client_secret,
      refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    // Ingetrokken toestemming of een verlopen token uit een testing-app: dan
    // helpt opnieuw proberen niet, maar opnieuw koppelen wel.
    credentials = null
    throw Object.assign(new Error(`token vernieuwen mislukte (${response.status}): ${body.slice(0, 300)}`), {
      code: response.status === 400 || response.status === 401 ? NOT_LINKED : undefined,
    })
  }

  const data = await response.json()
  access = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in ?? 3600) - 60) * 1000,
  }
  return access.token
}

async function gmail(pathname, init = {}) {
  const token = await accessToken()

  const response = await fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    // Een geweigerd token geneest bij de volgende poging.
    if (response.status === 401) access = null
    throw new Error(`Gmail antwoordde met ${response.status}: ${body.slice(0, 300)}`)
  }

  return response.json()
}

function decode(data) {
  return Buffer.from(String(data ?? '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

/** Alleen wat er als tekst toe doet; opmaak en trackingpixels laten we vallen. */
function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
}

/**
 * Platte tekst wint van HTML: bijna elke mail bevat beide, en de HTML-variant
 * levert na het strippen van tags dezelfde tekst met meer rommel erin.
 */
function bodyOf(payload) {
  const plain = []
  const html = []

  const walk = (part) => {
    if (!part) return
    const type = part.mimeType ?? ''
    if (part.body?.data) {
      if (type === 'text/plain') plain.push(decode(part.body.data))
      else if (type === 'text/html') html.push(decode(part.body.data))
    }
    for (const child of part.parts ?? []) walk(child)
  }

  walk(payload)

  const text = plain.length ? plain.join('\n') : htmlToText(html.join('\n'))
  return text.replace(/\r\n/g, '\n').trim().slice(0, MAX_BODY_CHARS)
}

function headers(message) {
  const found = {}
  for (const { name, value } of message?.payload?.headers ?? []) {
    found[name.toLowerCase()] = value
  }
  return found
}

/** `Jochem <jochem@example.com>` -> de naam als die er is, anders het adres. */
function displayName(address) {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(address ?? '')
  const name = match?.[1]?.trim()
  return name || match?.[2] || (address ?? '').trim()
}

function attachmentsOf(payload) {
  const found = []

  const walk = (part) => {
    if (!part) return
    if (part.filename && part.body?.attachmentId) {
      found.push({ name: part.filename, size: Number(part.body.size ?? 0) })
    }
    for (const child of part.parts ?? []) walk(child)
  }

  walk(payload)
  return found
}

function summarise(thread) {
  const messages = thread.messages ?? []
  const last = messages[messages.length - 1]
  const head = headers(last)
  const labels = new Set(messages.flatMap((message) => message.labelIds ?? []))

  return {
    id: thread.id,
    subject: head.subject || '(geen onderwerp)',
    from: displayName(head.from),
    date: head.date ? new Date(head.date).toISOString() : null,
    snippet: last?.snippet ?? '',
    count: messages.length,
    unread: labels.has('UNREAD'),
    starred: labels.has('STARRED'),
  }
}

/**
 * Twee rondjes: de lijst geeft alleen ids terug, de koppen zitten per draad.
 * Twintig tegelijk blijft ruim onder de limiet die Gmail per seconde toestaat.
 */
export async function listThreads({ query = 'in:inbox', limit = 20 } = {}) {
  const params = new URLSearchParams({ q: query, maxResults: String(Math.min(limit, 50)) })
  const { threads = [] } = await gmail(`/threads?${params}`)

  const metadata = new URLSearchParams({ format: 'metadata' })
  for (const name of ['From', 'Subject', 'Date']) metadata.append('metadataHeaders', name)

  const full = await Promise.all(
    threads.map((thread) => gmail(`/threads/${thread.id}?${metadata}`)),
  )

  return full.map(summarise)
}

export async function getThread(id) {
  const thread = await gmail(`/threads/${encodeURIComponent(id)}?format=full`)
  const messages = thread.messages ?? []
  const last = messages[messages.length - 1]
  const head = headers(last)

  return {
    id: thread.id,
    subject: headers(messages[0]).subject || '(geen onderwerp)',
    messages: messages.map((message) => {
      const own = headers(message)
      return {
        id: message.id,
        from: displayName(own.from),
        to: displayName(own.to),
        date: own.date ? new Date(own.date).toISOString() : null,
        unread: (message.labelIds ?? []).includes('UNREAD'),
        body: bodyOf(message.payload),
        attachments: attachmentsOf(message.payload),
      }
    }),
    // Waar een antwoord heen gaat, bepaalt de server: het staat in de draad,
    // en de app hoeft er niets over te weten of te kunnen kiezen.
    reply: {
      // Ruw, want zo gaat hij de kop in; de naam ernaast is wat de app toont.
      to: head['reply-to'] || head.from || '',
      name: displayName(head['reply-to'] || head.from),
      subject: /^re:/i.test(head.subject ?? '')
        ? head.subject
        : `Re: ${head.subject ?? ''}`.trim(),
      messageId: head['message-id'] ?? '',
      references: [head.references, head['message-id']].filter(Boolean).join(' '),
    },
  }
}

export async function modifyThread(id, { add = [], remove = [] } = {}) {
  await gmail(`/threads/${encodeURIComponent(id)}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
  })
}

/** Een kop met niet-ASCII moet als encoded word. */
function encodeHeader(value) {
  if (!/[^\x20-\x7e]/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

/**
 * In een adreskop mag alleen de naam gecodeerd worden; het adres tussen de
 * punthaken moet leesbaar blijven, anders levert het niets af. Een naam die al
 * als encoded word binnenkwam — zo staat hij in de draad — verandert niet.
 */
function encodeAddress(value) {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value ?? '')
  if (!match) return (value ?? '').trim()

  const [, rawName, rawAddress] = match
  const name = rawName.trim()
  const address = rawAddress.trim()
  if (!name) return address

  const encoded = encodeHeader(name)
  // Een encoded word mag juist niet tussen aanhalingstekens; een naam met een
  // komma of punt erin moet dat wél, anders leest een komma als een tweede
  // geadresseerde en gaat de mail naar iemand die niet bestaat.
  if (encoded !== name) return `${encoded} <${address}>`
  if (/["(),.:;<>@[\\\]]/.test(name)) {
    return `"${name.replace(/(["\\])/g, '\\$1')}" <${address}>`
  }
  return `${name} <${address}>`
}

function toRaw({ to, cc, subject, text, inReplyTo, references }) {
  const lines = [
    `To: ${encodeAddress(to)}`,
    cc ? `Cc: ${encodeAddress(cc)}` : null,
    `Subject: ${encodeHeader(subject)}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    // Base64 in regels van 76 tekens: lange regels mag SMTP afbreken.
    Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
  ].filter((line) => line !== null)

  return Buffer.from(lines.join('\r\n'), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function sendMail({ to, cc, subject, text, threadId, inReplyTo, references }) {
  const sent = await gmail('/messages/send', {
    method: 'POST',
    body: JSON.stringify({
      raw: toRaw({ to, cc, subject, text, inReplyTo, references }),
      ...(threadId ? { threadId } : {}),
    }),
  })

  return { id: sent.id, threadId: sent.threadId }
}

/** Welk adres er verstuurt; de app toont dat voordat er iets de deur uit gaat. */
export async function profile() {
  const { emailAddress } = await gmail('/profile')
  return { address: emailAddress }
}
