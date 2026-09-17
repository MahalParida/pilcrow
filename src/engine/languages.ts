/**
 * Chrome's built-in APIs each accept a different, and quite narrow, set of
 * languages. Getting this wrong is not cosmetic: the Proofreader *aborts* the
 * request for an unsupported language, and the Prompt API refuses to attest to
 * output safety unless an output language is declared.
 */

/** The Proofreader API is English-only; anything else aborts the call. */
export const PROOFREADER_LANGUAGES = ['en'];

/** Output languages the Prompt API will attest for. */
export const PROMPT_LANGUAGES = ['de', 'en', 'es', 'fr', 'ja'];

/**
 * The language declaration Chrome expects. It is required on `availability()`
 * as well as `create()` — an undeclared availability probe warns exactly like
 * an undeclared prompt does, which is easy to miss because nothing is being
 * generated.
 */
export const languageExpectations = (language: string) => ({
  expectedInputs: [{ type: 'text' as const, languages: [language] }],
  expectedOutputs: [{ type: 'text' as const, languages: [language] }],
});

export const baseLanguage = (tag: string | undefined): string =>
  (tag ?? 'en').split('-')[0]!.toLowerCase();

/**
 * Returns the language to declare on a Prompt API session, or `undefined` when
 * the text is in a language Chrome does not attest for. Deliberately not
 * defaulting to English: forcing `en` on Spanish input makes the model
 * translate the text instead of correcting it.
 */
export const promptLanguage = (tag: string | undefined): string | undefined => {
  const base = baseLanguage(tag);
  return PROMPT_LANGUAGES.includes(base) ? base : undefined;
};

export const proofreaderSupports = (tag: string | undefined): boolean =>
  PROOFREADER_LANGUAGES.includes(baseLanguage(tag));

/**
 * Same as `promptLanguage`, but for paths that cannot silently skip. An
 * unknown language resolves to English; only an explicitly unsupported one
 * throws, and it throws something the user can read.
 */
export function requirePromptLanguage(tag: string | undefined): string {
  const code = promptLanguage(tag);
  if (code) return code;
  throw new Error(
    `Chrome’s on-device model does not support ${baseLanguage(tag)} yet. ` +
      `It supports ${PROMPT_LANGUAGES.join(', ')}.`,
  );
}
