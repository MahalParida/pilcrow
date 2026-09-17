// Renders the Chrome Web Store listing assets with headless Chrome, so every
// shot uses the extension's own stylesheets rather than a redrawn mock.
//
//   node scripts/store-assets.mjs        → store/*.png
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenes } from './store/scenes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'store');
const work = resolve(root, '.tmp/store');

const CHROME =
  process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SIZES = {
  'screenshot-1-suggestions': [1280, 800],
  'screenshot-2-tools': [1280, 800],
  'screenshot-3-private': [1280, 800],
  'promo-tile-440x280': [440, 280],
};

mkdirSync(out, { recursive: true });
mkdirSync(work, { recursive: true });

for (const [name, build] of Object.entries(scenes)) {
  const [width, height] = SIZES[name];
  const html = resolve(work, `${name}.html`);
  const png = resolve(out, `${name}.png`);
  writeFileSync(html, build());
  rmSync(png, { force: true });
  execFileSync(CHROME, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--screenshot=${png}`,
    `file://${html}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const size = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', png]).toString();
  const w = /pixelWidth: (\d+)/.exec(size)?.[1];
  const h = /pixelHeight: (\d+)/.exec(size)?.[1];
  if (`${w}x${h}` !== `${width}x${height}`) {
    console.error(`${name}: rendered ${w}x${h}, expected ${width}x${height}`);
    process.exit(1);
  }
  console.log(`store/${name}.png  ${w}×${h}`);
}

copyFileSync(resolve(root, 'public/icons/icon-128.png'), resolve(out, 'store-icon-128.png'));
console.log('store/store-icon-128.png  128×128');
