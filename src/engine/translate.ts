import { assertCanDownload, isUsable } from './availability';
import { monitorFor, promptJson, withSession } from './session';
import { TEXT_SCHEMA } from './schemas';
import { requirePromptLanguage } from './languages';
import { truncate } from '@/shared/text';

const DETECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['language', 'confidence'],
  properties: {
    language: { type: 'string', maxLength: 12 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

let detector: Promise<LanguageDetectorInstance> | null = null;
const translators = new Map<string, Promise<TranslatorInstance>>();

export async function detectLanguage(
  text: string,
  signal?: AbortSignal,
): Promise<{ language: string; confidence: number }> {
  const sample = truncate(text.trim(), 800);
  if (!sample) return { language: 'en', confidence: 0 };

  const detectorApi = globalThis.LanguageDetector;
  if (detectorApi) {
    try {
      // availability-language-exempt: the input language is what we are asking it to find.
      if (isUsable(await detectorApi.availability())) {
        detector ??= detectorApi.create({ monitor: monitorFor('languageDetector') });
        const results = await (await detector).detect(sample, { signal });
        const best = results?.[0];
        if (best) return { language: best.detectedLanguage, confidence: best.confidence };
      }
    } catch {
      detector = null;
    }
  }

  // Fall back to the Prompt API so detection still works without the stable API.
  try {
    return await withSession(
      {
        key: 'detect',
        // The reply is a language tag, not prose, so English is always correct.
        system:
          'You identify the language of text. Reply with its BCP-47 code (for example "en", "pt-BR") and your confidence.',
        creativity: 0,
        language: 'en',
      },
      (session) =>
        promptJson<{ language: string; confidence: number }>(
          session,
          `Identify the language of this text:\n\n${sample}`,
          DETECT_SCHEMA,
          signal,
        ),
      signal,
    );
  } catch {
    return { language: 'en', confidence: 0 };
  }
}

export async function translate(
  text: string,
  target: string,
  source: string | undefined,
  signal?: AbortSignal,
): Promise<{ text: string; source: string }> {
  const from = source ?? (await detectLanguage(text, signal)).language;
  const normalisedFrom = from.split('-')[0] || 'en';
  if (normalisedFrom === target.split('-')[0]) return { text, source: from };

  const translatorApi = globalThis.Translator;
  if (translatorApi) {
    try {
      const availability = await translatorApi.availability({
        sourceLanguage: normalisedFrom,
        targetLanguage: target,
      });
      if (isUsable(availability)) {
        // See summarize.ts: a still-downloading model makes create() block
        // instead of failing, which strands the caller indefinitely.
        assertCanDownload(availability, `The ${normalisedFrom} → ${target} translator`);
        const key = `${normalisedFrom}->${target}`;
        let pending = translators.get(key);
        if (!pending) {
          pending = translatorApi.create({
            sourceLanguage: normalisedFrom,
            targetLanguage: target,
            monitor: monitorFor('translator'),
          });
          translators.set(key, pending);
        }
        const translator = await pending;
        return { text: await translator.translate(text, { signal }), source: from };
      }
    } catch {
      translators.delete(`${normalisedFrom}->${target}`);
    }
  }

  const result = await withSession(
    {
      key: 'translate',
      system:
        'You are a translator. Translate the user’s text faithfully, preserving formatting, names, numbers and markup. Return only the translation.',
      creativity: 0.1,
      language: requirePromptLanguage(target),
    },
    (session) =>
      promptJson<{ text: string }>(
        session,
        `Translate this text into ${target}:\n\n${text}`,
        TEXT_SCHEMA,
        signal,
      ),
    signal,
  );
  return { text: result.text, source: from };
}
