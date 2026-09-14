/**
 * Claude via het abonnement, niet via de API.
 *
 * `claude setup-token` levert een OAuth-token dat de Messages API alleen
 * accepteert met de beta-header hieronder én met de Claude Code-identiteit als
 * eerste systeemblok — zo praat de CLI zelf. Dat is niet gedocumenteerd en kan
 * dus stilvallen; wie dit aanroept moet een fout netjes kunnen tonen.
 *
 * Het token staat in Secret Manager als `claude-oauth-token`, hetzelfde dat de
 * wensen-job gebruikt: geen tweede credential, geen kosten per aanroep. Het
 * wordt bij de eerste aanroep gelezen, niet als env-var gemount — de
 * service-instellingen staan bewust niet in cloudbuild.yaml.
 */

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? 'jochem-personal-pwa'
const SECRET = process.env.CLAUDE_SECRET ?? 'claude-oauth-token'

/** Het eerste systeemblok, altijd. Zonder dit weigert de API het token. */
export const IDENTITY = {
  type: 'text',
  text: "You are Claude Code, Anthropic's official CLI for Claude.",
}

/** Gevuld na de eerste aanroep; leeggegooid zodra Anthropic hem weigert. */
let token = null

async function fetchToken() {
  if (token) return token

  const { GoogleAuth } = await import('google-auth-library')
  const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' })
  const client = await auth.getClient()

  const { data } = await client.request({
    url: `https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${SECRET}/versions/latest:access`,
  })

  const value = Buffer.from(data?.payload?.data ?? '', 'base64').toString('utf8').trim()
  if (!value) throw new Error(`${SECRET} is leeg`)
  token = value
  return value
}

/**
 * Eén bericht naar de Messages API. `body` is de gewone request-body; het
 * identiteitsblok gaat er hier vooraan in, zodat een aanroeper dat niet kan
 * vergeten. Bij een weigering gaat het token weg — een gedraaide sleutel
 * geneest zo bij de volgende poging — en komt de status mee in de fout, zodat
 * de route hem kan doorgeven.
 */
export async function ask(body) {
  const bearer = await fetchToken()

  let response
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        ...body,
        system: [IDENTITY, ...(Array.isArray(body.system) ? body.system : [])],
      }),
    })
  } catch (error) {
    token = null
    throw error
  }

  if (!response.ok) {
    token = null
    const text = await response.text().catch(() => '')
    throw Object.assign(new Error(`Claude antwoordde met ${response.status}: ${text.slice(0, 500)}`), {
      status: response.status,
    })
  }

  return response.json()
}

/** De invoer van de eerste tool-aanroep in een antwoord, of null. */
export function toolInput(data, name) {
  const block = (data.content ?? []).find(
    (part) => part.type === 'tool_use' && (!name || part.name === name),
  )
  return block?.input ?? null
}

/** Alle tekstblokken achter elkaar. */
export function textOf(data) {
  return (data.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}
