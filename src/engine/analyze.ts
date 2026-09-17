import type {
  AnalysisResult,
  Category,
  Settings,
  Suggestion,
  ToneReading,
} from '@/shared/types';
import {
  CATEGORIES,
  CATEGORY_META,
  CHUNK_TARGET_CHARS,
  CRITICAL_CATEGORIES,
  MAX_CHARS_PER_PASS,
  MIN_CHARS_TO_CHECK,
  PRODUCT,
} from '@/shared/constants';
import {
  chunkSentences,
  hashText,
  locate,
  splitSentences,
  truncate,
  uid,
  words,
  type Sentence,
} from '@/shared/text';
import { computeScore, computeStats } from '@/shared/stats';
import { promptJson, withSession } from './session';
import { TONE_SCHEMA, issuesSchema } from './schemas';
import { detectLanguage } from './translate';
import { promptLanguage } from './languages';
import { runProofreader } from './proofread';

export interface ModelIssue {
  sentence: number;
  original: string;
  replacement: string;
  category: Category;
  message: string;
  explanation?: string;
}

type CachedIssue = Omit<ModelIssue, 'sentence'>;

/**
 * Sentence-level memo of model output.
 *
 * Typing re-checks the whole field, but only the sentence under the caret has
 * actually changed. Keying on the sentence text (plus the system prompt, which
 * encodes the user's goals and style rules) means a repeat pass only prompts
 * for what is new. Clean sentences are cached too — an empty result is the most
 * common and most valuable thing to avoid re-asking for.
 */
const sentenceCache = new Map<string, CachedIssue[]>();
const CACHE_LIMIT = 800;

/**
 * Evicts oldest-first rather than clearing. A document larger than the limit
 * would otherwise wipe the whole cache on every pass and never register a hit —
 * precisely the case the cache exists for.
 */
function remember(key: string, issues: CachedIssue[]): void {
  if (sentenceCache.size >= CACHE_LIMIT) {
    const evict = Math.ceil(CACHE_LIMIT / 4);
    let dropped = 0;
    for (const oldest of sentenceCache.keys()) {
      if (dropped >= evict) break;
      sentenceCache.delete(oldest);
      dropped += 1;
    }
  }
  sentenceCache.set(key, issues);
}

const cacheKey = (systemHash: string, sentence: string) => `${systemHash}\u0000${sentence}`;

export function resetAnalysisCache(): void {
  sentenceCache.clear();
}

export interface AnalyzeParams {
  text: string;
  requestId: string;
  language?: string;
  settings: Settings;
  dictionary: string[];
}

const GOAL_WORDS = {
  audience: {
    general: 'a general audience with no background in the subject',
    knowledgeable: 'readers who already know the subject',
    expert: 'domain experts who expect precision',
  },
  formality: {
    informal: 'informal',
    neutral: 'neutral',
    formal: 'formal',
  },
  domain: {
    general: 'general writing',
    academic: 'academic writing',
    business: 'business writing',
    technical: 'technical documentation',
    creative: 'creative writing',
    casual: 'casual conversation',
  },
  intent: {
    inform: 'inform the reader',
    describe: 'describe something',
    convince: 'convince the reader',
    'tell-story': 'tell a story',
  },
} as const;

function buildSystemPrompt(settings: Settings): string {
  const { goals, styleRules } = settings;
  const lines = [
    `You are the proofreading engine inside ${PRODUCT}, a private on-device writing assistant.`,
    'You are given numbered sentences and must return a JSON object listing only genuine problems.',
    '',
    'Hard rules, in priority order:',
    '1. "original" MUST be copied character-for-character from the sentence you cite. Never paraphrase it, re-punctuate it or add surrounding words.',
    '2. Keep "original" as short as possible while remaining unique inside that sentence.',
    '3. "replacement" replaces exactly that span. Use an empty string to delete the span.',
    '4. Never change the author’s meaning, facts, names, quotations, numbers, URLs, code or markup.',
    '5. Never report an issue in text that is already correct. Returning an empty list is a normal, expected answer.',
    '6. Never emit two issues covering the same span.',
    '7. "message" is a short imperative headline, e.g. "Add a comma before ‘but’".',
    '',
    'The writing is aimed at ' + GOAL_WORDS.audience[goals.audience] + '.',
    `It should read as ${GOAL_WORDS.formality[goals.formality]} ${GOAL_WORDS.domain[goals.domain]}, written to ${GOAL_WORDS.intent[goals.intent]}.`,
  ];

  if (styleRules.length > 0) {
    lines.push(
      '',
      'The author has additional house-style rules. Report violations under the "style" category:',
      ...styleRules.map((rule, index) => `${index + 1}. ${rule}`),
    );
  }
  return lines.join('\n');
}

function enabledCategories(settings: Settings): Category[] {
  return CATEGORIES.filter((category) => settings.categories[category] !== false);
}

function severityFor(category: Category): Suggestion['severity'] {
  return CRITICAL_CATEGORIES.has(category) ? 'critical' : 'advisory';
}

/** Model output is text-addressed; this pins each issue to real offsets. */
export function anchorIssues(
  issues: ModelIssue[],
  chunk: ReturnType<typeof splitSentences>,
  text: string,
  allowed: Set<Category>,
  ignoredWords: Set<string>,
): Suggestion[] {
  const chunkStart = chunk[0]?.start ?? 0;
  const chunkEnd = chunk.at(-1)?.end ?? text.length;
  const out: Suggestion[] = [];

  for (const issue of issues) {
    if (!issue?.original || typeof issue.original !== 'string') continue;
    if (!allowed.has(issue.category)) continue;

    const sentence = chunk[Math.min(Math.max(issue.sentence, 0), chunk.length - 1)];
    if (!sentence) continue;

    const found =
      locate(text, issue.original, sentence.start, sentence.end, sentence.start) ??
      locate(text, issue.original, chunkStart, chunkEnd, sentence.start);
    if (!found) continue;

    const original = text.slice(found.start, found.end);
    const replacement = issue.replacement ?? '';
    if (original === replacement) continue;

    // Respect the personal dictionary for spelling only: the author may still
    // want a grammar note about a word they have chosen to keep.
    if (issue.category === 'spelling' && ignoredWords.has(original.trim().toLowerCase())) continue;

    out.push({
      id: uid('m'),
      start: found.start,
      end: found.end,
      original,
      replacement,
      category: issue.category,
      severity: severityFor(issue.category),
      message: issue.message?.trim() || `Consider “${replacement}”`,
      explanation: issue.explanation?.trim() || undefined,
      source: 'model',
    });
  }
  return out;
}

/**
 * Proofreader results win any overlap: they carry exact indices from a
 * purpose-built model, whereas Prompt API spans are recovered by string search.
 */
export function mergeSuggestions(preferred: Suggestion[], rest: Suggestion[]): Suggestion[] {
  const kept: Suggestion[] = [];
  const overlaps = (candidate: Suggestion) =>
    kept.some((k) => candidate.start < k.end && k.start < candidate.end);

  for (const suggestion of [...preferred].sort((a, b) => a.start - b.start)) {
    if (suggestion.start === suggestion.end && !suggestion.replacement) continue;
    if (!overlaps(suggestion)) kept.push(suggestion);
  }
  for (const suggestion of [...rest].sort((a, b) => a.start - b.start)) {
    if (!overlaps(suggestion)) kept.push(suggestion);
  }
  return kept.sort((a, b) => a.start - b.start);
}

async function detectTone(
  text: string,
  language: string,
  signal?: AbortSignal,
): Promise<ToneReading[]> {
  const promptLang = promptLanguage(language);
  if (!promptLang) return [];
  try {
    const result = await withSession(
      {
        key: 'tone',
        system:
          'You read the tone of a piece of writing as a reader would receive it. Return at most three tones, strongest first, with a confidence between 0 and 1.',
        creativity: 0.1,
        language: promptLang,
      },
      (session) =>
        promptJson<{ tones: ToneReading[] }>(
          session,
          `Language: ${language}\n\nHow does this text come across?\n\n${truncate(text, 1400)}`,
          TONE_SCHEMA,
          signal,
        ),
      signal,
    );
    return (result.tones ?? []).filter((tone) => tone?.label).slice(0, 3);
  } catch {
    return [];
  }
}

export async function analyze(
  params: AnalyzeParams,
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  const started = performance.now();
  const { requestId, settings, dictionary } = params;
  const full = params.text;
  const truncated = full.length > MAX_CHARS_PER_PASS;
  const text = truncated ? full.slice(0, MAX_CHARS_PER_PASS) : full;

  const timings = { detect: 0, proofread: 0, model: 0, tone: 0 };
  const reuse = { cached: 0, prompted: 0 };
  const stats = computeStats(text);
  let unsupportedLanguage = false;

  const build = (
    suggestions: Suggestion[],
    language: string,
    tones: ToneReading[],
  ): AnalysisResult => ({
    requestId,
    textHash: hashText(full),
    language,
    suggestions,
    tones,
    stats,
    score: computeScore(stats, suggestions),
    truncated,
    elapsedMs: Math.round(performance.now() - started),
    timings,
    reuse,
    unsupportedLanguage,
  });

  if (text.trim().length < MIN_CHARS_TO_CHECK) return build([], params.language ?? 'en', []);

  // Detection is a model round-trip, so callers pass the language back on
  // subsequent passes over the same field and skip it entirely.
  let language = params.language ?? (settings.checkLanguage !== 'auto' ? settings.checkLanguage : '');
  if (!language) {
    const detectStarted = performance.now();
    language = (await detectLanguage(text, signal)).language;
    timings.detect = Math.round(performance.now() - detectStarted);
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const allowed = new Set(enabledCategories(settings));
  const ignoredWords = new Set(dictionary.map((w) => w.toLowerCase()));

  const wantsMechanical =
    allowed.has('spelling') || allowed.has('grammar') || allowed.has('punctuation');

  /** Exact offsets from the dedicated model, when the flag is on. */
  const proofreadPass = async (): Promise<Suggestion[]> => {
    if (!wantsMechanical) return [];
    const stage = performance.now();
    const found = await runProofreader(text, language.split('-')[0] ?? 'en', signal);
    timings.proofread = Math.round(performance.now() - stage);
    return found.filter(
      (s) =>
        allowed.has(s.category) &&
        !(s.category === 'spelling' && ignoredWords.has(s.original.trim().toLowerCase())),
    );
  };

  const modelPass = async (): Promise<Suggestion[]> => {
    if (allowed.size === 0) return [];
    // Chrome only attests output quality and safety for a handful of
    // languages. Running anyway would emit a warning on every keystroke and
    // produce suggestions nobody has vouched for, so say so instead.
    const promptLang = promptLanguage(language);
    if (!promptLang) {
      unsupportedLanguage = true;
      return [];
    }
    const stage = performance.now();
    const system = buildSystemPrompt(settings);
    const systemHash = hashText(system);
    const schema = issuesSchema([...allowed]);
    const chunks = chunkSentences(splitSentences(text), CHUNK_TARGET_CHARS);
    const dictionaryNote =
      dictionary.length > 0
        ? `Treat these as correctly spelled: ${truncate(dictionary.join(', '), 400)}`
        : '';
    const categoryNote = [...allowed]
      .map((category) => `${category} (${CATEGORY_META[category].blurb.toLowerCase()})`)
      .join('; ');

    const out: Suggestion[] = [];
    /** Anchors one sentence's issues, which are always numbered 0 in isolation. */
    const anchorOne = (sentence: Sentence, issues: CachedIssue[]) =>
      out.push(
        ...anchorIssues(
          issues.map((issue) => ({ ...issue, sentence: 0 })),
          [sentence],
          text,
          allowed,
          ignoredWords,
        ),
      );

    for (const chunk of chunks) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const pending: Sentence[] = [];
      for (const sentence of chunk) {
        const hit = sentenceCache.get(cacheKey(systemHash, sentence.text));
        if (hit) {
          reuse.cached += 1;
          anchorOne(sentence, hit);
        } else {
          pending.push(sentence);
        }
      }
      if (pending.length === 0) continue;
      reuse.prompted += pending.length;

      const prompt = [
        `Language: ${language}`,
        `Report only these categories: ${categoryNote}.`,
        dictionaryNote,
        '',
        'Sentences:',
        ...pending.map((sentence, index) => `${index}. ${sentence.text}`),
      ]
        .filter(Boolean)
        .join('\n');

      try {
        const result = await withSession(
          {
            key: `analyze:${systemHash}`,
            system,
            creativity: 0.05,
            language: promptLang,
          },
          (session) => promptJson<{ issues: ModelIssue[] }>(session, prompt, schema, signal),
          signal,
        );

        const bySentence = new Map<number, CachedIssue[]>();
        for (const issue of result.issues ?? []) {
          const index = Math.min(Math.max(issue.sentence ?? 0, 0), pending.length - 1);
          const { sentence: _ignored, ...rest } = issue;
          bySentence.set(index, [...(bySentence.get(index) ?? []), rest]);
        }
        pending.forEach((sentence, index) => {
          const issues = bySentence.get(index) ?? [];
          // Caching the empty case is the point: clean sentences stay free.
          remember(cacheKey(systemHash, sentence.text), issues);
          anchorOne(sentence, issues);
        });
      } catch (error) {
        if (signal?.aborted || (error as Error)?.name === 'AbortError') throw error;
        // One bad chunk should not sink the whole pass.
      }
    }
    timings.model = Math.round(performance.now() - stage);
    return out;
  };

  const tonePass = async (): Promise<ToneReading[]> => {
    if (words(text).length < 25) return [];
    const stage = performance.now();
    const tones = await detectTone(text, language, signal);
    timings.tone = Math.round(performance.now() - stage);
    return tones;
  };

  // These hit different models and do not depend on each other, so the pass
  // costs about as long as its slowest leg rather than their sum.
  const [proofread, modelSuggestions, tones] = await Promise.all([
    proofreadPass(),
    modelPass(),
    tonePass(),
  ]);

  return build(mergeSuggestions(proofread, modelSuggestions), language, tones);
}
