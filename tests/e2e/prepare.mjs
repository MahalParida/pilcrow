import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
const out = '.tmp/e2e-extension';
const real = '.tmp/e2e-real-extension';
rmSync(real, { recursive: true, force: true });
cpSync('dist', real, { recursive: true });
rmSync(out, { recursive: true, force: true });
cpSync(real, out, { recursive: true });
// Only the test copy uses a deterministic engine. Never modify the release build.
await build({ entryPoints: ['tests/e2e/engine.ts'], outfile: `${out}/offscreen.js`,
  bundle: true, format: 'esm', alias: { '@': './src' } });
writeFileSync(`${out}/offscreen/index.html`, '<!doctype html><script type="module" src="/offscreen.js"></script>');
