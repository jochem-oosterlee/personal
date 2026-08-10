import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Firestore, FieldValue } from '@google-cloud/firestore'
import { Storage } from '@google-cloud/storage'

const here = path.dirname(fileURLToPath(import.meta.url))
const STATIC = path.join(here, 'public')
const INDEX = path.join(STATIC, 'index.html')

// Eén document per sleutel, waarde als JSON-string. Dat houdt het gelijk aan
// wat localStorage opslaat, en omzeilt Firestore's beperkingen op geneste
// arrays — een lijst met objecten die zelf lijsten bevatten zou anders stuk
// gaan bij het opslaan.
const COLLECTION = 'state'

const db = new Firestore()
const app = express()

app.disable('x-powered-by')
app.use(express.json({ limit: '12mb' }))

// Herstelroute na een verlopen IAP-sessie. De service worker laat alles onder
// /__ met rust, dus deze navigatie gaat echt het netwerk op en komt daarmee
// langs IAP. Express zet Location relatief, dus geen absolute-URL-probleem.
app.get('/__auth', (_req, res) => res.redirect(302, '/'))

/**
 * Welke build serveert deze server?
 *
 * Zonder dit kon de app alleen zichzelf met GitHub vergelijken, en die twee
 * lopen na een push zo'n drie minuten uiteen: de commit staat er, maar de
 * deploy draait nog. In dat venster meldde de app "nieuwe versie staat klaar"
 * en deed vernieuwen niets — er wás nog niets nieuws. Hiermee kan de app zien
 * welke van de twee achterloopt.
 */
app.get('/api/version', (_req, res) => {
  const sha = process.env.COMMIT_SHA ?? ''
  res.set('Cache-Control', 'no-store')
  // Alleen inkorten als het ook echt een hash is; de fallback uit de Dockerfile
  // is een woord en werd anders tot 'onbeken' afgeknipt.
  res.json({ commit: /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : 'onbekend' })
})

// Sonde: geldig -> 204. Verlopen -> IAP onderschept en stuurt een 302, wat de
// app met redirect:'manual' als opaqueredirect terugkrijgt.
app.get('/__session', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.sendStatus(204)
})

// IAP laat alleen de toegestane principal door, dus dit is geen extra slot maar
// een vangnet: draait dit ooit zonder IAP ervoor, dan schrijft niemand per
// ongeluk in de database.
function requireUser(req, res, next) {
  const user = req.get('X-Goog-Authenticated-User-Email')
  if (!user && process.env.ALLOW_ANONYMOUS !== 'true') {
    return res.status(401).json({ error: 'geen IAP-identiteit' })
  }
  next()
}

app.get('/api/state', requireUser, async (_req, res) => {
  try {
    const snapshot = await db.collection(COLLECTION).get()
    const state = {}
    for (const doc of snapshot.docs) state[doc.id] = doc.data().value
    res.set('Cache-Control', 'no-store')
    res.json(state)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

app.put('/api/state/:key', requireUser, async (req, res) => {
  const { key } = req.params
  const { value } = req.body ?? {}

  if (typeof value !== 'string') {
    return res.status(400).json({ error: 'value moet een JSON-string zijn' })
  }
  // Een sleutel met een slash zou een subcollectie worden in plaats van een
  // document, en '.' en '..' zijn geen geldige document-ids.
  if (key.includes('/') || key === '.' || key === '..' || key.length > 300) {
    return res.status(400).json({ error: 'ongeldige sleutel' })
  }

  try {
    await db.collection(COLLECTION).doc(key).set({
      value,
      updatedAt: FieldValue.serverTimestamp(),
    })
    res.sendStatus(204)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

app.delete('/api/state/:key', requireUser, async (req, res) => {
  try {
    await db.collection(COLLECTION).doc(req.params.key).delete()
    res.sendStatus(204)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// Zonder dit zou "Wis alle gegevens" alleen lokaal wissen en de volgende
// synchronisatie alles terugzetten.
app.delete('/api/state', requireUser, async (_req, res) => {
  try {
    const snapshot = await db.collection(COLLECTION).get()
    const batch = db.batch()
    for (const doc of snapshot.docs) batch.delete(doc.ref)
    await batch.commit()
    res.sendStatus(204)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// --- Wensen -----------------------------------------------------------------

const wishes = db.collection('wishes')
const MODELS = new Set(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'])

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? 'jochem-personal-pwa'
const REGION = process.env.JOB_REGION ?? 'europe-west4'
const JOB = process.env.JOB_NAME ?? 'wish-agent'

/**
 * Start de Cloud Run Job voor deze wens. Geen Eventarc ertussen: de API heeft
 * al een identiteit en weet precies wanneer er werk is, dus een extra
 * doorgeefluik zou alleen een plek zijn waar het stil kan misgaan.
 */
async function googleClient() {
  const { GoogleAuth } = await import('google-auth-library')
  const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' })
  return auth.getClient()
}

/** Geeft de naam van de executie terug, zodat we hem later kunnen afbreken. */
async function startAgent(id) {
  const client = await googleClient()
  const { data } = await client.request({
    url: `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${JOB}:run`,
    method: 'POST',
    data: {
      overrides: {
        containerOverrides: [{ env: [{ name: 'WISH_ID', value: id }] }],
      },
    },
  })
  // De naam zit in de metadata van de long-running operation.
  return data?.metadata?.name ?? null
}

/**
 * Breekt een lopende run af. Zonder dit blijft de agent doorwerken aan een
 * wens die je net verwijderd hebt — en pusht hij mogelijk nog naar main.
 */
async function cancelAgent(execution) {
  if (!execution) return
  try {
    const client = await googleClient()
    await client.request({
      url: `https://run.googleapis.com/v2/${execution}:cancel`,
      method: 'POST',
      data: {},
    })
  } catch {
    // Al klaar of al afgebroken: dan is er niets meer te stoppen.
  }
}

app.get('/api/wishes', requireUser, async (_req, res) => {
  try {
    const snapshot = await wishes.orderBy('createdAt', 'desc').limit(100).get()
    res.set('Cache-Control', 'no-store')
    res.json(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * Een nieuwe wens is een concept: hij start niets. Zo kun je hem afmaken,
 * een toelichting toevoegen en pas versturen als je klaar bent — in plaats
 * van dat de agent al vertrekt terwijl je nog typt.
 */
app.post('/api/wishes', requireUser, async (req, res) => {
  const { title, detail = '', model } = req.body ?? {}
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'titel ontbreekt' })
  }

  try {
    const doc = await wishes.add({
      title: title.trim(),
      detail: typeof detail === 'string' ? detail : '',
      model: MODELS.has(model) ? model : 'claude-opus-5',
      status: 'draft',
      messages: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    res.status(201).json({ id: doc.id })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/** Bijwerken kan alleen zolang het een concept is. */
app.patch('/api/wishes/:id', requireUser, async (req, res) => {
  const { title, detail, model } = req.body ?? {}
  const ref = wishes.doc(req.params.id)

  try {
    const snapshot = await ref.get()
    if (!snapshot.exists) return res.status(404).json({ error: 'wens bestaat niet' })
    if (snapshot.data().status !== 'draft') {
      return res.status(409).json({ error: 'wens is al verstuurd' })
    }

    const patch = { updatedAt: FieldValue.serverTimestamp() }
    if (typeof title === 'string' && title.trim()) patch.title = title.trim()
    if (typeof detail === 'string') patch.detail = detail
    if (MODELS.has(model)) patch.model = model

    await ref.update(patch)
    res.sendStatus(204)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

app.post('/api/wishes/:id/submit', requireUser, async (req, res) => {
  const ref = wishes.doc(req.params.id)

  try {
    const snapshot = await ref.get()
    if (!snapshot.exists) return res.status(404).json({ error: 'wens bestaat niet' })
    if (snapshot.data().status !== 'draft') {
      return res.status(409).json({ error: 'wens is al verstuurd' })
    }

    await ref.update({ status: 'queued', updatedAt: FieldValue.serverTimestamp() })
    const execution = await startAgent(req.params.id)
    await ref.update({ execution: execution ?? FieldValue.delete() })
    res.sendStatus(204)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// --- Bijlagen ---------------------------------------------------------------

/**
 * Screenshots gaan naar Cloud Storage, niet naar Firestore: een document mag
 * maximaal 1 MiB zijn en daar passen twee schermafdrukken al niet in. De bucket
 * staat dicht (public access prevention), dus de app haalt ze via deze API op
 * en daarmee langs IAP.
 */
const BUCKET = process.env.ATTACHMENTS_BUCKET ?? 'jochem-personal-pwa-attachments'
const bucket = new Storage().bucket(BUCKET)

const IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
])

// Ruim boven wat de app na verkleinen oplevert, ruim onder de JSON-limiet.
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024

/** Alleen wat wij zelf uitgeven; houdt ../ buiten het objectpad. */
function validKey(key) {
  return /^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(key)
}

function objectPath(wishId, key) {
  return `wishes/${wishId}/${key}`
}

app.post('/api/wishes/:id/attachments', requireUser, async (req, res) => {
  const { name, type, data } = req.body ?? {}
  const extension = IMAGE_TYPES.get(type)

  if (!extension) return res.status(400).json({ error: 'alleen png, jpeg of webp' })
  if (typeof data !== 'string' || !data) {
    return res.status(400).json({ error: 'data ontbreekt' })
  }

  const bytes = Buffer.from(data, 'base64')
  if (bytes.length === 0) return res.status(400).json({ error: 'lege afbeelding' })
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    return res.status(413).json({ error: 'afbeelding te groot' })
  }

  const ref = wishes.doc(req.params.id)

  try {
    const snapshot = await ref.get()
    if (!snapshot.exists) return res.status(404).json({ error: 'wens bestaat niet' })
    // Na versturen zou een nieuwe bijlage de agent niet meer bereiken; hij
    // heeft zijn kopie dan al.
    if (snapshot.data().status !== 'draft') {
      return res.status(409).json({ error: 'wens is al verstuurd' })
    }

    const key = `${randomUUID()}.${extension}`
    await bucket.file(objectPath(req.params.id, key)).save(bytes, { contentType: type })

    const attachment = {
      key,
      name: typeof name === 'string' ? name.slice(0, 120) : 'screenshot',
      type,
      size: bytes.length,
    }
    await ref.update({
      attachments: FieldValue.arrayUnion(attachment),
      updatedAt: FieldValue.serverTimestamp(),
    })
    res.status(201).json(attachment)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

app.get('/api/wishes/:id/attachments/:key', requireUser, async (req, res) => {
  const { id, key } = req.params
  if (!validKey(key)) return res.status(400).end()

  try {
    const file = bucket.file(objectPath(id, key))
    const [metadata] = await file.getMetadata()
    res.set('Content-Type', metadata.contentType ?? 'application/octet-stream')
    // De inhoud van een sleutel verandert nooit; hergebruik scheelt bij elke
    // poll van de wensenlijst een download.
    res.set('Cache-Control', 'private, max-age=86400')
    file.createReadStream().on('error', () => res.sendStatus(404)).pipe(res)
  } catch {
    res.sendStatus(404)
  }
})

app.delete('/api/wishes/:id/attachments/:key', requireUser, async (req, res) => {
  const { id, key } = req.params
  if (!validKey(key)) return res.status(400).end()

  const ref = wishes.doc(id)

  try {
    const snapshot = await ref.get()
    if (!snapshot.exists) return res.status(404).json({ error: 'wens bestaat niet' })
    if (snapshot.data().status !== 'draft') {
      return res.status(409).json({ error: 'wens is al verstuurd' })
    }

    const remaining = (snapshot.data().attachments ?? []).filter((a) => a.key !== key)
    await ref.update({ attachments: remaining, updatedAt: FieldValue.serverTimestamp() })
    await bucket.file(objectPath(id, key)).delete({ ignoreNotFound: true })
    res.sendStatus(204)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/** Antwoord op een vraag van Claude; zet de agent opnieuw aan het werk. */
app.post('/api/wishes/:id/reply', requireUser, async (req, res) => {
  const { text } = req.body ?? {}
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'tekst ontbreekt' })
  }

  try {
    // update() en niet set(merge): dat laatste zou een verwijderde wens
    // opnieuw aanmaken.
    await wishes.doc(req.params.id).update({
      status: 'queued',
      messages: FieldValue.arrayUnion({
        role: 'user',
        text: text.trim(),
        at: new Date().toISOString(),
      }),
      updatedAt: FieldValue.serverTimestamp(),
    })
    const execution = await startAgent(req.params.id)
    await wishes.doc(req.params.id).update({ execution: execution ?? FieldValue.delete() })
    res.sendStatus(204)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * Verwijderen breekt een lopende run af. Zonder dat werkt de agent door aan
 * iets wat jij hebt weggegooid en kan hij het alsnog naar main pushen.
 */
app.delete('/api/wishes/:id', requireUser, async (req, res) => {
  const ref = wishes.doc(req.params.id)

  try {
    const snapshot = await ref.get()
    if (snapshot.exists) await cancelAgent(snapshot.data().execution)
    await ref.delete()
    // Anders blijven de screenshots betalend achter in de bucket, zonder dat
    // er nog iets naar verwijst.
    await bucket
      .deleteFiles({ prefix: `wishes/${req.params.id}/`, force: true })
      .catch(() => {})
    res.sendStatus(204)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

/**
 * Start de deploy handmatig. De trigger hangt aan een GitHub-webhook, en die
 * aflevering is best effort: komt hij niet aan, dan staat main vooruit op wat
 * er draait zonder dat iets dat meldt. Dit is de knop ernaast.
 */
app.post('/api/deploy', requireUser, async (_req, res) => {
  try {
    const { GoogleAuth } = await import('google-auth-library')
    const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' })
    const client = await auth.getClient()

    await client.request({
      url: `https://cloudbuild.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/triggers/personal-deploy:run`,
      method: 'POST',
      data: { source: { branchName: 'main' } },
    })
    res.sendStatus(202)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// --- Actiepunten uit tekst --------------------------------------------------

/**
 * Haalt de actiepunten uit een geplakt stuk tekst. Dit draait op het
 * Claude-abonnement: `claude-oauth-token` staat al in Secret Manager voor de
 * wensen-job, en wordt hier bij de eerste aanroep opgehaald in plaats van als
 * env-var gemount. De service-instellingen staan bewust niet in
 * cloudbuild.yaml, dus een deploy kan er geen secret aan koppelen; het
 * service-account heeft wel `secretmanager.secretAccessor`.
 */
const CLAUDE_SECRET = process.env.CLAUDE_SECRET ?? 'claude-oauth-token'
const EXTRACT_MODEL = 'claude-haiku-4-5'

// Ruim boven een lange e-mail; de app hanteert dezelfde grens.
const MAX_EXTRACT_CHARS = 20000

/** Gevuld na de eerste aanroep; leeggegooid zodra Anthropic hem weigert. */
let claudeToken = null

async function fetchClaudeToken() {
  if (claudeToken) return claudeToken

  const client = await googleClient()
  const { data } = await client.request({
    url: `https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${CLAUDE_SECRET}/versions/latest:access`,
  })

  const value = Buffer.from(data?.payload?.data ?? '', 'base64').toString('utf8').trim()
  if (!value) throw new Error(`${CLAUDE_SECRET} is leeg`)
  claudeToken = value
  return value
}

/**
 * Een tool met een schema in plaats van "geef JSON terug": dan komt er geen
 * uitleg of code-fence omheen die we eruit moeten pulken.
 */
const EXTRACT_TOOL = {
  name: 'actiepunten',
  description: 'Geeft de actiepunten uit de tekst terug.',
  input_schema: {
    type: 'object',
    properties: {
      taken: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            naam: {
              type: 'string',
              description: 'Het actiepunt als korte taak, in de taal van de tekst.',
            },
            deadline: {
              type: 'string',
              description: 'Datum als YYYY-MM-DD. Weglaten als de tekst geen moment noemt.',
            },
          },
          required: ['naam'],
        },
      },
    },
    required: ['taken'],
  },
}

/**
 * `claude setup-token` levert een OAuth-token: het abonnement, niet de API.
 * De Messages API accepteert dat alleen met deze beta-header én met de
 * Claude Code-identiteit als eerste systeemblok — zo praat de CLI zelf. Dat is
 * niet gedocumenteerd en kan dus stilvallen; vandaar dat een fout hier een
 * nette melding wordt en de rest van Taken gewoon doorwerkt.
 */
const EXTRACT_SYSTEM = [
  { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
  {
    type: 'text',
    text: `Je haalt actiepunten uit een tekst die iemand plakt: een e-mail, notulen, een appje.

- Alleen wat de lezer zelf moet doen. Achtergrond, meningen en wat al af is laat je weg.
- Eén korte, concrete taak per actiepunt, in de taal van de tekst.
- Noemt de tekst een moment ("voor vrijdag", "eind van de maand"), reken dat om naar een datum met vandaag als ijkpunt. Anders geen deadline.
- Verzin niets en vat de tekst niet samen. Staan er geen actiepunten in, geef dan een lege lijst.`,
  },
]

/** Alleen wat de lijst kan tonen: een naam, en een datum in het formaat van het datumveld. */
function cleanTasks(list) {
  if (!Array.isArray(list)) return []

  return list
    .map((task) => ({
      name: typeof task?.naam === 'string' ? task.naam.trim().slice(0, 200) : '',
      dueAt: /^\d{4}-\d{2}-\d{2}$/.test(task?.deadline) ? task.deadline : undefined,
    }))
    .filter((task) => task.name)
    .slice(0, 50)
}

app.post('/api/extract-tasks', requireUser, async (req, res) => {
  const { text, today } = req.body ?? {}

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'tekst ontbreekt' })
  }
  if (text.length > MAX_EXTRACT_CHARS) {
    return res.status(413).json({ error: 'tekst te lang' })
  }

  // De datum komt van het toestel: de server draait in UTC en zou rond
  // middernacht een dag mis kunnen zitten.
  const day = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10)

  try {
    const token = await fetchClaudeToken()

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: EXTRACT_MODEL,
        max_tokens: 2048,
        system: EXTRACT_SYSTEM,
        tools: [EXTRACT_TOOL],
        tool_choice: { type: 'tool', name: EXTRACT_TOOL.name },
        messages: [
          { role: 'user', content: `Vandaag is ${day}.\n\n<tekst>\n${text}\n</tekst>` },
        ],
      }),
    })

    if (!response.ok) {
      // Een gedraaide sleutel geneest zo bij de volgende poging.
      claudeToken = null
      const body = await response.text().catch(() => '')
      console.error(`extractie mislukt (${response.status}): ${body.slice(0, 500)}`)
      return res.status(502).json({ error: `Claude antwoordde met ${response.status}` })
    }

    const data = await response.json()
    const block = (data.content ?? []).find((part) => part.type === 'tool_use')

    res.set('Cache-Control', 'no-store')
    res.json({ tasks: cleanTasks(block?.input?.taken) })
  } catch (error) {
    claudeToken = null
    console.error(error)
    res.status(502).json({ error: String(error) })
  }
})

// Gehashte bestandsnamen: onbeperkt cachebaar.
app.use(
  '/assets',
  express.static(path.join(STATIC, 'assets'), {
    immutable: true,
    maxAge: '1y',
    fallthrough: false,
  }),
)

// Alles daarbuiten bepaalt of je een update ziet, dus nooit uit de HTTP-cache.
app.use(
  express.static(STATIC, {
    etag: true,
    setHeaders: (res) => res.set('Cache-Control', 'no-store'),
  }),
)

// SPA-fallback. Als middleware in plaats van app.get('*'), omdat Express 5
// dat patroon niet meer accepteert.
app.use((req, res) => {
  if (req.method !== 'GET') return res.sendStatus(405)
  res.set('Cache-Control', 'no-store')
  res.sendFile(INDEX)
})

const port = Number(process.env.PORT ?? 8080)
app.listen(port, () => console.log(`luistert op ${port}`))
