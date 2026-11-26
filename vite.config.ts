import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/my-memberships/',
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'branding/*.webp'],
      manifest: {
        id: '/my-memberships/',
        name: 'My Memberships',
        short_name: 'Memberships',
        description: 'Your private, offline membership-card wallet.',
        start_url: '/my-memberships/',
        scope: '/my-memberships/',
        display: 'standalone',
        background_color: '#f6f7f2',
        theme_color: '#183c34',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webp,woff2}', 'brand-colors.json'],
        navigateFallback: '/my-memberships/index.html',
        navigateFallbackAllowlist: [/^\/my-memberships\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'barcodes', test: /node_modules[/\\]bwip-js/ }] } },
    },
  },
});
