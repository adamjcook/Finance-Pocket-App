import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// Plain `npm run build` (mode 'production') builds the real app. The GitHub
// Pages workflow additionally builds mode 'dev-pages' (see .env.dev-pages) to
// deploy a second, mock-data copy under /dev/ for developing against without
// touching real data — see README's "Dev environment" section.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const base = env.VITE_BASE_PATH || '/Finance-Pocket-App/';
  const appLabel = env.VITE_APP_LABEL || 'FinPair';
  const isDevBuild = env.VITE_DEV_BUILD === '1';

  return {
    base,
    plugins: [
      preact(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icons/favicon.svg'],
        manifest: {
          name: appLabel,
          short_name: appLabel,
          description: "Couple's shared finance tracker — all data stays on your phones",
          start_url: '.',
          scope: '.',
          display: 'standalone',
          background_color: '#141a21',
          theme_color: '#141a21',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
          cleanupOutdatedCaches: true,
          ...(isDevBuild ? { cacheId: 'finpair-dev' } : {}),
        },
      }),
    ],
    test: {
      environment: 'node',
      include: ['tests/*.test.ts'],
    },
  };
});
