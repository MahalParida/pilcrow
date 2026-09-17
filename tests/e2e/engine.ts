// Deterministic test double at the engine boundary, not an accuracy benchmark.
import { serveRpc } from '../../src/shared/rpc';
import { PING_ENGINE } from '../../src/shared/constants';
import { computeStats, computeScore } from '../../src/shared/stats';
import { hashText } from '../../src/shared/text';
import type { Suggestion } from '../../src/shared/types';
const unsupported = async (): Promise<never> => { throw new Error('Not implemented by the E2E engine double'); };
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === PING_ENGINE) reply({ ok: true });
});
serveRpc({
  warmup: unsupported, rewrite: unsupported, compose: unsupported,
  summarize: unsupported, translate: unsupported, detectLanguage: unsupported,
  synonyms: unsupported,
  capabilities: async () => ({ languageModel: 'available', proofreader: 'missing',
    rewriter: 'missing', writer: 'missing', summarizer: 'missing',
    translator: 'missing', languageDetector: 'missing', usable: true }),
  analyze: async ({ text, dictionary, settings }) => {
    await new Promise(resolve => setTimeout(resolve, text.includes('SLOW') ? 1200 : 50));
    const suggestions: Suggestion[] = [];
    for (const [original, replacement] of [['teh', 'the'], ['recieve', 'receive']]) {
      if (!settings.categories.spelling || dictionary.includes(original)) continue;
      for (const match of text.matchAll(new RegExp(`\\b${original}\\b`, 'g'))) {
        suggestions.push({ id: `test-${match.index}`, start: match.index!,
          end: match.index! + original.length, original, replacement, category: 'spelling',
          severity: 'critical', message: 'Correct the spelling', source: 'model' });
      }
    }
    suggestions.sort((a,b) => a.start - b.start);
    const stats = computeStats(text);
    return { requestId: crypto.randomUUID(), textHash: hashText(text), language: 'en',
      suggestions, stats, score: computeScore(stats, suggestions), tones: [],
      truncated: false, elapsedMs: 0, timings: { detect: 0, proofread: 0, model: 0, tone: 0 },
      reuse: { cached: 0, prompted: 1 }, unsupportedLanguage: false };
  },
  explain: async () => ({ text: 'This is a deterministic test explanation, not model output.' }),
});
