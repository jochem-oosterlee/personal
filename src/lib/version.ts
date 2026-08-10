/**
 * Loopt er iets achter, en zo ja: wat?
 *
 * Er zijn drie versies in het spel en die kunnen alle drie verschillen:
 *
 *   main    het laatste commit op GitHub
 *   served  wat Cloud Run op dit moment uitlevert
 *   running wat dit toestel in de cache heeft staan
 *
 * Eerst vergeleek de app alleen running met main. Dat gaf een verkeerd advies
 * in het venster tussen pushen en uitgerold zijn — zo'n drie minuten waarin de
 * commit wel op GitHub staat maar de server nog de oude build serveert. De app
 * riep dan "nieuwe versie staat klaar" en vernieuwen deed niets, want er wás
 * nog niets nieuws op te halen.
 */
const REPO = 'jochem-oosterlee/personal'

export type VersionState =
  /** Alles gelijk. */
  | { kind: 'current' }
  /** De server heeft het al; dit toestel moet verversen. */
  | { kind: 'client-behind'; commit: string }
  /** De deploy is nog bezig of vastgelopen; verversen helpt niet. */
  | { kind: 'server-behind'; commit: string }
  /** Niet te bepalen — offline, of GitHub onbereikbaar. */
  | { kind: 'unknown' }

async function latestOnMain(): Promise<string> {
  // Zonder token: dit is juist de controle die moet werken als er verder iets
  // mis is.
  const response = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`GitHub antwoordde met ${response.status}`)

  const data = await response.json()
  return String(data.sha).slice(0, 7)
}

async function servedByServer(): Promise<string> {
  const response = await fetch('/api/version', { cache: 'no-store' })
  if (!response.ok) throw new Error(`server antwoordde met ${response.status}`)

  const data = await response.json()
  return String(data.commit)
}

export async function checkVersion(running: string): Promise<VersionState> {
  const [main, served] = await Promise.all([latestOnMain(), servedByServer()])

  // Volgorde telt: staat de server achter, dan is verversen zinloos, ook als
  // dit toestel óók achterloopt. Eerst moet de deploy landen.
  if (served !== main) return { kind: 'server-behind', commit: main }
  if (running !== served) return { kind: 'client-behind', commit: served }
  return { kind: 'current' }
}
