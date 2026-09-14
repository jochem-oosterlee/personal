# Architectuur

Persoonlijke PWA. Draait op Cloud Run achter IAP, met één toegelaten account.
GitHub is uitsluitend git-host.

| GitHub | GCP — project `jochem-personal-pwa` |
|---|---|
| de code | **Cloud Run `personal`** — statische build + API, achter IAP |
| Cloud Build App | **Firestore** — `state` (lijstjes) en `wishes` |
| | **Cloud Storage** — screenshots bij een wens, bucket dicht |
| | **Cloud Run Job `wish-agent`** — bouwt een wens |
| | **Cloud Build-trigger** — push naar `main` → deploy |
| | **Secret Manager** — `github-token`, `claude-oauth-token`, `gmail-oauth` |

Geen GitHub Actions, geen issues, geen labels, geen pull requests.

## De lus

```
wens in de app
   -> POST /api/wishes            (Firestore: status draft — start niets)
   -> bijschaven, screenshots erbij
   -> POST /api/wishes/:id/submit (status queued)
   -> API start de Cloud Run Job  (geen Eventarc ertussen)
   -> agent kloont, werkt, build + lint
        groen  -> squash naar main -> push
                  -> Cloud Build-trigger -> nieuwe revisie
        rood   -> branch blijft staan, status failed
        vraag  -> niets gewijzigd, status needs-answer
   -> jij antwoordt in de app -> POST /api/wishes/:id/reply -> opnieuw

verwijderen tijdens een run -> executions:cancel -> daarna pas weg
```

## Beslissingen, en waarom

**Eén Cloud Run service voor app én API.** De app zit al achter IAP; een
tweede identiteitslaag met Firebase Auth zou een tweede login betekenen voor
één gebruiker. De API praat met Firestore via het service-account. Scheelt ook
de Firebase-SDK in de bundel, die groter is dan de hele app.

**State als JSON-string per sleutel.** Gelijk aan wat `localStorage` opslaat,
en het omzeilt Firestore's beperking op geneste arrays — een lijst met objecten
die zelf lijsten bevatten zou anders stukgaan.

**Opruimen gebeurt vanzelf, niet met de hand.** Elke wens levert een deploy op
en dus een image en een revisie; in twee dagen liep Artifact Registry naar
1,9 GiB. `infra/artifact-cleanup.json` houdt de tien nieuwste versies per image
en gooit de rest na drie dagen weg. Rollbacks blijven zo mogelijk, en elk image
is hoe dan ook opnieuw te bouwen uit de commit waar het bij hoort. Cloud Run
kent geen automatisch opruimen voor revisies; die moeten periodiek met de hand.

**Screenshots in Cloud Storage, niet in Firestore.** Een document mag maximaal
1 MiB zijn; twee schermafdrukken passen daar al niet in. De bucket heeft public
access prevention, dus de app haalt ze op via de eigen API en daarmee langs
IAP. De agent downloadt ze naar `.wens-bijlagen/` in de kloon en houdt die map
buiten git via `.git/info/exclude` — dat bestand gaat nooit mee de commit in,
in tegenstelling tot `.gitignore`.

**`localStorage` blijft de bron waar de app uit leest.** Synchroon, en offline
werkt alles door. De server is een kopie die bij openen wordt opgehaald. Per
sleutel wint de laatste schrijver; dezelfde lijst tegelijk op twee toestellen
bewerken verliest er een. Bewust niet opgelost.

**Geen pull requests.** Die waren het mechanisme van `claude-code-action`.
Draait de agent zelf, dan bestaat een PR dertig seconden en kijkt niemand
ernaar. De diff lees je op `/compare/main...<branch>` — dezelfde weergave.

**De poort zit in de job, niet in de prompt.** Dat het model meldt dat build en
lint slagen is geen bewijs; de job draait ze zelf en mergt alleen bij groen.

**Het Claude-abonnement, niet de API.** `CLAUDE_CODE_OAUTH_TOKEN` is volgens de
documentatie bedoeld voor "CI pipelines and scripts", en de Agent SDK leest
dezelfde credentials als de CLI. De beperking in de SDK-docs gaat over het
*aanbieden* van claude.ai-rechten aan derden. Zodra anderen deze tool gebruiken
draaien hun runs op één seat en verschuift dat.

**Actiepunten uit tekst op dezelfde sleutel.** Het plakvak bij Taken laat
Claude actiepunten uit een geplakt stuk tekst halen, via `POST
/api/extract-tasks`. Dat loopt op `claude-oauth-token` — hetzelfde abonnement
als de wensen-job, dus geen tweede credential en geen kosten per aanroep. De
service leest het secret bij de eerste aanroep via de Secret Manager API in
plaats van als gemounte env-var: de service-instellingen staan bewust niet in
`cloudbuild.yaml`, dus een deploy kan er geen secret aan hangen. Een OAuth-token
op de Messages API is niet gedocumenteerd en kan stilvallen; dan geeft het
plakvak een melding en werkt de rest van Taken door.

**Gmail met een eigen OAuth-client, niet via de connector.** De Gmail-connector
van claude.ai is een door Anthropic gehoste MCP-server (`gmail.mcp.claude.com`)
waarvan de toestemming aan het claude.ai-account hangt; er is geen token dat
deze service daarvoor kan tonen, en `claude-oauth-token` geeft toegang tot het
model, niet tot connectors. De MCP-connector in de Messages API zou een server
vragen die Anthropic kan bereiken — deze zit achter IAP. Dus praat de server
rechtstreeks met de Gmail-API. Het refresh token komt uit een eenmalige consent
op de eigen machine (`infra/gmail-consent.mjs`) en staat in Secret Manager; de
app ziet het nooit, net zomin als het GitHub-token.

**De toestemming staat op "In production", ook zonder verificatie.** Bij
publicatiestatus *Testing* trekt Google een refresh token na zeven dagen in, en
dan valt Mail elke week stil. Een ongeverifieerde productie-app kost één
waarschuwingsscherm bij het koppelen, en daarna niets meer.

**Waar een antwoord heen gaat, bepaalt de server.** De app stuurt bij een
antwoord alleen de tekst mee; geadresseerde, onderwerp en `References` haalt de
server uit de draad. Zo kan een fout in het scherm geen mail naar de verkeerde
persoon sturen, en staat versturen los van wat de client denkt te weten.

**Mail staat niet in Firestore en niet in `localStorage`.** Alle andere
onderdelen zijn lijstjes die je zelf bijhoudt; een mailbox is dat niet. Een
verouderde kopie tonen is daar erger dan even niets tonen, dus haalt het
onderdeel bij elke weergave op wat er nú staat en blijft het offline leeg.

**Geen token meer op het toestel.** De app praat alleen met zijn eigen backend.
GitHub-credentials staan serverzijde in Secret Manager, met IAM eromheen.

## Vier valkuilen die dit gekost heeft

Alle vier eerst nagemeten, niet aangenomen.

**Een verlopen IAP-sessie maakt de app stil.** Een fetch loopt op de
cross-origin redirect naar `accounts.google.com` tegen CORS aan en gooit —
niet te onderscheiden van offline. De cache raakt níet vervuild, maar de app
opent uit cache, werkt niet en toont geen loginscherm. `lib/session.ts` sondeert
met `redirect: 'manual'`; alleen een `opaqueredirect` betekent verlopen sessie,
en dan volgt een navigatie naar `/__auth` — een pad dat de service worker met
rust laat en dus echt langs IAP komt.

**nginx achter Cloud Run maakte relatieve redirects absoluut** met `http` en
poort 8080, waarna er in de browser niets gebeurde. Opgelost met
`absolute_redirect off`, en inmiddels irrelevant omdat de server Node is.

**Een merge met `GITHUB_TOKEN` startte geen workflow.** Daardoor rolde de oude
deploy soms de commit van vóór de merge uit: alles groen, app onveranderd.
Cloud Build kent die anti-recursieregel niet.

**"Wis alle gegevens" wiste alleen lokaal**, waarna de eerstvolgende
synchronisatie alles terugzette. En de herlaad erna brak de DELETE af.

## Eenmalige inrichting

- Project in de organisatie, gekoppeld aan billing
- API's: Cloud Run, Cloud Build, Artifact Registry, IAP, Firestore,
  Secret Manager, Cloud Resource Manager, Gmail
- IAP op de service, `roles/iap.httpsResourceAccessor` op één principal
- Cloud Build-verbinding met GitHub, repository gekoppeld, trigger op `main`
  met een expliciet `--service-account` (nieuwe projecten eisen dat, en de
  foutmelding zegt dat niet)
- Service-account rollen: `run.admin`, `artifactregistry.writer`,
  `logging.logWriter`, `iam.serviceAccountUser`, `datastore.user`,
  `secretmanager.secretAccessor`
- OAuth-client van het type "Desktop app" voor Gmail, toestemmingsscherm op
  "In production" met de scopes `gmail.modify` en `gmail.send`
- `roles/secretmanager.admin` voor de Cloud Build-agent; daar bewaart hij het
  GitHub-token van de verbinding

## Secrets

`github-token` is een fine-grained PAT met `Contents: read and write` op deze
repo — de agent pusht ermee. `claude-oauth-token` komt uit
`claude setup-token`. `gmail-oauth` is JSON met `client_id`, `client_secret` en
`refresh_token`, afgedrukt door `node infra/gmail-consent.mjs` — scopes
`gmail.modify` en `gmail.send`.

De rollen staan per secret, niet op het project. Een nieuw secret is daarmee
onzichtbaar voor de service tot het zijn eigen binding krijgt, en een geweigerd
secret is van buiten niet te onderscheiden van een secret dat er niet is:

```
gcloud secrets add-iam-policy-binding gmail-oauth   --member=serviceAccount:690141536321-compute@developer.gserviceaccount.com   --role=roles/secretmanager.secretAccessor --project=jochem-personal-pwa
```

Nieuwe waarde toevoegen:

```
gcloud secrets versions add github-token --data-file=- --project=jochem-personal-pwa
```
