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

/**
 * Het secret bestaat, maar deze service mag er niet bij. Een aparte code, want
 * dit als "nog niet gekoppeld" tonen stuurt je het verkeerde gat in: je gaat
 * opnieuw toestemming geven terwijl er een IAM-binding mist.
 */
export const NO_ACCESS = 'gmail-geen-toegang'

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
    const status = error?.response?.status
    // Bestaat het secret niet, dan is Gmail simpelweg nog niet ingericht.
    if (status === 404) {
      throw Object.assign(new Error(`${SECRET} bestaat niet`), { code: NOT_LINKED })
    }
    // Wel een secret, geen toegang: het service-account mist
    // roles/secretmanager.secretAccessor op deze sleutel.
    if (status === 403) {
      throw Object.assign(new Error(`geen toegang tot ${SECRET}`), { code: NO_ACCESS })
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

/**
 * Gmail rekent per seconde af (250 eenheden per gebruiker, en een draad ophalen
 * kost er tien). Een reeks verzoeken loopt daar zo tegenaan, en dat is geen
 * fout maar een ritme-probleem: even wachten en het lukt wel.
 */
const RETRY_AFTER = [400, 1200]

function isRateLimit(status, body) {
  return status === 429 || (status === 403 && /rateLimit|Quota exceeded/i.test(body))
}

async function gmail(pathname, init = {}, attempt = 0) {
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

    if (isRateLimit(response.status, body) && attempt < RETRY_AFTER.length) {
      await new Promise((resume) => setTimeout(resume, RETRY_AFTER[attempt]))
      return gmail(pathname, init, attempt + 1)
    }

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
 * Vijf tegelijk, want twintig ineens is al 200 quota-eenheden en daarmee zat de
 * lijst tegen het plafond van 250 per seconde aan te schuren.
 */
export async function listThreads({ query = 'in:inbox', limit = 20 } = {}) {
  const params = new URLSearchParams({ q: query, maxResults: String(Math.min(limit, 50)) })
  const { threads = [] } = await gmail(`/threads?${params}`)

  const metadata = new URLSearchParams({ format: 'metadata' })
  for (const name of ['From', 'Subject', 'Date']) metadata.append('metadataHeaders', name)

  const full = await inChunks(threads, 5, (thread) =>
    gmail(`/threads/${thread.id}?${metadata}`),
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

/** Het eigen adres: voor "stond ik alleen in cc" en voor "heb ik dit zelf gestuurd". */
let ownAddress = null

async function address() {
  if (!ownAddress) ownAddress = (await profile()).address.toLowerCase()
  return ownAddress
}

/** `Jochem <j@x.nl>` -> `j@x.nl`, zodat vergelijken op het adres gaat en niet op de naam. */
function emailOf(value) {
  const match = /<([^>]+)>/.exec(value ?? '')
  return (match?.[1] ?? value ?? '').trim().toLowerCase()
}

/**
 * Het citaat onder een antwoord eraf.
 *
 * In Remco's antwoord staat jouw eigen mail er nog een keer onder, met > ervoor
 * en een "Op ... schreef ..."-regel erboven. Voor een samenvatting is dat niet
 * alleen dubbel maar ook verwarrend: het zet jouw woorden in zijn bericht. Wat
 * eronder hangt is per definitie iets wat al eerder in de draad staat.
 *
 * Blijft er niets over -- een doorgestuurd bericht is vrijwel helemaal citaat --
 * dan houden we het origineel, want dan is het citaat juist de inhoud.
 */
function withoutQuotes(text) {
  const lines = text.split('\n')
  const kept = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (line.trimStart().startsWith('>')) break

    // De aanhef boven een citaat. Nederlands zet de naam erachter ("Op ...
    // schreef Jochem:"), Engels ervoor ("On ... Jochem wrote:"), dus alleen op
    // de twee woorden letten. Ruim genomen, en daarom alleen geknipt als er ook
    // echt een citaat op volgt.
    if (
      /^\s*(op|on)\b.{0,200}\b(schreef|wrote)\b.{0,80}$/i.test(line) &&
      lines.slice(index + 1, index + 3).some((next) => next.trimStart().startsWith('>'))
    ) {
      break
    }

    kept.push(line)
  }

  const trimmed = kept.join('\n').trim()
  return trimmed || text.trim()
}

/** Vijf tegelijk: ruim onder wat Gmail per seconde toestaat, en snel genoeg. */
async function inChunks(items, size, work) {
  const done = []
  for (let index = 0; index < items.length; index += size) {
    done.push(...(await Promise.all(items.slice(index, index + size).map(work))))
  }
  return done
}

/**
 * De berichten uit een periode, met hun tekst, om samen te vatten.
 *
 * Anders dan de lijst haalt dit elke draad volledig op, dus het is duur: een
 * verzoek per draad. Daarom een dak op het aantal draden én op het aantal
 * tekens, en meldt het terug wanneer er iets is afgevallen — een samenvatting
 * die stilzwijgend de helft weglaat is erger dan een die zegt dat hij inkort.
 */
/**
 * Wat "nieuwsbrief" en "automatische notificatie" betekenen.
 *
 * Niet via Gmail's categorieën: dit account blijkt ze niet te gebruiken --
 * category:promotions gaf nul draden -- dus zouden die vinkjes stilletjes niets
 * doen. De koppen zijn wel betrouwbaar: een nieuwsbrief hoort je te laten
 * uitschrijven, en een machine die mailt zegt dat in Auto-Submitted of
 * Precedence, of heet no-reply.
 */
function isBulk(head) {
  return Boolean(head['list-unsubscribe'] || head['list-id'])
}

function isAutomated(head) {
  return (
    /auto-(generated|replied|notified)/i.test(head['auto-submitted'] ?? '') ||
    /bulk|auto_reply|list/i.test(head.precedence ?? '') ||
    /no-?reply|do-?not-?reply|noreply/i.test(head.from ?? '')
  )
}

export async function collectMessages({
  query,
  skip = [],
  maxThreads = 60,
  maxChars = 120000,
  perMessageChars = 2500,
}) {
  const params = new URLSearchParams({ q: query, maxResults: String(maxThreads) })
  const { threads = [] } = await gmail(`/threads?${params}`)

  const full = await inChunks(threads, 5, (thread) =>
    gmail(`/threads/${thread.id}?format=full`),
  )

  // Altijd nodig: zonder te weten wie jij bent kan een samenvatting een antwoord
  // van iemand anders voor het jouwe aanzien.
  const me = await address()
  let myName = ''
  const collected = []
  let chars = 0
  let dropped = 0
  let skipped = 0

  // Nieuwste eerst binnen; oudste valt als eerste af zodra het dak in zicht komt.
  for (const thread of full) {
    for (const message of thread.messages ?? []) {
      const head = headers(message)

      const mine = emailOf(head.from) === me
      if (mine && !myName) myName = displayName(head.from)

      // Alleen in cc: meelezen, niet aan jou gericht. Wat je zelf stuurde blijft
      // staan: dat is juist de helft van een gesprek.
      if (
        skip.includes('cc') &&
        !mine &&
        !(head.to ?? '').toLowerCase().includes(me) &&
        (head.cc ?? '').toLowerCase().includes(me)
      ) {
        skipped += 1
        continue
      }

      if (!mine && skip.includes('promotions') && isBulk(head)) {
        skipped += 1
        continue
      }

      if (!mine && skip.includes('updates') && isAutomated(head)) {
        skipped += 1
        continue
      }

      const body = withoutQuotes(bodyOf(message.payload)).slice(0, perMessageChars)
      if (!body) continue

      if (chars + body.length > maxChars) {
        dropped += 1
        continue
      }

      chars += body.length
      collected.push({
        mine,
        from: displayName(head.from),
        to: head.to ?? '',
        subject: head.subject || '(geen onderwerp)',
        date: head.date ? new Date(head.date).toISOString() : null,
        unread: (message.labelIds ?? []).includes('UNREAD'),
        body,
      })
    }
  }

  collected.sort((a, b) => String(a.date).localeCompare(String(b.date)))

  return {
    messages: collected,
    threads: full.length,
    skipped,
    me: { address: me, name: myName },
    // Meer draden dan het dak toestond betekent dat de periode niet heel past.
    truncated: dropped > 0 || threads.length >= maxThreads,
  }
}
