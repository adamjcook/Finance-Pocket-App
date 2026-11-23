import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// Plain `npm run build` (mode 'production') builds the real app. Mode
// 'dev-pages' (see .env.dev-pages) builds the mock-data copy that a
// Cloudflare Worker deploys from `develop` — see README's "Dev environment" section.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const base = env.VITE_BASE_PATH || '/Finance-Pocket-App/';
  const appLabel = env.VITE_APP_LABEL || 'FinPair';
  const isDevBuild = env.VITE_DEV_BUILD === '1';
  // icons/ for production, icons-dev/ (same mark plus a DEV band) for the dev build.
  const iconDir = env.VITE_ICON_DIR || 'icons';

  return {
    base,
    plugins: [
      preact(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: [`${iconDir}/favicon.svg`],
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
            { src: `${iconDir}/icon-192.png`, sizes: '192x192', type: 'image/png' },
            { src: `${iconDir}/icon-512.png`, sizes: '512x512', type: 'image/png' },
            { src: `${iconDir}/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
          // Both icon sets ship in public/; only precache the one this build uses.
          globIgnores: [isDevBuild ? 'icons/**' : 'icons-dev/**'],
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
