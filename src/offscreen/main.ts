import { PING_ENGINE, RESET_SESSIONS } from '@/shared/constants';
import { serveRpc, type RpcHandlers } from '@/shared/rpc';
import { getCapabilities } from '@/engine/availability';
import { resetSessions } from '@/engine/session';
import { warmUpAll } from '@/engine/download';
import { analyze, resetAnalysisCache } from '@/engine/analyze';
import { compose, rewrite } from '@/engine/rewrite';
import { summarize } from '@/engine/summarize';
import { detectLanguage, translate } from '@/engine/translate';
import { explain, synonyms } from '@/engine/assist';

/**
 * The engine host.
 *
 * Chrome's built-in AI APIs are not exposed to Web Workers, and an extension
 * service worker is one — so `LanguageModel`, `Translator`, `Summarizer` and
 * friends are all `undefined` there. This offscreen document is a genuine
 * Window, which is where they do exist.
 *
 * Two hard rules apply to this file:
 *   1. `chrome.runtime` is the ONLY extension API available here. Touching
 *      `chrome.storage` (or tabs, or anything else) throws at load, which would
 *      leave the listeners below unregistered and every port dead on arrival.
 *   2. Nothing here has user activation, so it can never start a model
 *      download. Callers do that in their own page before delegating.
 */

/**
 * Answering the ping is what tells the service worker the engine is up. It is
 * registered in the same synchronous module evaluation as serveRpc() below, so
 * a reply guarantees the port listener is live too.
 *
 * Download progress is deliberately not broadcast from here: downloads are
 * started in the page that owns the user gesture, and that page subscribes to
 * its own engine module directly.
 */
chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message?.type === PING_ENGINE) {
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === RESET_SESSIONS) {
    // Goals and house-style rules are baked into system prompts, so warm
    // sessions and every memoised sentence must be discarded when they change.
    resetSessions();
    resetAnalysisCache();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

const handlers: RpcHandlers = {
  capabilities: () => getCapabilities(),

  warmup: (params) => warmUpAll(params?.translateTarget),

  analyze: (params, { signal }) =>
    analyze(
      {
        text: params.text,
        requestId: crypto.randomUUID(),
        language: params.language,
        settings: params.settings,
        dictionary: params.dictionary,
      },
      signal,
    ),

  rewrite: async (params, { signal }) => ({ text: await rewrite(params, signal) }),

  compose: async (params, { signal }) => ({ text: await compose(params, signal) }),

  summarize: async (params, { signal }) => ({
    text: await summarize(params.text, params.type, params.length, signal, params.language),
  }),

  translate: async (params, { signal }) =>
    translate(params.text, params.target, params.source, signal),

  detectLanguage: async (params, { signal }) => detectLanguage(params.text, signal),

  explain: async (params, { signal }) => ({ text: await explain(params, signal) }),

  synonyms: async (params, { signal }) => ({ words: await synonyms(params, signal) }),
};

serveRpc(handlers);
