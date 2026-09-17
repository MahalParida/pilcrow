// Builds the side-panel markup exactly as sidepanel/main.ts builds it at
// runtime, so the store shots are rendered from the real stylesheets and the
// real DOM shape rather than a redrawn mock.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

/** CATEGORY_META, mirrored from src/shared/constants.ts. */
export const CATEGORY = {
  spelling: { label: 'Spelling', color: '#dc2626' },
  grammar: { label: 'Grammar', color: '#dc2626' },
  punctuation: { label: 'Punctuation', color: '#ea580c' },
  clarity: { label: 'Clarity', color: '#2563eb' },
  conciseness: { label: 'Conciseness', color: '#0d9488' },
  vocabulary: { label: 'Word choice', color: '#7c3aed' },
  style: { label: 'Style', color: '#c026d3' },
  inclusivity: { label: 'Inclusive language', color: '#0891b2' },
};

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The extension's own CSS, with the @import flattened for file:// loading. */
export function panelCss() {
  return read('src/ui/shared.css') + '\n' + body('src/sidepanel/style.css');
}

const body = (p) => read(p).replace(/@import[^;]+;/, '');

export function optionsCss() {
  return read('src/ui/shared.css') + '\n' + body('src/options/style.css');
}

/** For a scene showing the options page and the side panel side by side. */
export function bothCss() {
  return [
    read('src/ui/shared.css'),
    body('src/options/style.css'),
    body('src/sidepanel/style.css'),
  ].join('\n');
}

/**
 * The theme tokens, re-asserted after the stylesheet. The renderer's own
 * `prefers-color-scheme` would otherwise decide how a shot comes out, and a
 * headless Chrome reports dark — so each scene states which palette it wants.
 */
function tokens(which) {
  const shared = read('src/ui/shared.css');
  const block =
    which === 'dark'
      ? shared.match(/@media \(prefers-color-scheme: dark\) \{\s*(:root \{[\s\S]*?\})\s*\}/)?.[1]
      : shared.match(/^(:root \{[\s\S]*?\})/m)?.[1];
  if (!block) throw new Error(`could not extract the ${which} tokens from shared.css`);
  return `${block}\n:root { color-scheme: ${which}; }`;
}

export const forceDark = () => tokens('dark');
export const forceLight = () => tokens('light');

const scoreColor = (n) =>
  n >= 85 ? 'var(--good)' : n >= 65 ? 'var(--accent)' : n >= 45 ? 'var(--warn)' : 'var(--bad)';

function card(s) {
  const meta = CATEGORY[s.category];
  const learn =
    s.category === 'spelling' ? '<button class="small">Add to dictionary</button>' : '';
  return `<div class="suggestion">
      <div class="top"><span class="cat" style="color:${meta.color}">${esc(meta.label)}</span></div>
      <div class="msg">${esc(s.message)}</div>
      <div class="diff"><del>${esc(s.original)}</del><span class="arrow">→</span><ins>${esc(s.replacement)}</ins></div>
      ${s.explanation ? `<div class="why">${esc(s.explanation)}</div>` : ''}
      <div class="acts"><button class="small primary">Accept</button><button class="small">Dismiss</button>${learn}</div>
    </div>`;
}

function groups(suggestions) {
  const order = [];
  const by = new Map();
  for (const s of suggestions) {
    if (!by.has(s.category)) { by.set(s.category, []); order.push(s.category); }
    by.get(s.category).push(s);
  }
  return order
    .map((category) => {
      const items = by.get(category);
      const meta = CATEGORY[category];
      return `<div class="group-head">
        <span class="chip" style="color:${meta.color}"><span class="dot"></span>${esc(meta.label)}</span>
        <span class="n">${items.length}</span>
        <button class="ghost small">Accept all</button>
      </div>${items.map(card).join('')}`;
    })
    .join('');
}

/**
 * The whole panel. `body` replaces the suggestions list when a shot wants to
 * show a different tab.
 */
export function panel({ score, field, tones, suggestions = [], tab = 'suggestions', body }) {
  const circumference = 2 * Math.PI * 19;
  const offset = circumference * (1 - score / 100);
  const tabs = [
    ['suggestions', `Suggestions<span class="badge-count" data-show="${suggestions.length ? 1 : 0}">${suggestions.length}</span>`],
    ['tools', 'Tools'],
    ['insights', 'Insights'],
  ]
    .map(([id, label]) => `<button class="tab${id === tab ? ' active' : ''}">${label}</button>`)
    .join('');

  return `<div class="app">
    <header class="app-head">
      <span class="brand"><span class="mark">¶</span> Pilcrow</span>
      <span class="chip privacy" data-state="ready"><span class="dot"></span>On-device</span>
      <button class="ghost small">⚙</button>
    </header>
    <section class="summary">
      <div class="ring-wrap">
        <svg class="ring" viewBox="0 0 44 44" aria-hidden="true">
          <circle class="ring-track" cx="22" cy="22" r="19"></circle>
          <circle class="ring-value" cx="22" cy="22" r="19"
                  style="stroke:${scoreColor(score)};stroke-dashoffset:${offset.toFixed(2)}"></circle>
        </svg>
        <div class="ring-label"><strong>${score}</strong><span>score</span></div>
      </div>
      <div class="summary-right">
        <div class="muted">${esc(field)}</div>
        <div class="row wrap tones">${tones.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      </div>
    </section>
    <nav class="tabs">${tabs}</nav>
    <main>${body ?? `<div class="row toolbar">
        <button class="small">Recheck</button>
        <button class="small">Accept all</button>
        <span class="spacer"></span>
      </div>${groups(suggestions)}`}</main>
  </div>`;
}
