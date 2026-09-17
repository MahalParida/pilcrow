import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const src = resolve(import.meta.dirname, 'src');

// Content scripts run in an isolated world and are not ES modules, so this
// build emits one self-contained IIFE bundle with no code splitting.
export default defineConfig({
  root: src,
  publicDir: false,
  resolve: { alias: { '@': src } },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: false,
    target: 'esnext',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: resolve(src, 'content/index.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'content.js',
        inlineDynamicImports: true,
        extend: true,
      },
    },
  },
});
