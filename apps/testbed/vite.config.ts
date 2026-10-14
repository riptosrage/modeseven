import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The testbed builds as an installable, offline-capable web app (phones,
 * iPad, any browser) and is also the frontend the Tauri Mac app bundles.
 * Fonts are self-hosted so nothing needs the network.
 */
export default defineConfig({
  server: { port: 5173 },
  plugins: [
    VitePWA({
      // We register the service worker ourselves, and skip it inside the Mac app.
      injectRegister: null,
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon-64.png'],
      manifest: {
        name: 'Mode 7',
        short_name: 'Mode 7',
        description: 'A pegboard for building your own tools.',
        theme_color: '#14181e',
        background_color: '#e3e6ea',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
});
