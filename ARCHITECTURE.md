# Architectuur

Persoonlijke PWA. Draait op Cloud Run achter IAP, met één toegelaten account.
GitHub is uitsluitend git-host.

| GitHub | GCP — project `jochem-personal-pwa` |
|---|---|
| de code | **Cloud Run `personal`** — statische build + API, achter IAP |
| Cloud Build App | **Firestore** — `state` (lijstjes) en `wishes` |
| | **Cloud Run Job `wish-agent`** — bouwt een wens |
| | **Cloud Build-trigger** — push naar `main` → deploy |
| | **Secret Manager** — `github-token`, `claude-oauth-token` |

Geen GitHub Actions, geen issues, geen labels, geen pull requests.

## De lus

```
wens in de app
   -> POST /api/wishes            (Firestore: status queued)
   -> API start de Cloud Run Job  (geen Eventarc ertussen)
   -> agent kloont, werkt, build + lint
        groen  -> squash naar main -> push
                  -> Cloud Build-trigger -> nieuwe revisie
        rood   -> branch blijft staan, status failed
        vraag  -> niets gewijzigd, status needs-answer
   -> jij antwoordt in de app -> POST /api/wishes/:id/reply -> opnieuw
```

## Beslissingen, en waarom

**Eén Cloud Run service voor app én API.** De app zit al achter IAP; een
tweede identiteitslaag met Firebase Auth zou een tweede login betekenen voor
één gebruiker. De API praat met Firestore via het service-account. Scheelt ook
de Firebase-SDK in de bundel, die groter is dan de hele app.

**State als JSON-string per sleutel.** Gelijk aan wat `localStorage` opslaat,
en het omzeilt Firestore's beperking op geneste arrays — een lijst met objecten
die zelf lijsten bevatten zou anders stukgaan.

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
