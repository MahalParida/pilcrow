import { assertCanDownload, isUsable } from './availability';
import { monitorFor, promptJson, withSession } from './session';
import { TEXT_SCHEMA } from './schemas';
import { baseLanguage, requirePromptLanguage } from './languages';
import { detectLanguage } from './translate';

export interface RewriteParams {
  text: string;
  tone?: RewriterTone;
  length?: RewriterLength;
  instruction?: string;
  context?: string;
  language?: string;
}

const TONE_WORDS: Record<RewriterTone, string> = {
  'more-formal': 'more formal and professional',
  'as-is': 'the same in tone',
  'more-casual': 'more casual and conversational',
};

const LENGTH_WORDS: Record<RewriterLength, string> = {
  shorter: 'noticeably shorter',
  'as-is': 'about the same length',
  longer: 'more developed and longer',
};

export async function rewrite(params: RewriteParams, signal?: AbortSignal): Promise<string> {
  const { text, tone = 'as-is', length = 'as-is', instruction, context } = params;
  // Detected rather than assumed. A context-menu rewrite has no focused editor
  // and so no known language; defaulting to English would rewrite Spanish prose
  // into English instead of improving it.
  const tag = params.language ?? (await detectLanguage(text, signal)).language;
  const language = baseLanguage(tag);

  const rewriterApi = globalThis.Rewriter;
  if (rewriterApi) {
    try {
      const options = { expectedInputLanguages: [language], outputLanguage: language };
      const state = await rewriterApi.availability(options);
      if (isUsable(state)) {
        // See summarize.ts: create() on a model that is still downloading does
        // not fail, it blocks. Fail fast so the Prompt API fallback runs.
        assertCanDownload(state, 'The rewriter');
        const rewriter = await rewriterApi.create({
          tone,
          length,
          format: 'plain-text',
          sharedContext: context,
          ...options,
          monitor: monitorFor('rewriter'),
          signal,
        });
        try {
          return await rewriter.rewrite(text, { context: instruction, signal });
        } finally {
          rewriter.destroy();
        }
      }
    } catch {
      // Origin-trial API missing or wedged; the Prompt API path below covers it.
    }
  }

  const directives = [
    `Make it ${TONE_WORDS[tone]}.`,
    `Make it ${LENGTH_WORDS[length]}.`,
    instruction ? `Follow this instruction: ${instruction}` : '',
    context ? `Context: ${context}` : '',
  ].filter(Boolean);

  const result = await withSession(
    {
      key: 'rewrite',
      system:
        'You rewrite text on request. Preserve the author’s meaning, facts, names, numbers, URLs and markup exactly. Return only the rewritten text, with no preamble, quotes or commentary.',
      creativity: 0.35,
      // Only the Prompt API fallback is bound by the attested-language list.
      language: requirePromptLanguage(tag),
    },
    (session) =>
      promptJson<{ text: string }>(
        session,
        `${directives.join('\n')}\n\nRewrite this text:\n\n${text}`,
        TEXT_SCHEMA,
        signal,
      ),
    signal,
  );
  return result.text.trim();
}

export interface ComposeParams {
  instruction: string;
  tone?: WriterTone;
  length?: WriterLength;
  context?: string;
  language?: string;
}

export async function compose(params: ComposeParams, signal?: AbortSignal): Promise<string> {
  const { instruction, tone = 'neutral', length = 'medium', context } = params;
  const language = requirePromptLanguage(params.language);

  const writerApi = globalThis.Writer;
  if (writerApi) {
    try {
      const options = { outputLanguage: language };
      const state = await writerApi.availability(options);
      if (isUsable(state)) {
        assertCanDownload(state, 'The writer');
        const writer = await writerApi.create({
          tone,
          length,
          format: 'plain-text',
          sharedContext: context,
          ...options,
          monitor: monitorFor('writer'),
          signal,
        });
        try {
          return await writer.write(instruction, { context, signal });
        } finally {
          writer.destroy();
        }
      }
    } catch {
      // Fall through to the Prompt API.
    }
  }

  const result = await withSession(
    {
      key: 'compose',
      system:
        'You draft text to order. Write in a natural human voice, never explain yourself, and return only the requested text with no preamble or sign-off placeholders unless asked.',
      creativity: 0.5,
      language,
    },
    (session) =>
      promptJson<{ text: string }>(
        session,
        [
          `Tone: ${tone}. Length: ${length}.`,
          context ? `Context the text must fit:\n${context}` : '',
          `Write the following:\n${instruction}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
        TEXT_SCHEMA,
        signal,
      ),
    signal,
  );
  return result.text.trim();
}
