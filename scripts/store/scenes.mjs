// The store assets, as standalone HTML documents.
//
// Each surface in a shot is its own <iframe>, because the options page and the
// side panel are separate documents in the real extension and their
// stylesheets are written on that assumption — sharing one document lets
// options rules like `header { margin-bottom }` reach into the panel.
import { panel, panelCss, optionsCss, forceDark, forceLight } from './panel.mjs';

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** A surface: its own document, its own stylesheet, its own forced palette. */
function doc({ css, dark, style = '', body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
${css}
${dark ? forceDark() : forceLight()}
html, body { margin: 0; padding: 0; height: 100%; background: var(--bg); }
${style}
</style></head><body>${body}</body></html>`;
}

const frame = (html, extra = '') =>
  `<div class="surface ${extra}"><iframe scrolling="no" srcdoc="${attr(html)}"></iframe></div>`;

const SUGGESTIONS = [
  {
    category: 'grammar',
    message: 'Change to “I had”',
    original: 'I has',
    replacement: 'I had',
    explanation: '“I” takes the past-tense form “had”.',
  },
  { category: 'spelling', message: 'Spelling: “losing”', original: 'loosing', replacement: 'losing' },
  {
    category: 'conciseness',
    message: 'Tighten this phrase',
    original: 'a little bit too long in my opinion',
    replacement: 'too long',
    explanation: 'Four words carry the same meaning as nine.',
  },
];

/** The side panel, as its own document. */
const panelDoc = (opts, dark = false) =>
  doc({
    css: panelCss(),
    dark,
    style: '.app { height: 100%; } main { overflow: hidden; }',
    body: panel(opts),
  });

/** The page being written in: a mock compose window with live underlines. */
const draftDoc = (dark = false) =>
  doc({
    css: panelCss(),
    dark,
    style: `
body { display: flex; flex-direction: column; font-size: 13px; }
.win-bar { display: flex; align-items: center; gap: 7px; padding: 11px 14px; border-bottom: 1px solid var(--line); background: var(--surface); flex: none; }
.win-bar i { width: 11px; height: 11px; border-radius: 50%; background: var(--line); display: block; }
.win-bar .url { margin-left: 10px; font-size: 11px; color: var(--muted); background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 3px 12px; }
.compose { padding: 24px 26px; display: flex; flex-direction: column; gap: 13px; flex: 1; min-height: 0; }
.to { font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); padding-bottom: 9px; }
.subject { font-size: 17px; font-weight: 600; }
.draft { font-size: 14.5px; line-height: 1.72; }
.draft p { margin: 0 0 13px; }
.u-red, .u-teal { text-decoration-line: underline; text-decoration-style: wavy; text-decoration-skip-ink: none; text-underline-offset: 3px; text-decoration-thickness: 1px; }
.u-red { text-decoration-color: #dc2626; }
.u-teal { text-decoration-color: #0d9488; }
.badge { align-self: flex-end; margin-top: auto; display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid #fecaca; color: #dc2626; background: var(--bg); border-radius: 999px;
  padding: 5px 11px; font-size: 12px; font-weight: 600; box-shadow: 0 3px 10px rgba(24,24,27,0.09); }
.badge .mark { font-size: 13px; font-weight: 700; }`,
    body: `<div class="win-bar"><i></i><i></i><i></i><span class="url">mail.example.com/compose</span></div>
  <div class="compose">
    <div class="to">To: dana@example.com</div>
    <div class="subject">Re: Q3 deck — a few thoughts</div>
    <div class="draft">
      <p>Hi Dana,</p>
      <p>Thanks for sending the deck over yesterday. <span class="u-red">I has</span> a few thoughts
      before we share it with the wider team.</p>
      <p>The middle section is <span class="u-teal">a little bit too long in my opinion</span>, and
      I think we could shorten it without <span class="u-red">loosing</span> the main argument.
      Two of the slides also repeat the same number.</p>
      <p>Happy to jump on a call if that is easier.</p>
    </div>
    <div class="badge"><span class="mark">¶</span> 3</div>
  </div>`,
  });

/** The canvas every 1280×800 shot sits on. */
function scene({ title, kicker, left, right, dark = false }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>
html, body { margin: 0; padding: 0; }
body {
  width: 1280px; height: 800px; overflow: hidden; box-sizing: border-box;
  padding: 40px 44px 44px;
  display: grid; grid-template-rows: auto 1fr; gap: 22px;
  background: ${dark
    ? 'radial-gradient(1100px 700px at 20% -10%, #26263a 0%, #111114 60%)'
    : 'radial-gradient(1100px 700px at 20% -10%, #eef0ff 0%, #f7f7fb 60%)'};
  color: ${dark ? '#f4f4f5' : '#18181b'};
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.hero h1 { font-size: 27px; font-weight: 650; letter-spacing: -0.02em; margin: 0 0 5px; }
.hero p { font-size: 14px; margin: 0; color: ${dark ? '#a1a1aa' : '#52525b'}; }
.hero .mark { color: ${dark ? '#818cf8' : '#4f46e5'}; }
.stage { display: grid; grid-template-columns: 1fr 372px; gap: 22px; min-height: 0; }
.surface {
  border: 1px solid ${dark ? '#2e2e33' : '#e4e4e7'}; border-radius: 14px; overflow: hidden;
  box-shadow: 0 18px 44px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(24,24,27,0.13)'};
  min-height: 0;
}
.surface iframe { width: 100%; height: 100%; border: 0; display: block; }
</style></head><body>
<div class="hero"><h1><span class="mark">¶</span> ${title}</h1><p>${kicker}</p></div>
<div class="stage">${left}${right}</div>
</body></html>`;
}

const FIELD = 'Message body · mail.example.com';

export const scenes = {
  'screenshot-1-suggestions': () =>
    scene({
      title: 'Fixes as you write — without your words leaving the browser',
      kicker: 'Grammar, spelling and clarity from Chrome’s built-in AI. No account, no server, no upload.',
      left: frame(draftDoc()),
      right: frame(
        panelDoc({ score: 72, field: FIELD, tones: ['Friendly', 'Direct'], suggestions: SUGGESTIONS }),
      ),
    }),

  'screenshot-2-tools': () =>
    scene({
      title: 'Rewrite, draft, summarise and translate in place',
      kicker: 'Every tool runs against the field you are focused on, entirely on this device.',
      left: frame(draftDoc()),
      right: frame(
        panelDoc({
          score: 72,
          field: FIELD,
          tones: ['Friendly', 'Direct'],
          tab: 'tools',
          suggestions: SUGGESTIONS,
          body: `<div class="card tool">
            <h3>Rewrite the field</h3>
            <div class="row wrap">
              <select><option>More formal</option></select>
              <select><option>Shorter</option></select>
            </div>
            <label class="field" style="margin-top:8px"><span>Extra instruction (optional)</span>
              <input type="text" value="lead with the ask" /></label>
            <button class="primary small">Rewrite</button>
            <div class="result">Dana — before this goes to the wider team, could you trim the middle section? It runs long, and two slides repeat the same figure. Happy to talk it through on a call.</div>
            <div class="row" style="margin-top:8px">
              <button class="small primary">Replace field</button><button class="small">Copy</button>
            </div>
          </div>
          <div class="card tool">
            <h3>Translate</h3>
            <div class="row wrap"><select><option>Spanish</option></select>
            <button class="primary small">Translate</button></div>
          </div>`,
        }),
      ),
    }),

  'screenshot-3-private': () =>
    scene({
      dark: true,
      title: 'Works offline. Nothing to opt out of.',
      kicker: 'No network calls, no analytics, no account — and a diagnostics pass that proves it.',
      left: frame(
        doc({
          css: optionsCss(),
          dark: true,
          style: 'body { background: var(--bg); padding: 26px 28px; box-sizing: border-box; } h2 { font-size: 16px; }',
          body: `<h2 style="margin-bottom:14px">Model status</h2>
            <div class="caps">${[
              ['Prompt API', 1, 'Ready'],
              ['Proofreader', -1, 'Not enabled in this Chrome build'],
              ['Rewriter', -1, 'Not enabled in this Chrome build'],
              ['Writer', -1, 'Not enabled in this Chrome build'],
              ['Summarizer', 1, 'Ready'],
              ['Translator', 1, 'Ready'],
              ['Language detector', 1, 'Ready'],
            ]
              .map(
                ([n, ok, state]) =>
                  `<div class="cap"><span class="led" data-ok="${ok}"></span><b>${n}</b><span class="state">${state}</span></div>`,
              )
              .join('')}</div>
            <div class="row" style="margin-top:16px">
              <button class="small primary">Download models</button>
              <span class="muted">Ready, except 3 optional model(s).</span>
            </div>
            <p class="muted" style="font-size:13px;line-height:1.6;max-width:56ch;margin-top:12px">
              Some APIs are still experimental in Chrome. Pilcrow falls back to the Prompt API
              whenever a specialised one is missing, so every feature keeps working — enabling
              the flags just makes them faster and more precise.
            </p>
            <h2 style="margin:26px 0 8px">Diagnostics</h2>
            <p class="muted" style="font-size:13px;line-height:1.6;max-width:56ch;margin:0">
              Runs a real request through every layer — this page, the service worker, the engine
              host and the content script — and reports exactly where it breaks.
            </p>
            <pre class="diag">${[
              ['ok', 'Chrome version', '152.0.7977.84 · macOS'],
              ['ok', 'Custom Highlight API', 'supported'],
              ['ok', 'Engine host (offscreen document)', 'up', '18 ms'],
              ['ok', 'Prompt API in engine host', 'Ready'],
              ['warn', 'Proofreader in engine host', 'Not enabled in this Chrome build'],
              ['ok', 'End-to-end check (cold)', '6 suggestions', '1420 ms'],
              ['ok', 'End-to-end check (warm)', '6 suggestions', '210 ms'],
              ['ok', 'Cold pass breakdown', 'detect 8 ms · prompt 1284 ms · tone 92 ms'],
              ['ok', 'Translate', '“Buenos días, ¿cómo estás?”', '340 ms'],
              ['ok', 'Content script', 'responding on mail.example.com'],
            ]
              .map(([status, name, detail, ms]) =>
                `[${status === 'ok' ? ' ok ' : 'warn'}] ${name.padEnd(32)}  ${detail}${ms ? ` (${ms})` : ''}`,
              )
              .join('\n')}</pre>
`,
        }),
      ),
      right: frame(
        panelDoc(
          {
            score: 94,
            field: FIELD,
            tones: ['Confident', 'Clear'],
            tab: 'insights',
            body: `<div class="card"><h3>Document</h3>
              <div class="stats">
                <div class="stat"><b>248</b><span>words</span></div>
                <div class="stat"><b>1 min</b><span>reading time</span></div>
                <div class="stat"><b>14</b><span>sentences</span></div>
                <div class="stat"><b>17.7</b><span>words / sentence</span></div>
              </div></div>
            <div class="card" style="margin-top:10px"><h3>Readability</h3>
              <div class="meter"><i style="width:71%"></i></div>
              <div class="muted" style="font-size:12px">71 · Fairly easy to read</div>
            </div>
            <div class="card" style="margin-top:10px"><h3>Writing goals</h3>
              <div class="goals">
                <label class="field"><span>Audience</span><select><option>Knowledgeable</option></select></label>
                <label class="field"><span>Formality</span><select><option>Neutral</option></select></label>
                <label class="field"><span>Domain</span><select><option>Business</option></select></label>
                <label class="field"><span>Intent</span><select><option>Convince</option></select></label>
              </div>
            </div>`,
          },
          true,
        ),
      ),
    }),

  'promo-tile-440x280': () => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Pilcrow</title><style>
html,body { margin:0; padding:0; }
body {
  width:440px; height:280px; overflow:hidden; box-sizing:border-box;
  display:flex; flex-direction:column; justify-content:center; gap:11px; padding:0 34px;
  background:
    radial-gradient(280px 200px at 88% 8%, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0) 70%),
    linear-gradient(140deg, #4f46e5 0%, #7c3aed 100%);
  color:#fff; position:relative;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.glyph { position:absolute; right:-26px; bottom:-84px; font-size:270px; line-height:1;
  font-weight:700; color:rgba(255,255,255,0.13); }
.name { display:flex; align-items:baseline; gap:9px; }
.name .mark { font-size:31px; font-weight:700; }
.name h1 { font-size:33px; font-weight:650; letter-spacing:-0.02em; margin:0; }
p { margin:0; font-size:14.5px; line-height:1.5; max-width:29ch; color:rgba(255,255,255,0.93); }
.pill { align-self:flex-start; margin-top:4px; display:inline-flex; align-items:center; gap:7px;
  border:1px solid rgba(255,255,255,0.42); border-radius:999px; padding:5px 13px;
  font-size:11.5px; font-weight:600; }
.pill i { width:7px; height:7px; border-radius:50%; background:#4ade80; display:block; }
</style></head><body>
<span class="glyph">¶</span>
<div class="name"><span class="mark">¶</span><h1>Pilcrow</h1></div>
<p>Grammar, clarity and rewriting powered by Chrome’s built-in AI.</p>
<span class="pill"><i></i>Runs entirely on your device</span>
</body></html>`,
};
