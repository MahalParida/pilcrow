/**
 * Fails the build if any bundle reaches for a `chrome.*` API its execution
 * context does not have.
 *
 * Pilcrow runs in four kinds of context and each exposes a different slice of
 * the platform. The failures are badly behaved: an offscreen document touching
 * `chrome.storage` throws during module evaluation, which leaves its listeners
 * unregistered, which surfaces as "Receiving end does not exist" in a content
 * script somewhere else entirely. Catching it here is much cheaper than
 * catching it in Chrome.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';

const DIST = resolve(import.meta.dirname, '../dist');

/** Offscreen documents support `chrome.runtime` and nothing else. */
const CAPABILITIES = {
  background: ['runtime', 'storage', 'offscreen', 'contextMenus', 'commands', 'tabs', 'sidePanel', 'scripting', 'action', 'windows'],
  offscreen: ['runtime'],
  content: ['runtime', 'storage'],
  sidepanel: ['runtime', 'storage', 'tabs', 'sidePanel', 'scripting', 'windows'],
  popup: ['runtime', 'storage', 'tabs', 'sidePanel', 'scripting', 'windows'],
  options: ['runtime', 'storage', 'tabs', 'scripting', 'windows'],
};

/** The entry plus every chunk it statically imports, transitively. */
function moduleGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(/from\s*["']([^"']+\.js)["']/g)) {
      const spec = match[1];
      queue.push(spec.startsWith('/') ? resolve(DIST, `.${spec}`) : resolve(dirname(file), spec));
    }
  }
  return seen;
}

let failed = false;
for (const [context, allowed] of Object.entries(CAPABILITIES)) {
  const entry = resolve(DIST, `${context}.js`);
  if (!existsSync(entry)) {
    console.error(`✗ ${context}: dist/${context}.js is missing — run the build first.`);
    failed = true;
    continue;
  }

  const permitted = new Set(allowed);
  const illegal = new Map();
  const used = new Set();

  for (const file of moduleGraph(entry)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bchrome\.([A-Za-z_$][\w$]*)/g)) {
      const api = match[1];
      used.add(api);
      if (permitted.has(api)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      illegal.set(`chrome.${api}`, `${basename(file)}:${line}`);
    }
  }

  if (illegal.size === 0) {
    console.log(`✓ ${context.padEnd(11)} ${[...used].sort().join(', ') || '(no extension APIs)'}`);
  } else {
    failed = true;
    console.error(`✗ ${context.padEnd(11)} not available in this context:`);
    for (const [api, where] of illegal) console.error(`    ${api} at ${where}`);
  }
}

if (failed) {
  console.error('\nRead the value in a context that has the API and pass it over messaging.\n');
  process.exit(1);
}

/*
 * Every LanguageModel session must declare an output language. Chrome logs a
 * warning on each request that does not, and the attestation affects output
 * quality. `withSession` enforces this through its types; this catches the raw
 * `create()` calls that bypass it.
 */
const SRC = resolve(import.meta.dirname, '../src');

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

let missingLanguage = false;
for (const file of sourceFiles(SRC)) {
  const source = readFileSync(file, 'utf8');
  // A bare `availability()` warns exactly like a bare `create()`, and aliasing
  // the API through a local (`const api = globalThis.LanguageModel`) hides it
  // from a name-based check — so flag empty parens wherever they appear.
  for (const match of source.matchAll(/\.availability\(\)/g)) {
    const before = source.slice(Math.max(0, match.index - 220), match.index);
    if (before.includes('availability-language-exempt')) continue;
    const line = source.slice(0, match.index).split('\n').length;
    console.error(
      `✗ ${basename(file)}:${line} availability() without a declared language`,
    );
    missingLanguage = true;
  }

  for (const match of source.matchAll(/LanguageModel!?\.(create|availability)\(/g)) {
    const window = source.slice(match.index, match.index + 600);
    // languageExpectations() expands to expectedInputs + expectedOutputs.
    if (window.includes('expectedOutputs') || window.includes('languageExpectations')) continue;
    const line = source.slice(0, match.index).split('\n').length;
    console.error(
      `✗ ${basename(file)}:${line} LanguageModel.${match[1]}() without an output language`,
    );
    missingLanguage = true;
  }
}
if (missingLanguage) {
  console.error('\nDeclare expectedInputs/expectedOutputs languages, or route through withSession.\n');
  process.exit(1);
}
console.log('✓ every LanguageModel create() and availability() declares an output language');
