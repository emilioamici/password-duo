import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Base path dinamico per GitHub Pages:
// - VITE_BASE (es. "/") ha la precedenza
// - in GitHub Actions usa "/<nome-repo>/"
// - in locale usa "/"
function resolveBase(): string {
  if (process.env.VITE_BASE) return process.env.VITE_BASE
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
  if (process.env.GITHUB_ACTIONS && repo) {
    return repo.endsWith('.github.io') ? '/' : `/${repo}/`
  }
  return '/'
}

const base = resolveBase()

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'app-icon.png', 'cats/*.png'],
      manifest: {
        name: 'Password Duo',
        short_name: 'Password Duo',
        description: 'Password manager familiare cifrato, sincronizzato su Google Drive.',
        theme_color: '#fff7ee',
        background_color: '#fff7ee',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'it',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
})
