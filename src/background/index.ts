import type { TabMessage } from '@/shared/types';
import {
  ENSURE_BACKEND,
  OFFSCREEN_PATH,
  PING_ENGINE,
  PRODUCT,
  RESET_SESSIONS,
} from '@/shared/constants';

/**
 * Router and lifecycle only.
 *
 * No model code runs here: Chrome's built-in AI APIs are not exposed to Web
 * Workers, and an extension service worker is one. The engine lives in the
 * offscreen document; this worker's job is to keep that document alive and to
 * own the things only a worker can own — context menus, commands, side panel.
 */

/* Offscreen engine host */

let creating: Promise<void> | null = null;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Existence is not readiness: `createDocument()` resolves once the document is
 * created, but its module script is deferred and may not have registered its
 * listeners yet. Only a reply to the ping proves the engine can be talked to.
 */
async function engineResponds(): Promise<boolean> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: PING_ENGINE })) as
      | { ok?: boolean }
      | undefined;
    return response?.ok === true;
  } catch {
    return false;
  }
}

async function hasOffscreen(): Promise<boolean> {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    });
    return contexts.length > 0;
  } catch {
    return false;
  }
}

async function ensureOffscreen(): Promise<void> {
  if (await engineResponds()) return;

  if (!(await hasOffscreen())) await createOffscreen();

  // Poll until the deferred module script has registered its listeners.
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await engineResponds()) return;
    await delay(120);
  }
  throw new Error(
    'The Pilcrow engine did not start. Reload the extension from chrome://extensions.',
  );
}

async function createOffscreen(): Promise<void> {
  if (creating) {
    await creating;
    return;
  }
  if (!chrome.offscreen) {
    throw new Error(
      'This Chrome build has no offscreen API. Reload the extension so the new permission takes effect.',
    );
  }
  // WORKERS is the closest of the reasons Chrome offers, and it is not exact:
  // nothing in the enum describes "the built-in AI APIs need a Window". The
  // justification below says what is really going on, because a reviewer
  // comparing the reason against this call deserves the honest answer rather
  // than a plausible-looking one. Switch to a better-fitting reason if Chrome
  // ever adds one. See the offscreen permission note in store/SUBMISSION.md.
  creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification:
        'Chrome’s built-in AI APIs are unavailable in the extension service worker, so the on-device model runs in this document.',
    })
    .catch((error: unknown) => {
      // Two calls can race; losing that race is success, not failure.
      const detail = error instanceof Error ? error.message : String(error);
      if (!/single offscreen|already/i.test(detail)) throw error;
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message?.type !== ENSURE_BACKEND) return false;
  ensureOffscreen()
    .then(() => sendResponse({ ok: true }))
    .catch((error: unknown) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true; // Response is asynchronous.
});

/**
 * Offscreen documents cannot use `chrome.storage`, so the worker watches for
 * setting changes on their behalf and tells the engine to drop warm sessions
 * whose system prompts are now stale.
 */
/** Fields baked into a system prompt. Changing anything else is free. */
const PROMPT_AFFECTING = ['goals', 'styleRules', 'categories', 'checkLanguage'] as const;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  const entry = Object.entries(changes).find(([key]) => key.endsWith(':settings'));
  if (!entry) return;

  const [, change] = entry;
  const before = (change.oldValue ?? {}) as Record<string, unknown>;
  const after = (change.newValue ?? {}) as Record<string, unknown>;
  // Throwing away warm sessions and the sentence cache costs a full cold pass,
  // so do not do it for a badge toggle or a change of translation target.
  const relevant = PROMPT_AFFECTING.some(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
  if (!relevant) return;

  chrome.runtime.sendMessage({ type: RESET_SESSIONS }).catch(() => {
    // The engine host is not running; it will start with fresh sessions anyway.
  });
});

/* Context menus, commands and the side panel */

const MENU_ITEMS = [
  { id: 'check', title: `Check selection with ${PRODUCT}` },
  { id: 'rewrite', title: 'Rewrite selection' },
  { id: 'summarize', title: 'Summarise selection' },
  { id: 'translate', title: 'Translate selection' },
] as const;

function installMenus(): void {
  chrome.contextMenus.removeAll(() => {
    for (const item of MENU_ITEMS) {
      chrome.contextMenus.create({
        id: item.id,
        title: item.title,
        contexts: ['selection', 'editable'],
      });
    }
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  installMenus();
  void ensureOffscreen();
  void injectIntoOpenTabs();
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html?welcome=1') });
  }
});

chrome.runtime.onStartup.addListener(() => {
  installMenus();
  void ensureOffscreen();
});

/**
 * A content script is only injected into pages loaded after the extension was.
 * Without this, every tab already open when you install or reload Pilcrow stays
 * dead until it is manually refreshed — which reads as the extension being
 * broken. Injecting into existing tabs removes that whole class of confusion.
 */
async function injectIntoOpenTabs(): Promise<number> {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  let healed = 0;
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id || tab.discarded) return;
      try {
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id, allFrames: true },
          files: ['content.css'],
        });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['content.js'],
        });
        healed += 1;
      } catch {
        // Restricted page (Web Store, PDF viewer, another extension's page).
      }
    }),
  );
  return healed;
}

function sendToTab(tabId: number, message: TabMessage): void {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // No content script on this page (chrome:// URLs, the Web Store, PDFs).
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const action = info.menuItemId as 'check' | 'rewrite' | 'summarize' | 'translate';
  sendToTab(tab.id, { type: 'ctx:action', action, selection: info.selectionText ?? '' });
});

chrome.commands.onCommand.addListener((command) => {
  void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab?.id) return;
    if (command === 'check-now') sendToTab(tab.id, { type: 'cmd:check-now' });
    if (command === 'accept-first') sendToTab(tab.id, { type: 'cmd:accept-first' });
  });
});

// The action opens the popup; the side panel is opened explicitly from there.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => undefined);
