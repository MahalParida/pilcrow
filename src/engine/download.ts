import type { WarmupApiResult, WarmupReport } from '@/shared/types';
import { hasUserActivation, isReady, isUsable } from './availability';
import { languageExpectations } from './languages';
import { monitorFor } from './session';

/**
 * Brings every available model onto the device.
 *
 * This MUST be called from a page handling a real user gesture — Chrome refuses
 * to start a download without transient user activation, and activation does
 * not survive a `chrome.runtime` message hop. Calling it from the offscreen
 * document or the service worker will fail for anything not already downloaded.
 */
async function warmOne(
  api: string,
  label: string,
  present: unknown,
  availability: () => Promise<AIAvailability>,
  create: () => Promise<{ destroy(): void }>,
): Promise<WarmupApiResult> {
  if (!present) {
    return { api, label, ready: false, error: 'Not enabled in this Chrome build' };
  }
  let state: AIAvailability;
  try {
    state = await availability();
  } catch (error) {
    return { api, label, ready: false, error: message(error) };
  }
  if (!isUsable(state)) {
    return { api, label, ready: false, error: 'Not available on this device' };
  }
  if (isReady(state)) return { api, label, ready: true };

  try {
    // Creating the instance is what actually triggers the download.
    const instance = await create();
    instance.destroy();
    return { api, label, ready: true };
  } catch (error) {
    // A create() that throws is not proof of a failed download: some of these
    // APIs run a first inference on the way up and report *its* failure (the
    // Proofreader's "wrong label count", for one). Re-probe — if the model is
    // on the device now, the download is what was asked about and it worked.
    try {
      if (isReady(await availability())) return { api, label, ready: true };
    } catch {
      // Fall through and report the original, more useful error.
    }
    return { api, label, ready: false, error: message(error) };
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function warmUpAll(translateTarget = 'es'): Promise<WarmupReport> {
  const target = translateTarget || 'es';

  const apis = await Promise.all([
    warmOne(
      'languageModel',
      'Prompt API',
      globalThis.LanguageModel,
      // Declared on both calls: Chrome warns on any request, including a bare
      // availability probe, that does not attest an output language.
      () => LanguageModel!.availability(languageExpectations('en')),
      () =>
        LanguageModel!.create({
          monitor: monitorFor('languageModel'),
          ...languageExpectations('en'),
        }),
    ),
    warmOne(
      'languageDetector',
      'Language detector',
      globalThis.LanguageDetector,
      // availability-language-exempt: the input language is what it detects.
      () => LanguageDetector!.availability(),
      () => LanguageDetector!.create({ monitor: monitorFor('languageDetector') }),
    ),
    warmOne(
      'translator',
      `Translator (en → ${target})`,
      globalThis.Translator,
      () => Translator!.availability({ sourceLanguage: 'en', targetLanguage: target }),
      () =>
        Translator!.create({
          sourceLanguage: 'en',
          targetLanguage: target,
          monitor: monitorFor('translator'),
        }),
    ),
    warmOne(
      'summarizer',
      'Summarizer',
      globalThis.Summarizer,
      () => Summarizer!.availability({ expectedInputLanguages: ['en'], outputLanguage: 'en' }),
      () =>
        Summarizer!.create({
          monitor: monitorFor('summarizer'),
          expectedInputLanguages: ['en'],
          outputLanguage: 'en',
        }),
    ),
    warmOne(
      'proofreader',
      'Proofreader',
      globalThis.Proofreader,
      () => Proofreader!.availability({ expectedInputLanguages: ['en'] }),
      () =>
        Proofreader!.create({
          expectedInputLanguages: ['en'],
          monitor: monitorFor('proofreader'),
        }),
    ),
    warmOne(
      'rewriter',
      'Rewriter',
      globalThis.Rewriter,
      () => Rewriter!.availability({ expectedInputLanguages: ['en'], outputLanguage: 'en' }),
      () =>
        Rewriter!.create({
          monitor: monitorFor('rewriter'),
          expectedInputLanguages: ['en'],
          outputLanguage: 'en',
        }),
    ),
    warmOne(
      'writer',
      'Writer',
      globalThis.Writer,
      () => Writer!.availability({ outputLanguage: 'en' }),
      () => Writer!.create({ monitor: monitorFor('writer'), outputLanguage: 'en' }),
    ),
  ]);

  const core = apis.find((entry) => entry.api === 'languageModel');
  return {
    ok: Boolean(core?.ready),
    detail: hasUserActivation()
      ? undefined
      : 'Downloads were attempted without a user gesture, so Chrome may have refused them.',
    apis,
  };
}

/** Downloads just the summarizer, for use at the moment a user clicks. */
export async function warmUpSummarizer(): Promise<WarmupApiResult> {
  return warmOne(
    'summarizer',
    'Summarizer',
    globalThis.Summarizer,
    () => Summarizer!.availability({ expectedInputLanguages: ['en'], outputLanguage: 'en' }),
    () =>
      Summarizer!.create({
        monitor: monitorFor('summarizer'),
        expectedInputLanguages: ['en'],
        outputLanguage: 'en',
      }),
  );
}

/** Downloads just the language pair the translate action needs. */
export async function warmUpTranslator(
  source: string,
  target: string,
): Promise<WarmupApiResult> {
  return warmOne(
    'translator',
    `Translator (${source} → ${target})`,
    globalThis.Translator,
    () => Translator!.availability({ sourceLanguage: source, targetLanguage: target }),
    () =>
      Translator!.create({
        sourceLanguage: source,
        targetLanguage: target,
        monitor: monitorFor('translator'),
      }),
  );
}
