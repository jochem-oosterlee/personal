# Architectuur — huidige opzet en waar het heen gaat

## Nu

Statische PWA op GitHub Pages. Alle gegevens staan in `localStorage` op het
apparaat zelf; er is geen backend. Een wens wordt een GitHub-issue met het label
`enhancement`, dat start een workflow waarin Claude het bouwt, `npm run build`
en `npm run lint` draait, mergt en uitrolt.

Details van die keten staan in [README.md](README.md).

## Waar het heen gaat

Alles behalve de code verhuist naar één GCP-project. GitHub blijft over als
git-host, verder niets.

| GitHub | GCP |
|---|---|
| de code | Cloud Run service — statische build + kleine API, achter IAP |
| Cloud Build App geïnstalleerd | Firestore — wensen, draad, status |
| | Cloud Run Job — de agent (Claude Agent SDK) |
| | Cloud Build trigger — deploy bij push naar `main` |
| | Secret Manager — push-credential, Claude-token |

Wat verdwijnt: alle workflow-YAML, issues, labels, PR's, de guards op wie mag
triggeren, en de losse `wish-assets`-branch voor screenshots.

## Beslissingen, en waarom

**IAP met één principal, geen domein-brede toegang.** De app is voor één
persoon. Toegang via `roles/iap.httpsResourceAccessor` op dat ene account.

**Geen Firebase Auth naast IAP.** De app zit al achter IAP; een tweede
inlogstap voor één gebruiker is onzin. De API draait in dezelfde Cloud Run
service en praat met Firestore via het service-account van die service. Scheelt
ook de Firebase-SDK in de bundel, die groter is dan de hele app nu.

**Het Claude-abonnement blijft.** `CLAUDE_CODE_OAUTH_TOKEN` is volgens de
documentatie bedoeld voor "CI pipelines and scripts", en de Agent SDK leest
dezelfde credentials als de CLI. De beperking in de SDK-docs gaat over het
*aanbieden* van claude.ai-rechten aan derden — niet over een eigen script met
een eigen token. Zodra anderen de tool gaan gebruiken draaien hun runs op één
seat, en dan verschuift dat.

**Geen pull requests.** Die waren het mechanisme van `claude-code-action`. Draait
de agent zelf, dan bestaat een PR dertig seconden en kijkt niemand ernaar. De
job pusht een branch; bij groen squasht hij naar `main`, bij rood of bij een
review-vlag blijft de branch staan. De diff lees je op
`/compare/main...<branch>` — dezelfde weergave als een PR.

**Geen GitHub Actions.** Cloud Build draait in hetzelfde project, met dezelfde
IAM en audit-logs. Dat scheelt ook Workload Identity Federation: er hoeft niets
van buiten GCP te deployen.

## Twee problemen die hiermee verdwijnen

**Deploys die niet startten.** GitHub vuurt geen workflows af op een push met
`GITHUB_TOKEN`, waardoor `claude.yml` nu zelf `pages.yml` moet aanroepen — en
een keer de commit van vóór de merge uitrolde. Cloud Build kent die
anti-recursieregel niet: pushen naar `main` vuurt de webhook, en dat is het
enige pad.

**Runners die er niet waren.** Een deploy-job stond 6 augustus een kwartier op
een runner te wachten en werd toen geannuleerd, zonder log. Dat kan op Cloud Run
niet gebeuren.

## Volgorde

Elke stap is los bruikbaar; na elke stap werkt de app.

1. **Hosting** — Cloud Run + IAP. Zelfde app, achter je Workspace-account.
2. **API + Firestore** — wensen en de vraag/antwoord-draad. Lijstjes kunnen mee
   (synchronisatie tussen apparaten) of in `localStorage` blijven.
3. **Runner** — Cloud Run Job met de Agent SDK, getriggerd vanuit Firestore.
4. **Opruimen** — workflows, issues en labels weg.

## Open punten

**Mag er een project aangemaakt worden in de organisatie?** Zo niet, dan moet
iemand het aanmaken of hangt de service onder een bestaand project.

**IAP en de service worker.** IAP werkt met cookies. Loopt de sessie af, dan
krijgt een fetch geen bestand maar een loginredirect terug. Belandt die HTML in
de cache van de service worker, dan is de app stuk op een manier die lastig te
herleiden is. Dit testen met een kale deploy *vóór* de echte verhuizing.

**Offline.** Nu triviaal: `localStorage` is synchroon en werkt zonder netwerk.
Gaan de lijstjes naar Firestore, dan is dat een echte afweging en geen
detail.
