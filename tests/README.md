# Test scope

Run `npm ci`, `npx playwright install chromium`, `npm run check`, then
`npm run test:e2e`. Linux CI installs browser dependencies with
`npx playwright install --with-deps chromium`.

The Node suite currently reports **67 checks**. The Chromium suite currently
contains **9 tests** (not 9 assertions):

- Accept sequential corrections in input, textarea and contenteditable (3 tests).
- Preserve rich-text markup, use native highlights, and undo a correction.
- Dismiss without editing; close the card with Escape.
- Discard an analysis result when the user changes its input.
- Exclude passwords and remove decorations when an editor is removed.
- Accept a correction offline with a deterministic engine; observe page requests.
- Persist settings and dictionary changes across reload with the real extension.

The correction suite loads a separate extension copy in `.tmp/e2e-extension`.
Only its offscreen engine is replaced with deterministic responses. Production
content scripts, adapters, controller, shadow-DOM UI, service worker, and RPC
remain in use. `dist/` and release ZIPs are never patched. The settings test
loads an unmodified snapshot of `dist/` and uses real Chrome extension storage.
Both copies are isolated from later builds that replace `dist/`.

Each test gets a fresh browser profile. Failures retain Playwright traces;
CI uploads the HTML report and failure traces. Test configuration follows
[Playwright's extension-testing guide](https://playwright.dev/docs/chrome-extensions).

## Gaps

These tests do not evaluate Gemini Nano, downloads/user activation, translation,
real-model accuracy, browser-wide network isolation, or compatibility with
Gmail/Docs/Notion and framework-managed editors. The offline test observes only
page requests and uses a fake engine; see [measurement protocol](../benchmarks/README.md).

## Documentation capture

`npm run demo:record` runs an opt-in walkthrough (excluded from the nine-test
suite) and records the real extension UI with the same simulated engine. It
writes a WebM and PNGs under `docs/media/`. The caption discloses the simulation.
The checked-in GIF uses the first three screenshots; it is an animation of
captured UI states, not a timing measurement.

To rebuild the GIF, install Pillow in a Python environment and run
`python scripts/demo-gif.py`. It preserves the simulation disclosure in the captured frames.
