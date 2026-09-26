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

### Overzicht

Het schriftpictogram bovenin opent het overzicht: één levende lijst van
draden die op iemand wachten — boven wat op jou wacht, daaronder waar jij op
wacht. **Bijwerken** haalt alleen de mail sinds de vorige keer op en laat Claude
niet een tekst maar wijzigingen teruggeven: toevoegen, bijwerken, sluiten (met
reden). De app past ze toe.

Alleen je postvak telt: gearchiveerd is jouw signaal dat iets af is. Archiveer
je in Gmail een draad die in het overzicht staat, dan verdwijnt hij bij de
volgende bijwerking vanzelf — zonder dat Claude daarover oordeelt.

Elke regel hangt aan een Gmail-draad. Het vinkje is afhandelen: weg uit de
lijst, maar nieuwe mail in die draad mag hem terugbrengen. Het kruisje is weg
voorgoed: die draad wordt al uit de mail gefilterd voordat Claude hem ziet.
Wat Claude sinds de vorige keer sloot staat er even onder, met de reden en een
knop om het terug te zetten. Wat jij zelf wegkruiste of afvinkte staat onder
*Verborgen*, ingeklapt, ook met terugzetknop — "voorgoed" moet je kunnen
nakijken. Onderin het logboek: per bijwerking wat er binnenkwam en veranderde.

### Samenvatting van een periode

Vanuit het overzicht, of los. Een samenvatting van een periode: sinds de
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

## Games

Een lijstje spellen om in de gaten te houden. Je zoekt op naam; genre, korte
omschrijving, of het early access is, de releasedatum en de winkellink komen van
Steam. **Bijwerken** haalt alles opnieuw op, één spel tegelijk — Steam knijpt bij
een reeks verzoeken ineens, en wat niet lukt blijft staan zoals het was.

Steam's storefront-API is publiek en heeft geen sleutel nodig, maar stuurt geen
CORS-koppen: het loopt dus via de eigen server (`/api/games`), net als Gmail en
Claude. De lijst zelf staat in de gedeelde staat, net als de andere lijstjes.

Early access is bij Steam geen vlag maar een genre (id 70), en "uitgebracht" is
hier: de 1.0 staat er. Een datum voor die 1.0 publiceert Steam niet — dat staat
hooguit in de tekst van de winkelpagina. Bijwerken vangt het wel op: zodra een
spel early access verlaat, verspringt de regel.

### Van het web

Niet elk spel staat op Steam; van sommige heeft alleen de studio zelf een
pagina. Onder de zoekresultaten staat daarom **Op het web zoeken**. Claude zoekt
het spel op, leest de officiële site, de uitgever en een winkelpagina, en wat
hij vindt gaat meteen de lijst in — naam, genre, omschrijving, status, datum en
de links waar het vandaan komt — net als een spel dat je uit de resultaten van
Steam kiest. Welke naam het geworden is staat onder het zoekveld, want de lijst
staat op naam; klopt het niet, dan gooit de prullenbak hem er weer uit. Bij
**Bijwerken** wordt hij op dezelfde manier opnieuw opgezocht.

Diezelfde weg haalt de datum die Steam niet noemt. Klap een spel dat er nog niet
is open en kies **1.0 op het web zoeken** — bij een spel dat nog moet
verschijnen heet dat **Datum op het web zoeken**, want daar blijft Steam vaak
bij een jaartal terwijl de makers elders al een dag genoemd hebben. Wat ze
erover gezegd hebben staat in het uitklapbare stuk, met de bronnen erbij; in de
badge blijft de datum van Steam staan, met eronder een korte aanduiding
(`→ ~2027`) zodat je zonder uitklappen ziet waar de regel op wacht. Is het spel
er bij een volgende bijwerking nog niet, dan blijft het staan; is het er
eenmaal, dan verdwijnt het met de vraag.

Dit kost een aanroep van Claude met websearch, dus het gebeurt alleen op
verzoek — en het duurt een halve minuut in plaats van een seconde. Staan er
spellen van het web in je lijst, dan duurt bijwerken navenant langer.

## Boodschappen

Een lijstje als Taken, zonder deadlines: typen, afvinken, afgevinkte wissen.
Het staat in de gedeelde staat, dus het lijstje is op elk toestel hetzelfde.

Het camera-icoon naast de plusknop opent het fotovak. Je maakt een foto — van
een briefje, een recept, een schap in de koelkast, een verpakking die op is —
en Claude noemt wat er dan gehaald moet worden. Dat is een voorstel: je vinkt
aan wat mee mag en dan pas staat het op het lijstje, net als bij het plakvak
bij Taken. Zoeken is een aparte druk, zodat een mislukte foto niets kost.

De foto wordt nergens bewaard. Hij wordt op het toestel verkleind, gaat mee in
dat ene verzoek naar `/api/extract-groceries` en is daarna weg.

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
├─ components/Photo.tsx         fotovak bij Boodschappen: foto in, producten uit
├─ components/Suggestions.tsx   kies welke actiepunten je overneemt
├─ components/Markdown.tsx      kleine markdown-weergave voor Claude's antwoorden
├─ lib/
│  ├─ storage.ts                usePersistentState + synchronisatie
│  ├─ migrations.ts             eenmalige verhuizingen van opgeslagen gegevens
│  ├─ sync.ts                   praat met /api/state
│  ├─ session.ts                herkent een verlopen IAP-sessie
│  ├─ wishes.ts                 praat met /api/wishes
│  ├─ tasks.ts                  praat met /api/extract-tasks
│  ├─ groceries.ts              praat met /api/extract-groceries
│  ├─ mail.ts                   praat met /api/mail
│  ├─ games.ts                  praat met /api/games (Steam en web)
│  ├─ models.ts                 keuze van het model
│  ├─ autogrow.ts               tekstvelden die meegroeien met hun inhoud
│  ├─ version.ts                draait dit toestel de laatste build?
│  └─ theme.ts                  licht/donker/systeem
└─ modules/
   ├─ tasks/                    Taken — schakelt tussen persoonlijk en werk
   ├─ shopping/                 Boodschappen — lijstje, met een foto erbij
   ├─ mail/                     Mail
   ├─ notes/                    Notities
   ├─ games/                    Games — lijstje spellen, gegevens van Steam
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

Lopende tekst in alle onderdelen heeft één maat, `--text-size` (0.8125rem),
geërfd via `.app__main`; alleen labels en meta zijn kleiner. Invoervelden
volgen `--input-size`, dezelfde maat — behalve op iOS, waar een veld onder
16px inzoomt bij focus en het daarom `max(1rem, …)` blijft.

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
