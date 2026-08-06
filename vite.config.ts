import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Served from https://jochem-oosterlee.github.io/personal/ — the trailing
// slash matters for the service worker scope.
const base = '/personal/'

const commitHash = execSync('git rev-parse --short HEAD').toString().trim()
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
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Personal',
        short_name: 'Personal',
        description: 'Persoonlijke app — boodschappenlijstje en meer',
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
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: true, navigateFallback: 'index.html' },
    }),
  ],
})
