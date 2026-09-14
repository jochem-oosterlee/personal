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

## Mail

Gmail in de app zelf: lezen, archiveren, een ster, actiepunten eruit halen en
antwoorden. De server praat met de Gmail-API; de app praat alleen met de server,
net als bij wensen.

De Gmail-connector van claude.ai kan hier niet voor gebruikt worden — dat is een
MCP-server van Anthropic waarvan de toestemming aan het claude.ai-account hangt.
Eenmalig koppelen gaat zo:

1. Gmail-API aanzetten in `jochem-personal-pwa`, het toestemmingsscherm op
   **Internal** zetten — het project zit in de cleverbase.com-organisatie, dus
   dat kan, en dan is er geen verificatie en geen verval — en een OAuth-client
   van het type **Desktop app** aanmaken. Moet het een privé-Gmail worden, dan
   is het External en moet de app **gepubliceerd** zijn: op *Testing* trekt
   Google het refresh token na zeven dagen weer in.
2. `node infra/gmail-consent.mjs <client-id> <client-secret>` — dat opent één
   keer het toestemmingsscherm en drukt af wat er in Secret Manager moet.
3. Dat commando draaien; het secret heet `gmail-oauth`.

Tot dat gebeurd is zegt het onderdeel dat het nog niet gekoppeld is en werkt de
rest van de app gewoon door.

### Samenvatting

Het schriftpictogram bovenin geeft een samenvatting van een periode: sinds de
vorige samenvatting, vandaag, deze week, vorige week of een losse dag. Het
moment van de vorige keer staat in de gedeelde staat, dus dat klopt ook als je
hem gisteren op een ander toestel opvroeg.

Onder "wat er wel en niet in mag" staan drie vaste vinkjes — nieuwsbrieven,
automatische notificaties, mail waarin je alleen in cc staat — en daaronder je
eigen aanwijzingen, elk als eigen vinkje. Uitvinken laat er een even buiten,
het kruisje gooit hem weg. Wat de vinkjes hebben weggelaten staat boven de
samenvatting, zodat het niet stil gebeurt.

De samenvattingen blijven bewaard (de laatste tien). Je komt binnen op de
nieuwste, eerdere staan eronder. Levert "sinds vorige keer" niets op, dan blijft
de vorige gewoon staan in plaats van dat je met een leeg scherm achterblijft.

Dit is de duurste knop in de app: elke draad wordt volledig opgehaald en gaat
langs Claude. Reken op een halve tot hele minuut voor een dag.

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
├─ components/Suggestions.tsx   kies welke actiepunten je overneemt
├─ components/Markdown.tsx      kleine markdown-weergave voor Claude's antwoorden
├─ lib/
│  ├─ storage.ts                usePersistentState + synchronisatie
│  ├─ migrations.ts             eenmalige verhuizingen van opgeslagen gegevens
│  ├─ sync.ts                   praat met /api/state
│  ├─ session.ts                herkent een verlopen IAP-sessie
│  ├─ wishes.ts                 praat met /api/wishes
│  ├─ tasks.ts                  praat met /api/extract-tasks
│  ├─ mail.ts                   praat met /api/mail
│  ├─ models.ts                 keuze van het model
│  ├─ autogrow.ts               tekstvelden die meegroeien met hun inhoud
│  ├─ version.ts                draait dit toestel de laatste build?
│  └─ theme.ts                  licht/donker/systeem
└─ modules/
   ├─ tasks/                    Taken — schakelt tussen persoonlijk en werk
   ├─ mail/                     Mail
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

Mail is de uitzondering: daar staat niets van in `localStorage`. Een mailbox is
geen lijst die je zelf bijhoudt, en een oude kopie tonen is erger dan even niets
tonen — offline blijft dat onderdeel dus leeg.

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

[public/favicon.svg](public/favicon.svg) is de enige bron — het is
`scroll-text` uit lucide. Alle andere formaten (favicon.ico, de pwa-PNG's, het
maskable icoon en apple-touch) worden tijdens `npm run build` gegenereerd door
`vite-plugin-pwa`, volgens [pwa-assets.config.ts](pwa-assets.config.ts). Ze
horen dus niet in de repository: wie het icoon wil wijzigen, past alleen de SVG
aan.
