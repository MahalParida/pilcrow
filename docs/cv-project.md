# Pilcrow — suggested CV project entry

**Pilcrow | TypeScript, Chrome Manifest V3, on-device AI, Playwright, GitHub Actions**

- Built a Chrome writing assistant around Gemini Nano with a service-worker /
  offscreen-document architecture, cancellable RPC, session reuse, and
  sentence-level caching.
- Implemented text-field and contenteditable adapters with inline suggestions,
  native rich-text highlights, stale-result protection, and correction undo.
- Validated core logic with 67 automated checks and added nine Chromium browser
  tests covering editor interactions, UI behavior, and settings persistence.
- Added CI checks, browser tests, extension packaging, and tagged GitHub Releases.

Correction E2E tests use a deterministic engine double; settings tests load the
unmodified extension. Do not claim measured inference latency, accuracy, model
memory, or verified real-model offline operation until the benchmark results
exist. This is replacement wording, not an edit to a CV file outside this repo.
