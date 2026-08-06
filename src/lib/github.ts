const REPO = 'jochem-oosterlee/personal'

/**
 * Fine-grained token, scoped to this repo, with Issues: read and write —
 * plus Contents: read and write om screenshots mee te kunnen sturen.
 */
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
  contentsMissingScope: string
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

function describe(
  status: number,
  strings: GithubStrings,
  missingScope: string = strings.tokenMissingScope,
): string {
  if (status === 401) return strings.tokenInvalid
  if (status === 403) return missingScope
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

export type Screenshot = { dataUrl: string }

export type UploadedScreenshot = { path: string; url: string }

/**
 * Map buiten de Vite-build, dus screenshots komen niet in `dist` terecht. Wel
 * op `main`, dus elke upload is een commit die een Pages-deploy start.
 */
const SCREENSHOT_DIR = 'screenshots'

// Niet main: een commit daar start deploy.yml, dus elke screenshot zou een
// volledige rebuild en Pages-deploy veroorzaken. download_url wijst vanzelf
// naar de juiste branch, dus de URL in de issue blijft kloppen.
const SCREENSHOT_BRANCH = 'wish-assets'

/**
 * Zet elke screenshot als bestand in de repo in plaats van in een gist: de run
 * die de issue oppakt heeft hem dan gewoon in zijn checkout staan en kan hem
 * met Read openen, zonder netwerktoegang. De Contents API doet één bestand per
 * verzoek en twee commits tegelijk op dezelfde branch botsen, dus na elkaar.
 */
export async function uploadScreenshots(
  token: string,
  images: Screenshot[],
  strings: GithubStrings,
): Promise<UploadedScreenshot[]> {
  // Tijdstip in de naam: uniek genoeg voor één telefoon, en de screenshots van
  // dezelfde wens staan zo bij elkaar in de map.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const uploaded: UploadedScreenshot[] = []

  for (const [index, image] of images.entries()) {
    // .jpg omdat de app ze als JPEG uit het canvas haalt.
    const path = `${SCREENSHOT_DIR}/${stamp}-${index + 1}.jpg`
    let response: Response

    try {
      response = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Screenshot bij een wens uit de Personal PWA',
          branch: SCREENSHOT_BRANCH,
          // Wat achter de komma van de data:-URI staat is al base64 — precies
          // wat de API als bestandsinhoud verwacht.
          content: image.dataUrl.slice(image.dataUrl.indexOf(',') + 1),
        }),
      })
    } catch {
      throw new Error(strings.noConnection)
    }

    if (!response.ok) {
      throw new Error(describe(response.status, strings, strings.contentsMissingScope))
    }

    const data = await response.json()
    uploaded.push({ path, url: data.content.download_url })
  }

  return uploaded
}

/**
 * De plaatjes renderen in de issue via hun raw-URL; het pad staat er los bij,
 * want daarmee vindt de run ze in zijn eigen checkout terug.
 */
export function screenshotSection(uploaded: UploadedScreenshot[]): string {
  const images = uploaded.map((item) => `![](${item.url})`).join('\n')
  const paths = uploaded.map((item) => `\`${item.path}\``).join(', ')
  return `${images}\n\nStaat in de repo als ${paths} — daar met Read te openen.`
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

export type IssueComment = {
  id: number
  author: string
  fromClaude: boolean
  body: string
  createdAt: string
}

/**
 * The workflow posts as github-actions[bot], so anything not from you is
 * Claude talking back — a question, or the summary of what it built.
 */
export async function getComments(
  token: string,
  issueNumber: number,
  strings: GithubStrings,
): Promise<IssueComment[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(
    `https://api.github.com/repos/${REPO}/issues/${issueNumber}/comments?per_page=100`,
    { headers },
  )
  if (!response.ok) throw new Error(describe(response.status, strings))

  type RawComment = {
    id: number
    body: string
    created_at: string
    user: { login: string; type: string }
  }

  const data: RawComment[] = await response.json()
  return data.map((entry) => ({
    id: entry.id,
    author: entry.user.login,
    fromClaude: entry.user.type === 'Bot',
    body: entry.body,
    createdAt: entry.created_at,
  }))
}

/**
 * Answering re-triggers the workflow, which reads the whole thread and picks
 * up where it left off. Needs a token — commenting is not anonymous.
 */
export async function addComment(
  token: string,
  issueNumber: number,
  body: string,
  strings: GithubStrings,
): Promise<IssueComment> {
  let response: Response

  try {
    response = await fetch(
      `https://api.github.com/repos/${REPO}/issues/${issueNumber}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      },
    )
  } catch {
    throw new Error(strings.noConnection)
  }

  if (!response.ok) throw new Error(describe(response.status, strings))

  const data = await response.json()
  return {
    id: data.id,
    author: data.user.login,
    fromClaude: data.user.type === 'Bot',
    body: data.body,
    createdAt: data.created_at,
  }
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
