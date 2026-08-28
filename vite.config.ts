import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/Finance-Pocket-App/',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      // A custom fetch handler (the Web Share Target receiver) needs hand-written
      // service worker code, which generateSW's declarative config can't produce.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      },
      includeAssets: ['icons/favicon.svg'],
      manifest: {
        name: 'Pocket Finances',
        short_name: 'Pocket Finances',
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
        share_target: {
          action: 'share-target/',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [{ name: 'payload', accept: ['application/json', '.json'] }],
          },
        },
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/*.test.ts'],
  },
});
