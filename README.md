# Personal

Persoonlijke PWA. Eerste onderdeel: een boodschappenlijstje.

Live: https://jochem-oosterlee.github.io/personal/

## Lokaal draaien

```bash
npm install
npm run dev
```

De service worker draait ook in dev (`devOptions.enabled`), dus installeren en
offline-gedrag zijn lokaal te testen.

```bash
npm run build     # tsc + vite build naar dist/
npm run preview   # dist/ serveren zoals in productie
```

## Wensen → issue → PR

De module **Wensen** dient een feature-verzoek in als GitHub-issue met het label
`enhancement`. Dat label start
[.github/workflows/claude.yml](.github/workflows/claude.yml), waarin Claude het
verzoek implementeert, `npm run build` en `npm run lint` draait en een pull
request opent. Mergen doe jij.

Drie dingen zijn eenmalig nodig:

1. **Repo-secret `ANTHROPIC_API_KEY`** — anders faalt de workflow.
   `gh secret set ANTHROPIC_API_KEY -R jochem-oosterlee/personal`
2. **Token in de app** (Instellingen → GitHub) — een fine-grained PAT met
   `Issues: read and write` op deze repo. Zonder token opent Wensen in plaats
   daarvan de GitHub-pagina met titel en toelichting vooringevuld.
3. **Actions mag PR's aanmaken** — staat standaard uit; zonder dit pusht Claude
   wel een branch maar opent hij geen PR.
   `gh api repos/jochem-oosterlee/personal/actions/permissions/workflow -X PUT -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true`

Het token staat in `localStorage` op je telefoon en gaat alleen naar
`api.github.com` — er is geen backend die hem doorgeeft. De workflow draait
alleen op issues van de repo-eigenaar, zodat niemand anders er Claude-runs mee
kan starten.

## Deploy

Elke push naar `main` bouwt en publiceert naar GitHub Pages via
[.github/workflows/deploy.yml](.github/workflows/deploy.yml).

De app wordt geserveerd vanaf `/personal/`. Die waarde staat als `base` in
[vite.config.ts](vite.config.ts) en wordt hergebruikt voor `start_url` en
`scope` in het manifest — pas hem op één plek aan als de repo hernoemd wordt.

## Structuur

```
src/
├─ App.tsx                      module-registry + tabbalk
├─ components/Checklist.tsx     gedeeld door Boodschappen en Taken
├─ lib/
│  ├─ storage.ts                usePersistentState + export/wissen
│  ├─ theme.ts                  licht/donker/systeem
│  └─ github.ts                 issue aanmaken vanuit Wensen
└─ modules/
   ├─ shopping/                 Boodschappen
   ├─ tasks/                    Taken
   ├─ notes/                    Notities
   ├─ wishes/                   Wensen
   └─ settings/                 Instellingen
```

Een onderdeel toevoegen: maak `src/modules/<naam>/` en zet een entry in de
`MODULES`-array in [src/App.tsx](src/App.tsx) met een icoon uit `lucide-react`.
De tab verschijnt dan vanzelf.

## Data

Alles staat in `localStorage` onder de prefix `personal:`, op het apparaat zelf.
Er is geen backend en er wordt niets gesynchroniseerd tussen apparaten.
Exporteren en wissen kan via Instellingen.

`usePersistentState` houdt hooks op dezelfde sleutel binnen één document
gesynchroniseerd, en luistert op `storage` voor andere tabs.

## Vormgeving

Minimaal: zandkleurig palet, hairlines in plaats van vlakken en schaduwen,
geen afgeronde hoeken. Alle kleuren zijn custom properties in
[src/index.css](src/index.css); licht en donker verschillen alleen in die
waarden.

Font is JetBrains Mono, self-hosted via `@fontsource-variable/jetbrains-mono`.
Alleen de latin-subset wordt aangehaald (één variabel woff2 van ~40 kB), zodat
de service worker het kan precachen en de app offline hetzelfde oogt.

Iconen komen uit `lucide-react` met een dunne `strokeWidth`.

## Icons

Gegenereerd uit [public/favicon.svg](public/favicon.svg):

```bash
npx pwa-assets-generator --preset minimal-2023 public/favicon.svg
```
