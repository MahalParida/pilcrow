# Pilcrow

A Manifest V3 Chrome extension: a writing assistant that runs entirely on
Chrome's built-in AI. There is no server, no account and no network call — that
constraint shapes every design decision below, so preserve it.

## Commands

| | |
|---|---|
| `npm run check` | **The gate.** typecheck → self-tests → build → context check. Run before calling anything done. |
| `npm run build` | Both builds (main + content script) |
| `npm run dev:main` / `dev:content` | Watch builds — you need *both* running |
| `npm test` | 67 self-tests, bundled through esbuild and run in node |
| `npm run package` | Store zip. Fails if `package.json` and `manifest.json` versions differ. |
| `npm run store:assets` | Regenerates the Web Store screenshots from the real stylesheets |
| `npm run icons` | Regenerates the PNG icons from primitives |

## Architecture

Four contexts, and which one code runs in matters more than usual:

- **`src/background/`** — the service worker. Routes messages and owns the
  offscreen document's lifecycle.
- **`src/offscreen/`** — the engine host. **Chrome's AI APIs do not exist in a
  service worker** (it's a Worker, and `LanguageModel` and friends are
  `undefined` there). This offscreen document is a real Window, which is the
  only place in an extension they exist. Everything in `src/engine/` runs here.
- **`src/content/`** — the content script. Adapters for `<input>`/`<textarea>`
  (a mirror element with escaped HTML) and contenteditable (the Custom
  Highlight API). UI lives in a shadow root.
- **`src/sidepanel/`, `src/popup/`, `src/options/`** — the extension pages.

### Rules that will bite you

1. **The offscreen document may only touch `chrome.runtime`.** Reading
   `chrome.storage` there throws during module evaluation, which leaves the
   message listeners unregistered and every port dead on arrival. Read the
   value in a context that has the API and pass it over messaging.
   `npm run check:contexts` enforces this against the built output.
2. **Nothing in the offscreen document has user activation**, so it can never
   start a model download. Chrome requires a real gesture, and activation does
   not survive a `chrome.runtime` message hop — downloads must be started from
   the page handling the click (see `src/engine/download.ts`).
3. **Every `LanguageModel` call must declare an output language**, including
   bare `availability()` probes — Chrome warns otherwise. `check:contexts`
   enforces this too. Route through `withSession` where you can.
4. **Reloading the extension is not enough.** A content script injected before
   the reload has a dead extension context; refresh any tab you're testing in.

## Conventions

- **Two vite configs.** `vite.config.ts` builds the pages and worker as ES
  modules; `vite.content.config.ts` builds the content script as a single IIFE,
  because content scripts cannot be modules.
- **Styling.** `src/ui/shared.css` holds the design tokens and is imported by
  the popup, options and side panel. The content script has its own `--pl-*`
  tokens scoped to `:host` in the shadow root. Both support light and dark via
  `prefers-color-scheme`; there is no manual toggle.
- **Model output is untrusted input.** It is validated before use —
  `anchorIssues` drops any category outside the enabled set — and escaped
  before it reaches the DOM. Keep both; don't rely on `responseConstraint`
  alone, since some Chrome builds don't honour it.
- **Graceful degradation over hard failure.** Chrome's Proofreader, Rewriter
  and Writer are still flag-gated, so every feature falls back to the Prompt
  API. A missing specialised API must never break a feature.

## Non-obvious facts

- **Settings use `chrome.storage.sync`; the dictionary and snippets use
  `.local`.** So settings (including house-style rules) travel through the
  user's Google account if Chrome Sync is on. The privacy policy in `docs/`
  discloses this — keep the two in agreement.
- **The Proofreader throws `"Model provided wrong label count"`** when its
  label pass disagrees with its corrections. `src/engine/proofread.ts` drops
  the labels for the session and retries rather than losing proofreading.
- **`chrome.offscreen` has no reason value that fits.** The document is
  declared `WORKERS` with an honest justification string; this is disclosed to
  Web Store reviewers in `store/SUBMISSION.md` rather than left to be noticed.
- **Category colours in `CATEGORY_META` are not theme-aware** — a single hex
  each, so several fall below 4.5:1 contrast in one theme or the other. Known,
  unfixed.

## Debugging

`Settings → Diagnostics → Run diagnostics` sends a real request through every
layer — page, service worker, offscreen engine, model, content script — and
prints which one failed, with timings. Start there.
