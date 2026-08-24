import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/Finance-Pocket-App/',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/favicon.svg'],
      manifest: {
        name: 'Pocket Finances',
        short_name: 'Pocket Finances',
        description: "Couple's shared finance tracker — all data stays on your phones",
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#101418',
        theme_color: '#101418',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/*.test.ts'],
  },
});
