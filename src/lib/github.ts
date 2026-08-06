const REPO = 'jochem-oosterlee/personal'

/** Fine-grained token, scoped to this repo, with Issues: read and write. */
export const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

export type Issue = {
  number: number
  url: string
}

export type IssueStatus = {
  state: 'open' | 'closed'
  reason: string | null
  comments: number
}

export type ModelId = 'claude-opus-5' | 'claude-sonnet-5' | 'claude-haiku-4-5'

export const DEFAULT_MODEL: ModelId = 'claude-opus-5'

/** Error strings, supplied by the caller so this file doesn't own UI text. */
export type GithubStrings = {
  tokenInvalid: string
  tokenMissingScope: string
  noAccess: (repo: string) => string
  contentRejected: string
  rateLimited: string
  statusError: (status: number) => string
  noConnection: string
}

/**
 * Welk model de wens bouwt. De workflow keurt de waarde uit de issue-body af
 * als hij niet in zijn eigen lijst staat — houd .github/workflows/claude.yml
 * in sync met deze ids.
 */
export const MODELS: { id: ModelId; label: string; hint: { nl: string; en: string } }[] = [
  {
    id: 'claude-opus-5',
    label: 'Opus 5',
    hint: { nl: 'Sterkst; voor grotere wensen', en: 'Strongest; for bigger wishes' },
  },
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    hint: { nl: 'Sneller en goedkoper', en: 'Faster and cheaper' },
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    hint: { nl: 'Alleen kleine klusjes', en: 'Small jobs only' },
  },
]

function describe(status: number, strings: GithubStrings): string {
  if (status === 401) return strings.tokenInvalid
  if (status === 403) return strings.tokenMissingScope
  if (status === 404) return strings.noAccess(REPO)
  if (status === 422) return strings.contentRejected
  if (status === 429) return strings.rateLimited
  return strings.statusError(status)
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
  strings: GithubStrings,
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
    throw new Error(strings.noConnection)
  }

  if (!response.ok) throw new Error(describe(response.status, strings))

  const data = await response.json()
  return { number: data.number, url: data.html_url }
}

/**
 * Polls the issue's own state instead of trying to track the workflow that
 * acts on it — that keeps this in sync with any outcome (PR merged, closed
 * as not planned, closed by hand) without hard-coding the workflow's steps.
 * Works without a token too (the repo is public), just at a lower rate limit.
 */
export async function getIssueStatus(
  token: string,
  issueNumber: number,
  strings: GithubStrings,
): Promise<IssueStatus> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`https://api.github.com/repos/${REPO}/issues/${issueNumber}`, {
    headers,
  })
  if (!response.ok) throw new Error(describe(response.status, strings))

  const data = await response.json()
  return { state: data.state, reason: data.state_reason ?? null, comments: data.comments }
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
