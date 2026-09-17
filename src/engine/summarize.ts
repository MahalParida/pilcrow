import { assertCanDownload, isUsable } from './availability';
import { monitorFor, promptJson, withSession } from './session';
import { TEXT_SCHEMA } from './schemas';
import { baseLanguage, requirePromptLanguage } from './languages';
import { detectLanguage } from './translate';

const TYPE_WORDS: Record<SummarizerType, string> = {
  'key-points': 'a bulleted list of the key points',
  tldr: 'a short TL;DR paragraph',
  teaser: 'an enticing teaser that makes the reader want to read on',
  headline: 'a single headline',
};

export async function summarize(
  text: string,
  type: SummarizerType = 'key-points',
  length: SummarizerLength = 'medium',
  signal?: AbortSignal,
  languageTag?: string,
): Promise<string> {
  // Detected rather than assumed: defaulting an unknown language to English
  // would make the dedicated API summarise foreign text into English.
  const tag = languageTag ?? (await detectLanguage(text, signal)).language;
  const language = baseLanguage(tag);
  // The Summarizer supports more languages than the Prompt API attests for, so
  // it is asked with the real language and left to decline if it cannot help.
  const api = globalThis.Summarizer;
  if (api) {
    try {
      const state = await api.availability({
        expectedInputLanguages: [language],
        outputLanguage: language,
      });
      if (isUsable(state)) {
        // create() blocks until the model is on disk, and a download cannot be
        // started from here at all. Without this the call hangs for as long as
        // the download takes, leaving the caller's button stuck on "Working…".
        assertCanDownload(state, 'The summarizer');
        const summarizer = await api.create({
          type,
          length,
          format: 'plain-text',
          expectedInputLanguages: [language],
          outputLanguage: language,
          monitor: monitorFor('summarizer'),
          signal,
        });
        try {
          return await summarizer.summarize(text, { signal });
        } finally {
          summarizer.destroy();
        }
      }
    } catch {
      // Fall through to the Prompt API.
    }
  }

  // Only the Prompt API fallback is bound by the attested-language list.
  const result = await withSession(
    {
      key: 'summarize',
      system:
        'You summarise text accurately. Never introduce facts that are not in the source. Return only the summary.',
      creativity: 0.2,
      language: requirePromptLanguage(tag),
    },
    (session) =>
      promptJson<{ text: string }>(
        session,
        `Write ${TYPE_WORDS[type]} (${length} length) for this text:\n\n${text}`,
        TEXT_SCHEMA,
        signal,
      ),
    signal,
  );
  return result.text.trim();
}
