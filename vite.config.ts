import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Twee hosts tegelijk: GitHub Pages serveert onder /personal/, Cloud Run onder
// de root. Uit een env-var zodat één codebase beide bedient en Pages blijft
// werken zolang Cloud Run nog niet bewezen is. De trailing slash is nodig voor
// de scope van de service worker.
const base = process.env.APP_BASE ?? '/personal/'

// In een container is er geen git-repository, dus geeft de build het hash mee
// als env-var. Lokaal blijft git de bron, en faalt allebei dan draait de build
// door in plaats van te stoppen op een versieregel.
function shortCommit() {
  if (process.env.COMMIT_SHA) return process.env.COMMIT_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'onbekend'
  }
}

const commitHash = shortCommit()
const buildDate = new Date().toISOString().slice(0, 10)

// https://vite.dev/config/
export default defineConfig({
  base,
  define: {
    __BUILD_VERSION__: JSON.stringify(`${buildDate} ${commitHash}`),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Favicon, PWA- en apple-touch-iconen rollen bij elke build uit
      // public/favicon.svg, met de instellingen uit pwa-assets.config.ts. Zo
      // hoeven de gegenereerde PNG's niet in de repo, en kan een nieuw icoon
      // niet half doorgevoerd raken. De generator schrijft ze in closeBundle,
      // dus vóór de service worker zijn precache-lijst opmaakt.
      //
      // De iconlinks en de theme-color staan met de hand in index.html — die
      // laatste past een script vóór de eerste paint aan voor donker, en een
      // tweede meta-tag zou die keuze onbetrouwbaar maken.
      pwaAssets: {
        config: true,
        includeHtmlHeadLinks: false,
        injectThemeColor: false,
      },
      manifest: {
        name: 'Personal',
        short_name: 'Personal',
        description: 'Persoonlijke app — takenlijstje en meer',
        lang: 'nl',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f1e7',
        theme_color: '#f6f1e7',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // ico staat erbij omdat favicon.ico niet meer via includeAssets uit
        // public/ komt maar naast de PNG's in dist wordt gegenereerd.
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2,webmanifest}'],
        navigateFallback: `${base}index.html`,
        // /__auth en /__session moeten écht het netwerk op: dat is de enige
        // route langs IAP. Vangt de worker ze af, dan kom je bij een verlopen
        // sessie nooit bij het loginscherm.
        navigateFallbackDenylist: [/^\/__/],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: true, navigateFallback: 'index.html' },
    }),
  ],
})
