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
[.github/workflows/claude.yml](.github/workflows/claude.yml), en van daar loopt
het door zonder tussenkomst: Claude implementeert het verzoek en opent een PR,
de workflow draait zelf `npm run build` en `npm run lint` op die PR, mergt bij
groen, en publiceert naar Pages.

Die build-en-lint-stap staat bewust in de workflow en niet alleen in de prompt —
dat het model zégt dat het slaagt, is geen bewijs. Faalt de poort, dan blijft de
PR open met een comment erbij en verandert er niets aan `main`.

Er kijkt dus niemand mee voordat het op je telefoon staat. Voor een wens waar je
wél eerst naar wilt kijken: zet het label `review` op de issue. De workflow
bouwt en opent dan wel een PR, maar mergt hem niet. Wil je het permanent, haal
dan de stappen `Mergen` en `deploy` uit claude.yml.

**Draait mijn telefoon de laatste versie?** Onderaan Instellingen staat de
build (datum + commit) naast de laatste commit op `main`, opgehaald zonder
token. Lopen die uit elkaar, dan verschijnen twee knoppen: *App vernieuwen*
(service worker laten kijken en herladen) en *Deploy opnieuw starten*
(`workflow_dispatch` op deploy.yml, vereist `Actions: write` op het token). Die
tweede is er omdat een deploy kan stranden op een lege GitHub-wachtrij: `main`
is dan bij, de site niet, en niets vertelt je dat.

**Wie kan een run starten.** Alleen jij. De guards eisen dat de *auteur* van de
issue (niet degene die labelt) de repo-eigenaar is, en hetzelfde voor comments;
`workflow_dispatch` vereist schrijfrechten. Een buitenstaander zonder token valt
in de app terug op GitHub's eigen formulier, en kan daar het `enhancement`-label
niet zetten. Er is dus geen route waarlangs iemand anders jouw Claude-budget
aanspreekt.

Wel kan iedereen op een publieke issue reageren, en die comments belanden in de
context zodra jij antwoordt. De prompt zegt daarom expliciet dat alleen de
openingspost en comments van de eigenaar opdrachten zijn. Wil je dat harder
dichtzetten: Settings → Moderation → Interaction limits beperkt reageren tot
collaborators.

**Als Claude een vraag heeft** pusht hij niets en reageert hij op de issue. Een
antwoord van jou op diezelfde issue start de workflow opnieuw, en hij leest de
hele draad met `gh issue view --comments`. Die comment-trigger heeft eigen
guards: geen bots (anders reageert hij op zichzelf), geen PR-comments (GitHub
stuurt die door hetzelfde event) en alleen op open issues.

**Model kiezen** doe je in Instellingen → Model voor wensen. De app schrijft
`Model: <id>` onderaan de issue-body. De workflow leest die regel, maar geeft
hem niet door: hij matcht tegen een vaste lijst in de stap `Model bepalen` en
valt bij alles wat daar niet in staat terug op `claude-opus-5`. Die waarde komt
immers van buiten en gaat een CLI-argument in. Voeg je een model toe, doe dat
dan op beide plekken — `MODELS` in [src/lib/github.ts](src/lib/github.ts) en de
`case` in claude.yml.

Pages zit in [pages.yml](.github/workflows/pages.yml) als herbruikbare workflow,
aangeroepen door zowel deploy.yml als claude.yml. Reden: een merge met
`GITHUB_TOKEN` vuurt geen push-event af dat andere workflows start, dus na een
auto-merge moet claude.yml de deploy zelf aanroepen.

Drie dingen zijn eenmalig nodig:

1. **Repo-secret `CLAUDE_CODE_OAUTH_TOKEN`** — anders faalt de workflow. Draait
   op het Claude-abonnement in plaats van op API-facturering.
   `claude setup-token` en dan
   `gh secret set CLAUDE_CODE_OAUTH_TOKEN -R jochem-oosterlee/personal`.
   Terug naar de API kan met één regel in claude.yml; `ANTHROPIC_API_KEY` staat
   er nog als terugval. Zet ze niet allebei aan — de action accepteert dat, maar
   welke voorrang krijgt is niet gedocumenteerd.
2. **Token in de app** (Instellingen → GitHub) — een fine-grained PAT met
   `Issues: read and write` op deze repo. Zonder token opent Wensen in plaats
   daarvan de GitHub-pagina met titel en toelichting vooringevuld. Wil je bij
   een wens ook een screenshot kunnen meesturen, zet dan ook
   `Contents: read and write` aan. Screenshots gaan via de Contents API als
   bestand naar `screenshots/` op `main` — de issue verwijst naar de raw-URL én
   naar dat pad, zodat de run die de wens oppakt de afbeelding met `Read` kan
   openen in plaats van hem alleen als link te zien. Elke upload is dus een
   commit op `main`, en die start een Pages-deploy. Screenshots komen alleen
   mee bij het versturen mét token; zonder token werkt slepen/plakken van een
   screenshot al vanzelf in het GitHub-formulier dat dan opent.
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
