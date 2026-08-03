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
├─ lib/storage.ts               usePersistentState (localStorage + tab-sync)
└─ modules/
   └─ shopping/ShoppingList.tsx
```

Een onderdeel toevoegen: maak `src/modules/<naam>/` en zet een entry in de
`MODULES`-array in [src/App.tsx](src/App.tsx). De tabbalk verschijnt vanzelf
zodra er meer dan één module is.

## Data

Alles staat in `localStorage` onder de prefix `personal:`, op het apparaat zelf.
Er is geen backend en er wordt niets gesynchroniseerd tussen apparaten.

## Icons

Gegenereerd uit [public/favicon.svg](public/favicon.svg):

```bash
npx pwa-assets-generator --preset minimal-2023 public/favicon.svg
```
