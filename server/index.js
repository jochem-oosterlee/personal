import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Firestore, FieldValue } from '@google-cloud/firestore'

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
async function startAgent(id) {
  const { GoogleAuth } = await import('google-auth-library')
  const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' })
  const client = await auth.getClient()

  await client.request({
    url: `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${JOB}:run`,
    method: 'POST',
    data: {
      overrides: {
        containerOverrides: [{ env: [{ name: 'WISH_ID', value: id }] }],
      },
    },
  })
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
      status: 'queued',
      messages: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    await startAgent(doc.id)
    res.status(201).json({ id: doc.id })
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
    await wishes.doc(req.params.id).set(
      {
        status: 'queued',
        messages: FieldValue.arrayUnion({
          role: 'user',
          text: text.trim(),
          at: new Date().toISOString(),
        }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    await startAgent(req.params.id)
    res.sendStatus(204)
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

app.delete('/api/wishes/:id', requireUser, async (req, res) => {
  try {
    await wishes.doc(req.params.id).delete()
    res.sendStatus(204)
  } catch (error) {
    res.status(500).json({ error: String(error) })
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
