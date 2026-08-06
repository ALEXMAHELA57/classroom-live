import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Without these, a new deploy's service worker installs but sits
      // "waiting" until every open tab of the site is fully closed —
      // until then, the OLD service worker keeps intercepting every
      // request and serving its own cached (stale) JS/CSS, and no
      // amount of hard-refreshing in the browser can override that,
      // since a service worker's fetch handler runs before the
      // browser's normal HTTP cache is even consulted. This is almost
      // certainly why fixes weren't showing up despite confirmed fresh
      // deploys. skipWaiting + clientsClaim make the new service worker
      // activate and take control immediately instead.
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
      },
      devOptions: {
        enabled: true, // without this, the manifest/service worker only exist in a production build —
                        // `npm run dev` was serving nothing at /manifest.webmanifest, which is why the
                        // browser console showed a syntax error trying to parse an empty/HTML response as JSON
      },
      manifest: {
        name: 'Classroom Live',
        short_name: 'Classroom',
        description: 'Education-first live teaching platform',
        theme_color: '#22403a',
        background_color: '#f1efe6',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: { port: 5173 },
});
