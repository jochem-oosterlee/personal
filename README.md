# Personal

Persoonlijke PWA. Eerste onderdeel: een takenlijstje.

Live: https://personal-690141536321.europe-west4.run.app — achter IAP, één
toegelaten account.

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

## Wensen

Een wens in de app maakt een document in Firestore aan en start de Cloud Run
Job `wish-agent`. Die kloont de repo, laat Claude het bouwen, draait
`npm run build` en `npm run lint`, en squasht bij groen naar `main`. Die push
start de Cloud Build-trigger, dus de app is even later bijgewerkt.

Bij rood blijft de branch staan en zie je de bouwfout bij de wens. Heeft Claude
een vraag, dan wijzigt hij niets en kun je in de app antwoorden — dat start hem
opnieuw met de hele draad erbij.

Er zijn geen GitHub-issues, labels of pull requests meer, en de app heeft geen
GitHub-token nodig. Zie [ARCHITECTURE.md](ARCHITECTURE.md).

## Deploy

Push naar `main` -> Cloud Build -> nieuwe revisie op Cloud Run. Er zijn geen
GitHub Actions meer.

Handmatig:

```bash
gcloud builds triggers run personal-deploy --region=europe-west4 --branch=main
```

## Structuur

```
src/
├─ App.tsx                      module-registry + tabbalk
├─ components/Checklist.tsx     de lijst met afvinkbare regels bij Taken
├─ components/Extract.tsx       plakvak bij Taken: tekst in, actiepunten uit
├─ components/Markdown.tsx      kleine markdown-weergave voor Claude's antwoorden
├─ lib/
│  ├─ storage.ts                usePersistentState + synchronisatie
│  ├─ migrations.ts             eenmalige verhuizingen van opgeslagen gegevens
│  ├─ sync.ts                   praat met /api/state
│  ├─ session.ts                herkent een verlopen IAP-sessie
│  ├─ wishes.ts                 praat met /api/wishes
│  ├─ tasks.ts                  praat met /api/extract-tasks
│  ├─ models.ts                 keuze van het model
│  ├─ autogrow.ts               tekstvelden die meegroeien met hun inhoud
│  ├─ version.ts                draait dit toestel de laatste build?
│  └─ theme.ts                  licht/donker/systeem
└─ modules/
   ├─ tasks/                    Taken — schakelt tussen persoonlijk en werk
   ├─ notes/                    Notities
   ├─ wishes/                   Wensen
   └─ settings/                 Instellingen
```

Een onderdeel toevoegen: maak `src/modules/<naam>/` en zet een entry in de
`MODULES`-array in [src/App.tsx](src/App.tsx) met een icoon uit `lucide-react`.
De tab verschijnt dan vanzelf.

## Data

`localStorage` onder de prefix `personal:` blijft de bron waar de app uit
leest — synchroon, en offline werkt alles door. Bij het openen en bij terugkeer
naar de voorgrond wordt `/api/state` opgehaald en worden wijzigingen
teruggeschreven, zodat je lijstjes op elk toestel gelijk staan.

Per sleutel wint de laatste schrijver. Dezelfde lijst tegelijk op twee
toestellen bewerken verliest er een; dat is bewust niet opgelost.

`usePersistentState` houdt ook hooks op dezelfde sleutel binnen één document
gelijk, en luistert op `storage` voor andere tabs.

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

Het icoon is `scroll-text` uit lucide, in dezelfde kleuren en lijndikte als de
iconen in de app. Bron is [public/favicon.svg](public/favicon.svg); favicon,
PWA- en apple-touch-iconen worden daar bij elke build uit gegenereerd door
`vite-plugin-pwa` (`pwaAssets`), met de instellingen uit
[pwa-assets.config.ts](pwa-assets.config.ts). Alleen de SVG staat dus in de
repo — de SVG aanpassen is genoeg, een los commando is er niet meer.
