/**
 * Draait dit toestel de laatste versie?
 *
 * Leest het laatste commit-hash op main via de publieke GitHub-API — zonder
 * token, want dit is juist de controle die moet werken als er verder iets mis
 * is. De deploy zelf loopt via Cloud Build; deze module weet daar niets van en
 * vergelijkt alleen wat er draait met wat er in de repo staat.
 */
const REPO = 'jochem-oosterlee/personal'

export async function latestCommit(): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`GitHub antwoordde met ${response.status}`)

  const data = await response.json()
  return String(data.sha).slice(0, 7)
}
