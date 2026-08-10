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
| | **Secret Manager** — `github-token`, `claude-oauth-token` |

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
  Secret Manager, Cloud Resource Manager
- IAP op de service, `roles/iap.httpsResourceAccessor` op één principal
- Cloud Build-verbinding met GitHub, repository gekoppeld, trigger op `main`
  met een expliciet `--service-account` (nieuwe projecten eisen dat, en de
  foutmelding zegt dat niet)
- Service-account rollen: `run.admin`, `artifactregistry.writer`,
  `logging.logWriter`, `iam.serviceAccountUser`, `datastore.user`,
  `secretmanager.secretAccessor`
- `roles/secretmanager.admin` voor de Cloud Build-agent; daar bewaart hij het
  GitHub-token van de verbinding

## Secrets

`github-token` is een fine-grained PAT met `Contents: read and write` op deze
repo — de agent pusht ermee. `claude-oauth-token` komt uit
`claude setup-token`. Nieuwe waarde toevoegen:

```
gcloud secrets versions add github-token --data-file=- --project=jochem-personal-pwa
```
