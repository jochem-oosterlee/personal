/**
 * Eenmalig toestemming geven voor Gmail, lokaal.
 *
 * De app zelf heeft geen inlogscherm — IAP doet de identiteit en er is één
 * gebruiker — dus is er ook geen plek waar Google om toestemming kan vragen.
 * Dit script doet dat één keer op deze machine en drukt af wat er in Secret
 * Manager moet. Daarna praat alleen de server nog met Gmail.
 *
 *   node infra/gmail-consent.mjs <client-id> <client-secret>
 *
 * De client is van het type "Desktop app"; die mag op http://localhost
 * terugkomen, en dat scheelt een redirect-URI aan een draaiende service
 * hangen. Het toestemmingsscherm staat op Internal — het project zit in de
 * cleverbase.com-organisatie, dus dat mag, en dan is er geen verificatie en
 * geen verval. Op External zou hij gepubliceerd moeten zijn: bij "Testing"
 * trekt Google een refresh token na zeven dagen weer in.
 */

import http from 'node:http'
import { randomBytes } from 'node:crypto'

const SCOPES = [
  // modify dekt lezen, labels en archiveren; send staat er los bij zodat in de
  // toestemming te zien is dat deze app ook verstuurt.
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
]

const [clientId, clientSecret] = process.argv.slice(2)

if (!clientId || !clientSecret) {
  console.error('gebruik: node infra/gmail-consent.mjs <client-id> <client-secret>')
  process.exit(1)
}

const state = randomBytes(16).toString('hex')

/** Gevuld zodra de server een poort heeft. */
let redirectUri = ''

/**
 * Stoppen zonder process.exit: de browser houdt de verbinding open, en die
 * er onder wegtrekken laat Node op Windows met een libuv-assertie omvallen.
 */
function finish(code) {
  process.exitCode = code
  server.close()
  setTimeout(() => server.closeAllConnections(), 250).unref()
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname !== '/') return response.writeHead(404).end()

  const done = (message) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(message)
  }

  if (url.searchParams.get('state') !== state) {
    done('Verkeerde state — opnieuw beginnen.')
    return finish(1)
  }

  const error = url.searchParams.get('error')
  if (error) {
    done(`Geweigerd: ${error}`)
    return finish(1)
  }

  const exchange = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code') ?? '',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  const data = await exchange.json()

  if (!exchange.ok) {
    done('Google weigerde de uitwisseling. Kijk in de terminal.')
    console.error(`\nGoogle antwoordde met ${exchange.status}:`)
    console.error(data)
    console.error('\nKlopt de client id en secret, en is het een client van het type "Desktop app"?')
    return finish(1)
  }

  if (!data.refresh_token) {
    done('Er kwam geen refresh token terug. Kijk in de terminal.')
    // Zonder prompt=consent geeft Google bij een tweede keer alleen een access
    // token terug; het script vraagt er expliciet om, dus dit is iets anders.
    console.error('\nGeen refresh_token, terwijl er wel om gevraagd is. Trek de toegang in op myaccount.google.com/permissions en probeer opnieuw.')
    return finish(1)
  }

  done('Gelukt. Terug naar de terminal.')

  const secret = JSON.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: data.refresh_token,
  })

  console.log('\nZet dit in Secret Manager:\n')
  console.log(`echo '${secret}' | gcloud secrets versions add gmail-oauth --data-file=- --project=jochem-personal-pwa`)
  console.log('\nBestaat het secret nog niet:\n')
  console.log(`echo '${secret}' | gcloud secrets create gmail-oauth --data-file=- --project=jochem-personal-pwa`)

  finish(0)
})

// De poort komt pas los bij het listening-event, en de redirect-URI moet mee in
// de link én straks in de uitwisseling — dus wordt hij hier gezet, niet erbuiten.
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  redirectUri = `http://localhost:${port}`

  const authorise = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authorise.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    // offline + consent: anders komt er geen refresh token, of alleen de eerste keer.
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString()

  console.log('Open deze link en geef toestemming:\n')
  console.log(authorise.toString())
})
