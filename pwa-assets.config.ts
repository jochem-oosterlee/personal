import { defineConfig, minimalPreset as preset } from '@vite-pwa/assets-generator/config'

// Maskable en apple-touch iconen krijgen anders een witte rand: sharp vult de
// canvas rond het (kleinere) icoon standaard met wit, terwijl de rest van de
// app het zandkleurige --bg gebruikt.
const resizeOptions = { fit: 'contain' as const, background: '#f6f1e7' }

export default defineConfig({
  images: ['public/favicon.svg'],
  preset: {
    ...preset,
    maskable: { ...preset.maskable, resizeOptions },
    apple: { ...preset.apple, resizeOptions },
  },
})
