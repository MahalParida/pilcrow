import type { EditorState, Settings, Snippet, TabMessage } from '@/shared/types';
import type { EditorAdapter } from './adapters/base';
import { RpcClient } from '@/shared/rpc';
import {
  getDictionary,
  getSettings,
  getSnippets,
  isSiteDisabled,
  onSettingsChanged,
} from '@/shared/storage';
import { MAX_CHARS_PER_PASS } from '@/shared/constants';
import { isEditable } from './adapters/base';
import { InputAdapter } from './adapters/inputAdapter';
import { ContentEditableAdapter } from './adapters/contentEditableAdapter';
import { EditorController } from './controller';
import { Overlay } from './ui/overlay';

const rpc = new RpcClient();

let settings: Settings;
let snippets: Snippet[] = [];
let dictionary: string[] = [];
let active: EditorController | null = null;
let overlay: Overlay | null = null;
/** Reported to the side panel so "off here" is distinguishable from "broken". */
let mode: 'starting' | 'active' | 'disabled' = 'starting';

const idleState = (): EditorState => ({
  mode,
  hasEditor: false,
  text: '',
  analysis: null,
  busy: false,
  origin: location.hostname,
  fieldLabel: '',
  selection: '',
});

/** Text the user has selected anywhere on the page, editable or not. */
function pageSelection(): string {
  const text = window.getSelection()?.toString() ?? '';
  // Long enough to be worth acting on, short enough not to flood a message.
  return text.trim().length > 1 ? text.slice(0, MAX_CHARS_PER_PASS) : '';
}
let statePushTimer = 0;
let removalObserver: MutationObserver | null = null;
let shuttingDown = false;

/**
 * False once the extension has been reloaded, updated or disabled underneath
 * this page. Every `chrome.*` call then throws **synchronously** — including
 * `sendMessage`, which means attaching `.catch()` is not enough to contain it.
 */
function extensionAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

/** Leaves the page exactly as we found it once we can no longer function. */
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  window.clearTimeout(statePushTimer);
  active?.destroy();
  active = null;
  removalObserver?.disconnect();
  removalObserver = null;
  overlay?.destroy();
  overlay = null;
}

function makeAdapter(element: HTMLElement): EditorAdapter {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? new InputAdapter(element)
    : new ContentEditableAdapter(element);
}

/**
 * The overlay is built on first use rather than at startup: this script runs in
 * every frame of every page, and most frames never receive a text field.
 */
function ensureOverlay(): Overlay {
  overlay ??= new Overlay({
    onAccept: (id) => active?.apply(id),
    onDismiss: (id) => active?.dismiss(id),
    onAddToDictionary: (id) => {
      active?.learnWord(id).catch(() => ensureOverlay().toast('Could not save that word.'));
    },
    onExplain: (id) => {
      if (!active) return Promise.reject(new Error('No field is focused'));
      return active.explain(id);
    },
    onNavigate: (delta) => active?.navigate(delta),
    onBadgeClick: () => active?.toggleCard(),
  });
  return overlay;
}

function detach(): void {
  active?.destroy();
  active = null;
  removalObserver?.disconnect();
  removalObserver = null;
  overlay?.hideCard();
  overlay?.setBadge({ rect: null, state: 'idle', count: 0, visible: false });
  pushState();
}

function attach(element: HTMLElement): void {
  // The listeners below stay registered when Pilcrow is switched off, so this
  // is the gate that makes the kill switch real without a page reload.
  if (mode !== 'active' || shuttingDown) return;
  if (active?.adapter.element === element) return;
  active?.destroy();
  active = new EditorController(
    makeAdapter(element),
    ensureOverlay(),
    rpc,
    settings,
    dictionary,
    pushState,
  );

  // Only watch for DOM removal while a field is actually being tracked.
  removalObserver ??= new MutationObserver(() => {
    if (active && !active.adapter.element.isConnected) detach();
  });
  removalObserver.observe(document.documentElement, { childList: true, subtree: true });
}

/** Mirrors the focused field into the side panel, coalescing bursts. */
function pushState(): void {
  if (shuttingDown) return;
  window.clearTimeout(statePushTimer);
  statePushTimer = window.setTimeout(() => {
    if (!extensionAlive()) {
      shutdown();
      return;
    }
    // The selection is read here rather than in the controller: it belongs to
    // the document, not to whichever field happens to be focused.
    const state: EditorState = { ...(active?.getState() ?? idleState()), selection: pageSelection() };
    try {
      // Throws synchronously if the context died between the check and here.
      void chrome.runtime.sendMessage({ type: 'panel:state', state }).catch(() => undefined);
    } catch {
      shutdown(); // No panel listening, or the extension just went away.
    }
  }, 120);
}

/* Snippets */

function tryExpandSnippet(): void {
  if (!active || snippets.length === 0) return;
  const adapter = active.adapter;
  const selection = adapter.getSelection();
  if (!selection || selection.start !== selection.end) return;

  const text = adapter.getText();
  const token = text.slice(Math.max(0, selection.start - 40), selection.start).match(/(\S+)$/)?.[1];
  if (!token) return;

  const snippet = snippets.find((s) => s.trigger === token);
  if (!snippet) return;

  adapter.replaceRange(selection.start - token.length, selection.start, snippet.text);
  ensureOverlay().toast(`Expanded “${token}”`);
}

/* Context-menu actions */

function selectionRect(): DOMRect {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width + rect.height > 0) return rect;
  }
  if (active) return active.adapter.anchorRect();
  return new DOMRect(window.innerWidth / 2 - 170, 80, 340, 0);
}

async function runContextAction(
  action: 'rewrite' | 'summarize' | 'translate' | 'check',
  selectionText: string,
): Promise<void> {
  const adapter = active?.adapter ?? null;
  const range = adapter?.getSelection() ?? null;
  const hasEditableSelection = !!(adapter && range && range.start !== range.end);
  const text =
    (hasEditableSelection ? adapter!.getText().slice(range!.start, range!.end) : selectionText) ||
    selectionText;

  if (action === 'check') {
    if (active) void active.run(true);
    else ensureOverlay().toast('Focus a text field to check it.');
    return;
  }
  if (!text.trim()) {
    ensureOverlay().toast('Select some text first.');
    return;
  }

  const rect = selectionRect();
  ensureOverlay().showResult({ title: 'Working…', body: '…', rect });

  try {
    let title: string;
    let body: string;
    if (action === 'rewrite') {
      title = 'Rewrite';
      body = (await rpc.call('rewrite', { text, language: active?.language })).text;
    } else if (action === 'summarize') {
      title = 'Summary';
      body = (
        await rpc.call('summarize', { text, type: 'key-points', language: active?.language })
      ).text;
    } else {
      const result = await rpc.call('translate', { text, target: settings.translateTo });
      title = `Translation → ${settings.translateTo}`;
      body = result.text;
    }

    ensureOverlay().showResult({
      title,
      body,
      rect: selectionRect(),
      onReplace: hasEditableSelection
        ? () => {
            // The model took seconds; the field may have moved on. Only write
            // if the captured span still holds the text we sent.
            if (adapter!.getText().slice(range!.start, range!.end) !== text) {
              ensureOverlay().toast('The text changed — nothing was replaced.');
              return;
            }
            adapter!.replaceRange(range!.start, range!.end, body);
          }
        : undefined,
    });
  } catch (error) {
    ensureOverlay().hideCard();
    ensureOverlay().toast(error instanceof Error ? error.message : 'That did not work.');
  }
}

/* Wiring */

function handleMessage(
  message: TabMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean | undefined {
  switch (message.type) {
    case 'panel:request-state':
      sendResponse(active?.getState() ?? idleState());
      return false;
    case 'panel:apply':
      active?.apply(message.suggestionId);
      return false;
    case 'panel:apply-all':
      active?.applyAll(message.category);
      return false;
    case 'panel:ignore':
      active?.dismiss(message.suggestionId);
      return false;
    case 'panel:add-to-dictionary':
      void active?.learnWord(message.suggestionId);
      return false;
    case 'panel:replace-all':
      active?.replaceAll(message.text);
      return false;
    case 'panel:insert':
      active?.insertAtCursor(message.text);
      return false;
    case 'panel:recheck':
    case 'cmd:check-now':
      void active?.run(true);
      return false;
    case 'panel:focus-suggestion':
      active?.openById(message.suggestionId);
      return false;
    case 'cmd:accept-first': {
      const state = active?.getState();
      const first = state?.analysis?.suggestions[0];
      if (first) active?.apply(first.id);
      else ensureOverlay().toast('Nothing to accept.');
      return false;
    }
    case 'ctx:action':
      void runContextAction(message.action, message.selection);
      return false;
    default:
      return false;
  }
}

let wired = false;

async function init(): Promise<void> {
  settings = await getSettings();
  [snippets, dictionary] = await Promise.all([getSnippets(), getDictionary()]);

  if (!settings.enabled || isSiteDisabled(settings, location.hostname)) {
    mode = 'disabled';
    // Still listen, so re-enabling does not require a reload.
    onSettingsChanged((next) => {
      const wasOff = !settings.enabled || isSiteDisabled(settings, location.hostname);
      settings = next;
      if (wasOff && next.enabled && !isSiteDisabled(next, location.hostname)) {
        // Reloading here would discard whatever the user has typed. Just wire
        // ourselves up, which is all init() was going to do anyway.
        void init();
      }
    });
    return;
  }

  mode = 'active';
  if (wired) {
    if (isEditable(document.activeElement)) attach(document.activeElement as HTMLElement);
    return;
  }
  wired = true;

  document.addEventListener(
    'focusin',
    (event) => {
      if (overlay?.containsPath(event)) return;
      if (isEditable(event.target)) attach(event.target as HTMLElement);
    },
    true,
  );

  document.addEventListener(
    'click',
    (event) => {
      if (overlay?.containsPath(event)) return;
      if (active?.handleClick(event.clientX, event.clientY)) {
        event.stopPropagation();
        return;
      }
      overlay?.hideCard();
    },
    true,
  );

  document.addEventListener('input', () => tryExpandSnippet(), true);

  // Selecting page text is the other way to give Pilcrow something to work on.
  // pushState() already coalesces, which matters — this event is chatty.
  document.addEventListener('selectionchange', () => pushState());

  // An open extension port keeps the message channel alive across a navigation,
  // which Chrome closes out from under us when the page is frozen into the
  // back/forward cache — and can cost the page its place in that cache. Let it
  // go on the way out; the next call opens a fresh port.
  window.addEventListener('pagehide', () => rpc.release());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay?.isCardOpen) {
      overlay.hideCard();
      event.stopPropagation();
    }
  }, true);

  onSettingsChanged((next) => {
    const nowDisabled = !next.enabled || isSiteDisabled(next, location.hostname);
    settings = next;
    if (nowDisabled) {
      mode = 'disabled';
      detach();
      overlay?.destroy();
      overlay = null;
      return;
    }
    mode = 'active';
    active?.updateSettings(next);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (shuttingDown || !extensionAlive()) return;
    if (area !== 'local') return;
    const keys = Object.keys(changes);
    if (keys.some((key) => key.endsWith(':snippets'))) {
      void getSnippets().then((next) => {
        snippets = next;
      });
    }
    if (keys.some((key) => key.endsWith(':dictionary'))) {
      void getDictionary().then((next) => {
        dictionary = next;
        active?.updateDictionary(next);
      });
    }
  });

  if (isEditable(document.activeElement)) attach(document.activeElement as HTMLElement);
}

/**
 * The service worker re-injects this script into already-open tabs on install
 * and update, so a tab can receive it twice. The isolated world's `window` is
 * shared between injections, which makes it the right place for the guard.
 */
const INJECTED_FLAG = '__pilcrowInjected';

if (!(INJECTED_FLAG in window)) {
  Object.defineProperty(window, INJECTED_FLAG, { value: true, configurable: true });

  // Registered before anything can fail or bail out. If this waited until the
  // end of init(), a disabled site would leave the tab silent and every caller
  // would see "Receiving end does not exist" instead of "switched off here".
  chrome.runtime.onMessage.addListener(handleMessage);
  void init().catch(() => shutdown());
}
