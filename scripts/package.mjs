// Builds the zip uploaded to the Chrome Web Store.
//
// Source maps are stripped: they are useful in `dist/` for local debugging but
// triple the upload size and ship the whole source tree to every user.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'dist/manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

if (manifest.version !== pkg.version) {
  console.error(
    `version mismatch: package.json is ${pkg.version}, manifest is ${manifest.version}`,
  );
  process.exit(1);
}

const out = resolve(root, `pilcrow-${manifest.version}.zip`);
rmSync(out, { force: true });
// -x on *.map, and the store rejects the __MACOSX/.DS_Store noise the Finder adds.
execFileSync('zip', ['-r', '-q', out, '.', '-x', '*.map', '.DS_Store', '__MACOSX/*'], {
  cwd: resolve(root, 'dist'),
});

const size = execFileSync('du', ['-h', out]).toString().split('\t')[0];
console.log(`${out.replace(`${root}/`, '')}  (${size.trim()})  v${manifest.version}`);
