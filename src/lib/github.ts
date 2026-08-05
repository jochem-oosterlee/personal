const REPO = 'jochem-oosterlee/personal'

/** Fine-grained token, scoped to this repo, with Issues: read and write. */
export const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

export type Issue = {
  number: number
  url: string
}

function describe(status: number): string {
  if (status === 401) return 'Token ongeldig of verlopen.'
  if (status === 403) return 'Token mist het recht "Issues: write".'
  if (status === 404) return `Geen toegang tot ${REPO} met dit token.`
  if (status === 422) return 'GitHub weigerde de inhoud van de issue.'
  if (status === 429) return 'Te veel verzoeken — probeer het zo nog eens.'
  return `GitHub antwoordde met status ${status}.`
}

function issueBody(detail: string): string {
  const trimmed = detail.trim()
  return trimmed
    ? `${trimmed}\n\n---\nIngediend vanuit de Personal PWA.`
    : 'Ingediend vanuit de Personal PWA.'
}

/**
 * Posts straight to the GitHub API from the browser. The token never leaves
 * this device except in this request — there is no backend in between.
 */
export async function createIssue(
  token: string,
  title: string,
  detail: string,
): Promise<Issue> {
  let response: Response

  try {
    response = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body: issueBody(detail),
        labels: ['enhancement'],
      }),
    })
  } catch {
    throw new Error('Geen verbinding met GitHub.')
  }

  if (!response.ok) throw new Error(describe(response.status))

  const data = await response.json()
  return { number: data.number, url: data.html_url }
}

/** Fallback when no token is set: GitHub's own form, pre-filled. */
export function prefillUrl(title: string, detail: string): string {
  const params = new URLSearchParams({
    title,
    body: issueBody(detail),
    labels: 'enhancement',
  })
  return `https://github.com/${REPO}/issues/new?${params}`
}
