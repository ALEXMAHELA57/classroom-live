import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
