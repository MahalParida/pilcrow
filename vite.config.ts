import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const src = resolve(import.meta.dirname, 'src');

// Main build: background service worker (ES module) + the three HTML surfaces.
// The content script is built separately (vite.content.config.ts) because
// content scripts cannot be ES modules and must ship as a single IIFE file.
export default defineConfig({
  root: src,
  publicDir: resolve(import.meta.dirname, 'public'),
  resolve: { alias: { '@': src } },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'esnext',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(src, 'background/index.ts'),
        sidepanel: resolve(src, 'sidepanel/index.html'),
        options: resolve(src, 'options/index.html'),
        popup: resolve(src, 'popup/index.html'),
        offscreen: resolve(src, 'offscreen/index.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
