/**
 * Bouwt één wens. Draait als Cloud Run Job, aangeroepen door de API.
 *
 * Waar dit vandaan komt: dit verving claude-code-action op GitHub Actions.
 * Wat daar de "lijm" was — issues, labels, PR's, guards op wie mag triggeren —
 * bestaat hier niet meer. De wens staat in Firestore, de agent werkt in een
 * kloon van de repo, en bij groen gaat het rechtstreeks naar main.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Firestore, FieldValue } from '@google-cloud/firestore'
import { query } from '@anthropic-ai/claude-agent-sdk'

const WISH_ID = process.env.WISH_ID
const REPO = process.env.REPO ?? 'jochem-oosterlee/personal'

/**
 * Deploy key in plaats van een persoonlijk token: die mag alleen pushen naar
 * deze ene repo, hangt aan de repository en niet aan een persoon, en blijft
 * dus werken als de eigenaar ooit weggaat.
 */
const DEPLOY_KEY = process.env.GITHUB_DEPLOY_KEY

// Gelijk aan de lijst in de app; alles daarbuiten valt terug op de default.
const MODELS = new Set(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'])
const DEFAULT_MODEL = 'claude-opus-5'

const db = new Firestore()
const wishes = db.collection('wishes')

/** Gevuld zodra de sleutel op schijf staat; git gebruikt hem via GIT_SSH_COMMAND. */
let gitEnv = process.env

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    env: gitEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  })
}

/** Draait een commando en zegt alleen of het lukte, met de uitvoer erbij. */
function tryRun(command, args, cwd) {
  try {
    return { ok: true, output: run(command, args, cwd) }
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}` || String(error)
    return { ok: false, output: out }
  }
}

async function update(fields) {
  await wishes.doc(WISH_ID).set(
    { ...fields, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  )
}

async function say(text) {
  await wishes.doc(WISH_ID).set(
    {
      messages: FieldValue.arrayUnion({
        role: 'claude',
        text,
        at: new Date().toISOString(),
      }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
}

function buildPrompt(wish) {
  const thread = (wish.messages ?? [])
    .map((m) => `${m.role === 'user' ? 'Indiener' : 'Jij'}: ${m.text}`)
    .join('\n\n')

  return `Implementeer deze wens in de repository waarin je staat.

Titel: ${wish.title}
${wish.detail ? `\nToelichting:\n${wish.detail}` : ''}
${thread ? `\nEerdere uitwisseling:\n${thread}` : ''}

Dit is een persoonlijke PWA: Vite + React + TypeScript, met een module-registry
in src/App.tsx. Lees README.md en ARCHITECTURE.md voor de structuur en volg de
bestaande stijl — zandkleurig palet, hairlines, JetBrains Mono, lucide-iconen,
geen afgeronde hoeken. Kleuren en maten zijn custom properties in
src/index.css; gebruik die in plaats van nieuwe waarden te verzinnen.

Blijf bij wat er gevraagd wordt. Dit gaat automatisch naar productie zodra
build en lint slagen, dus er kijkt niemand mee voordat het live staat. Geen
extra features, geen refactors die er niet bij horen.

Commit of push niet zelf; dat doet de omgeving na jouw wijzigingen.

Is het verzoek onduidelijk of te groot, wijzig dan niets en leg in je antwoord
uit wat je nodig hebt. Stel één concrete vraag met de opties die je ziet — de
indiener kan antwoorden en dan word je opnieuw gestart met die draad erbij.`
}

async function main() {
  if (!WISH_ID) throw new Error('WISH_ID ontbreekt')
  if (!DEPLOY_KEY) throw new Error('GITHUB_DEPLOY_KEY ontbreekt')

  const snapshot = await wishes.doc(WISH_ID).get()
  if (!snapshot.exists) throw new Error(`wens ${WISH_ID} bestaat niet`)
  const wish = snapshot.data()

  await update({ status: 'running', error: FieldValue.delete() })

  const work = mkdtempSync(path.join(tmpdir(), 'wish-'))
  const dir = path.join(work, 'repo')

  try {
    // Secret Manager levert de sleutel als env-var; ssh wil hem als bestand,
    // alleen leesbaar voor de eigenaar, en met een afsluitende newline.
    const keyFile = path.join(work, 'deploy_key')
    writeFileSync(keyFile, DEPLOY_KEY.trim() + '\n', { mode: 0o600 })
    gitEnv = {
      ...process.env,
      GIT_SSH_COMMAND: `ssh -i ${keyFile} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${path.join(work, 'known_hosts')}`,
    }

    run('git', ['clone', '--depth', '50', `git@github.com:${REPO}.git`, dir])
    run('git', ['config', 'user.email', 'wensen@jochem-personal-pwa.iam.gserviceaccount.com'], dir)
    run('git', ['config', 'user.name', 'Wensen'], dir)

    const branch = `wish/${WISH_ID}`
    run('git', ['checkout', '-b', branch], dir)

    const model = MODELS.has(wish.model) ? wish.model : DEFAULT_MODEL
    let answer = ''

    for await (const message of query({
      prompt: buildPrompt(wish),
      options: {
        model,
        cwd: dir,
        allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'WebFetch'],
      },
    })) {
      // Het laatste tekstblok is Claude's antwoord aan de indiener; de rest is
      // tussenwerk dat niemand hoeft te lezen.
      if (message.type === 'result' && typeof message.result === 'string') {
        answer = message.result
      } else if (message.type === 'assistant') {
        const text = (message.message?.content ?? [])
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n')
        if (text.trim()) answer = text
      }
    }

    if (answer.trim()) await say(answer.trim())

    const changed = run('git', ['status', '--porcelain'], dir).trim()
    if (!changed) {
      // Niets gewijzigd betekent bijna altijd: Claude heeft een vraag gesteld.
      await update({ status: 'needs-answer' })
      return
    }

    run('git', ['add', '-A'], dir)
    run('git', ['commit', '-m', `${wish.title}\n\nWens ${WISH_ID}`], dir)

    // De poort staat hier, niet in de prompt: dat het model zegt dat het
    // slaagt is geen bewijs.
    const install = tryRun('npm', ['ci'], dir)
    const build = install.ok ? tryRun('npm', ['run', 'build'], dir) : install
    const lint = build.ok ? tryRun('npm', ['run', 'lint'], dir) : build

    if (!lint.ok) {
      run('git', ['push', 'origin', branch], dir)
      await update({
        status: 'failed',
        branch,
        error: lint.output.slice(-4000),
      })
      return
    }

    run('git', ['checkout', 'main'], dir)
    run('git', ['merge', '--squash', branch], dir)
    run('git', ['commit', '-m', `${wish.title}\n\nWens ${WISH_ID}`], dir)
    run('git', ['push', 'origin', 'main'], dir)

    const commit = run('git', ['rev-parse', '--short', 'HEAD'], dir).trim()
    await update({ status: 'done', commit, branch: FieldValue.delete() })
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

main().catch(async (error) => {
  console.error(error)
  try {
    await update({ status: 'failed', error: String(error).slice(0, 4000) })
  } catch {
    // Firestore onbereikbaar: de job faalt sowieso, het log heeft het al.
  }
  process.exitCode = 1
})
