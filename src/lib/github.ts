const REPO = 'jochem-oosterlee/personal'

/** Fine-grained token, scoped to this repo, with Issues: read and write. */
export const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

export type Issue = {
  number: number
  url: string
}

export type ModelId = 'claude-opus-5' | 'claude-sonnet-5' | 'claude-haiku-4-5'

export const DEFAULT_MODEL: ModelId = 'claude-opus-5'

/**
 * Welk model de wens bouwt. De workflow keurt de waarde uit de issue-body af
 * als hij niet in zijn eigen lijst staat — houd .github/workflows/claude.yml
 * in sync met deze ids.
 */
export const MODELS: { id: ModelId; label: string; hint: string }[] = [
  { id: 'claude-opus-5', label: 'Opus 5', hint: 'Sterkst; voor grotere wensen' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', hint: 'Sneller en goedkoper' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', hint: 'Alleen kleine klusjes' },
]

function describe(status: number): string {
  if (status === 401) return 'Token ongeldig of verlopen.'
  if (status === 403) return 'Token mist het recht "Issues: write".'
  if (status === 404) return `Geen toegang tot ${REPO} met dit token.`
  if (status === 422) return 'GitHub weigerde de inhoud van de issue.'
  if (status === 429) return 'Te veel verzoeken — probeer het zo nog eens.'
  return `GitHub antwoordde met status ${status}.`
}

// De regel "Model: <id>" is machineleesbaar — de workflow pikt hem hieruit.
function issueBody(detail: string, model: ModelId): string {
  const trimmed = detail.trim()
  const footer = `---\nIngediend vanuit de Personal PWA.\nModel: ${model}`
  return trimmed ? `${trimmed}\n\n${footer}` : footer
}

/**
 * Posts straight to the GitHub API from the browser. The token never leaves
 * this device except in this request — there is no backend in between.
 */
export async function createIssue(
  token: string,
  title: string,
  detail: string,
  model: ModelId,
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
        body: issueBody(detail, model),
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
export function prefillUrl(title: string, detail: string, model: ModelId): string {
  const params = new URLSearchParams({
    title,
    body: issueBody(detail, model),
    labels: 'enhancement',
  })
  return `https://github.com/${REPO}/issues/new?${params}`
}
