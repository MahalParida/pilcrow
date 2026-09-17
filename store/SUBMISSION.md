# Chrome Web Store submission notes

Everything the developer dashboard asks for, written out. Copy each block into
the matching field. Regenerate the assets with `npm run store:assets` and the
upload zip with `npm run package`.

---

## Package

| | |
|---|---|
| Upload artifact | `pilcrow-1.0.0.zip` — produced by `npm run package` |
| Version | `1.0.0` (package.json and manifest.json must match; the packaging script fails if they drift) |
| Privacy policy URL | `https://<username>.github.io/pilcrow/` — the page in `docs/` |
| Category | Productivity → Workflow & Planning |
| Language | English |

## Listing copy

**Name** (45 char limit)

```
Pilcrow — private on-device writing assistant
```

**Short description** (132 char limit)

```
Grammar, clarity and rewriting powered by Chrome's built-in AI. Your text is checked on your own device and never uploaded.
```

**Detailed description**

> Ordered so that everything named in the first half works on a stock Chrome
> install. The flag-gated APIs appear once, at the end, framed as a speed
> improvement rather than a feature you are missing — see "A note on the
> experimental APIs" below for why that matters.

```
Pilcrow checks what you write in any text field on any site — grammar, spelling,
punctuation, clarity, conciseness, word choice and tone — using the AI model
built into Chrome itself. Your writing is passed to a model running on your own
machine. It is never uploaded, never logged, and works with the network switched
off.

WHAT IT DOES

• Inline suggestions as you type, with exact character offsets and one-click
  accept — grouped by category so you can take all the spelling fixes at once.
• A readability and tone read-out for the field you are in, with writing goals
  (audience, formality, domain, intent) that shape what gets flagged.
• Rewrite any field — more formal, more casual, shorter, longer, or with a
  free-text instruction of your own.
• Draft something new from a one-line brief, using the current field as context.
• Summarise long text as key points, a TL;DR, a teaser or a headline.
• Translate between languages, on device.
• A personal dictionary and text snippets that expand as you type.
• House style rules in plain English, enforced on every check.

PRIVACY, CONCRETELY

• No server. No account. No analytics, telemetry or crash reporting.
• No remote code — everything that runs ships inside the extension.
• Your text is discarded once the suggestions are produced.
• Settings sync through your own Chrome profile if you have Chrome Sync on;
  your dictionary and snippets never leave the device.
• Switch Pilcrow off per site from the popup, or list quiet sites in Settings.

REQUIREMENTS

Chrome 138 or newer on desktop, roughly 22 GB of free disk space for Chrome's
model, and either a GPU with more than 4 GB of VRAM or a 4-core CPU with 16 GB
of RAM. The first check downloads Chrome's on-device model once.

Settings → Diagnostics runs a real request through every layer and tells you
exactly which one failed, if anything ever does.

A NOTE ON THE EXPERIMENTAL APIS

Chrome is still rolling out dedicated Proofreader, Rewriter and Writer models
behind flags. Pilcrow does not need them: it falls back to Chrome's Prompt API,
so every feature above works on a stock install. Turning the flags on in
chrome://flags simply makes those operations faster and more precise.
```

## Screenshot captions

| File | Caption |
|---|---|
| `screenshot-1-suggestions.png` | Suggestions appear as you type, grouped by category |
| `screenshot-2-tools.png` | Rewrite, draft, summarise and translate the field you are in |
| `screenshot-3-private.png` | No network calls — and diagnostics that prove it |

## Privacy practices tab

**Single purpose**

```
Analyse and improve the text the user is writing in a text field, using Chrome's
built-in on-device AI models.
```

**Are you using remote code?** — **No.** Every script is bundled in the package.
There is no CDN, no `eval`, and no dynamically fetched code.

**Data usage** — tick nothing, then certify all three statements. Pilcrow
collects no user data of any kind.

### Permission justifications

| Permission | Justification to paste |
|---|---|
| `storage` | Stores the user's own settings, personal dictionary and text snippets. Settings use `chrome.storage.sync` so they follow the user's Chrome profile; the dictionary and snippets use `chrome.storage.local` and stay on the device. No other data is written. |
| `offscreen` | Chrome's built-in AI APIs (`LanguageModel`, `Summarizer`, `Translator` and the rest) are not exposed to Web Workers, and an MV3 extension service worker is one — they are `undefined` there. The extension hosts them in an offscreen document, which is a real Window and the only context in an extension where these APIs exist. **Note for the reviewer:** the document is declared with the `WORKERS` reason because none of the values in `chrome.offscreen.Reason` describes "the built-in AI APIs require a DOM context". `WORKERS` is the closest fit, not an exact one, and the `justification` string passed to `createDocument()` states the real reason plainly. If Chrome adds a better-fitting reason we will switch to it. See `src/background/index.ts`. |
| `sidePanel` | Presents suggestions, the rewrite/draft/summarise/translate tools and document insights in Chrome's side panel. |
| `contextMenus` | Adds right-click actions (check, rewrite, explain, synonyms) for the current text selection. |
| `activeTab` | Lets the toolbar popup act on the tab the user is looking at — reporting whether the extension is enabled for that site and opening the side panel for it. |
| `scripting` | Used by Settings → Diagnostics to verify that the content script is alive in the current tab and reachable from the extension, so a broken install can be diagnosed. It is not used to inject functionality. |
| Host permission `<all_urls>` | A writing assistant has to work in whatever text field the user is typing in, and there is no fixed list of sites where people write — email, docs, issue trackers, forms, CMSes. Access is used solely to read the focused editable element and apply the user's accepted edits back into it. Page content outside the focused field is not read or transmitted, and nothing is sent off the device at all. Users can disable Pilcrow per site from the popup or maintain a quiet-site list in Settings. |

---

## Expect a longer review

`<all_urls>` plus a content script on every page puts this into extended review.
Days to weeks is normal, and a clarification round is common. The three things
reviewers most often push back on here are the broad host permission, the
`activeTab`/`scripting` pair, and the offscreen reason — all three are answered
above, in the reviewer's own terms rather than left to be discovered.
