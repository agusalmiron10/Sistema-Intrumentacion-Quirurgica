import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// La config se invoca desde la raiz del repo (`vite --config web/vite.config.ts`),
// asi que el root hay que fijarlo explicito: si no, vite busca el index.html
// en el directorio de trabajo.
const raizWeb = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: raizWeb,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Instrumentacion quirurgica',
        short_name: 'Instrumental',
        description: 'Trazabilidad de cajas de instrumental quirurgico',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icono.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // El shell de la app se precachea para que abra sin señal.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // La API NUNCA se cachea: si no hay red, el escaneo va a la cola de
        // IndexedDB. Servir una respuesta vieja de /api seria mostrar estados
        // de caja desactualizados, que es peor que no mostrar nada.
        navigateFallbackDenylist: [/^\/api\//, /^\/c\//],
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // `npm run dev:web` levanta Vite y manda la API al `wrangler dev` de al lado.
    proxy: {
      '/api': 'http://localhost:8787',
      '/c': 'http://localhost:8787',
    },
  },
});
