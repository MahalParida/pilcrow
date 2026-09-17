import { promptJson, withSession } from './session';
import { SYNONYMS_SCHEMA, TEXT_SCHEMA } from './schemas';
import { requirePromptLanguage } from './languages';

/** Answers "why is this wrong?" for a single suggestion. */
export async function explain(
  params: {
    sentence: string;
    original: string;
    replacement: string;
    message: string;
    language?: string;
  },
  signal?: AbortSignal,
): Promise<string> {
  const result = await withSession(
    {
      key: 'explain',
      system:
        'You explain writing corrections to a curious adult in two or three plain sentences. Name the rule where one applies, but never lecture and never repeat the correction verbatim.',
      creativity: 0.2,
      language: requirePromptLanguage(params.language),
    },
    (session) =>
      promptJson<{ text: string }>(
        session,
        [
          `Sentence: ${params.sentence}`,
          `Original: “${params.original}”`,
          `Suggested: “${params.replacement}”`,
          `Headline: ${params.message}`,
          'Explain why the suggestion is an improvement.',
        ].join('\n'),
        TEXT_SCHEMA,
        signal,
      ),
    signal,
  );
  return result.text.trim();
}

export async function synonyms(
  params: { word: string; sentence: string; language?: string },
  signal?: AbortSignal,
): Promise<string[]> {
  const result = await withSession(
    {
      key: 'synonyms',
      system:
        'You suggest replacement words that fit a specific sentence. Match the part of speech and register of the original. Never repeat the original word.',
      creativity: 0.4,
      language: requirePromptLanguage(params.language),
    },
    (session) =>
      promptJson<{ words: string[] }>(
        session,
        `Sentence: ${params.sentence}\n\nSuggest alternatives for the word “${params.word}” as used here.`,
        SYNONYMS_SCHEMA,
        signal,
      ),
    signal,
  );
  return result.words
    .map((w) => w.trim())
    .filter((w) => w && w.toLowerCase() !== params.word.toLowerCase())
    .slice(0, 8);
}
