import type { CapabilityReport } from '@/shared/types';
import { languageExpectations } from './languages';

/** Chrome has used both spellings for "the model is loaded and usable". */
export const isReady = (state: AIAvailability | 'missing'): boolean =>
  state === 'available' || state === 'readily';

/** The model exists but must be downloaded before first use. */
export const needsDownload = (state: AIAvailability | 'missing'): boolean =>
  state === 'downloadable' || state === 'downloading';

export const isUsable = (state: AIAvailability | 'missing'): boolean =>
  isReady(state) || needsDownload(state);

async function probe(
  api: unknown,
  check: () => Promise<AIAvailability>,
): Promise<AIAvailability | 'missing'> {
  if (!api) return 'missing';
  try {
    return await check();
  } catch {
    // A present-but-disabled API (flag off, unsupported platform) throws here.
    return 'unavailable';
  }
}

export async function getCapabilities(): Promise<CapabilityReport> {
  const [
    languageModel,
    proofreader,
    rewriter,
    writer,
    summarizer,
    translator,
    languageDetector,
  ] = await Promise.all([
    // Declared here too: an availability probe without it warns just as a
    // prompt does, and this one runs on every panel and popup open.
    probe(globalThis.LanguageModel, () => LanguageModel!.availability(languageExpectations('en'))),
    probe(globalThis.Proofreader, () => Proofreader!.availability({ expectedInputLanguages: ['en'] })),
    probe(globalThis.Rewriter, () =>
      Rewriter!.availability({ expectedInputLanguages: ['en'], outputLanguage: 'en' }),
    ),
    probe(globalThis.Writer, () =>
      Writer!.availability({ expectedInputLanguages: ['en'], outputLanguage: 'en' }),
    ),
    probe(globalThis.Summarizer, () =>
      Summarizer!.availability({ expectedInputLanguages: ['en'], outputLanguage: 'en' }),
    ),
    probe(globalThis.Translator, () =>
      Translator!.availability({ sourceLanguage: 'en', targetLanguage: 'es' }),
    ),
    // availability-language-exempt: detection has no input language by
    // definition — declaring one would defeat the purpose.
    probe(globalThis.LanguageDetector, () => LanguageDetector!.availability()),
  ]);

  return {
    languageModel,
    proofreader,
    rewriter,
    writer,
    summarizer,
    translator,
    languageDetector,
    usable: isUsable(languageModel),
  };
}

/**
 * Chrome requires transient user activation before it will start downloading a
 * model. Activation is not carried across `chrome.runtime` messages, so this is
 * only ever true in a page reacting to a real click — never in the offscreen
 * document or the service worker.
 */
export function hasUserActivation(): boolean {
  return globalThis.navigator?.userActivation?.isActive ?? false;
}

/**
 * Turns the "download needs a gesture" failure into an instruction the user can
 * act on, instead of whatever Chrome throws from `create()`.
 */
export function assertCanDownload(state: AIAvailability | 'missing', label: string): void {
  if (needsDownload(state) && !hasUserActivation()) {
    throw new Error(
      `${label} still needs to be downloaded. Open the Pilcrow popup and choose “Download models”.`,
    );
  }
}

export function describeCapability(state: AIAvailability | 'missing'): string {
  switch (state) {
    case 'available':
    case 'readily':
      return 'Ready';
    case 'downloadable':
      return 'Downloads on first use';
    case 'downloading':
      return 'Downloading…';
    case 'unavailable':
      return 'Not available on this device';
    default:
      return 'Not enabled in this Chrome build';
  }
}
