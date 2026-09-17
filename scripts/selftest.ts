/**
 * Verifies the pure, DOM-free logic: sentence offsets, the string search that
 * anchors model output back to the field, statistics and scoring. These are the
 * parts where a silent bug would produce wrong underlines rather than a crash.
 */
import { chunkSentences, isPassive, locate, splitSentences } from '@/shared/text';
import { computeScore, computeStats } from '@/shared/stats';
import { anchorIssues, mergeSuggestions, type ModelIssue } from '@/engine/analyze';
import { DEFAULT_SETTINGS } from '@/shared/storage';
import type { Category, Suggestion } from '@/shared/types';
import { CATEGORIES } from '@/shared/constants';
import {
  baseLanguage,
  promptLanguage,
  proofreaderSupports,
  requirePromptLanguage,
} from '@/engine/languages';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq<T>(name: string, actual: T, expected: T): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, same, same ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

/* -- Sentence splitting ---------------------------------------------------- */

{
  const text = 'Dr. Smith went home. He was tired! Was he? Yes.';
  const sentences = splitSentences(text);
  eq('splits on real terminators only', sentences.length, 4);
  eq('keeps the abbreviation attached', sentences[0]!.text, 'Dr. Smith went home.');
  for (const sentence of sentences) {
    check(
      `offsets round-trip: ${sentence.text}`,
      text.slice(sentence.start, sentence.end) === sentence.text,
    );
  }
}

{
  const text = 'First line\nSecond line\n\nThird paragraph here.';
  const sentences = splitSentences(text);
  eq('line breaks split sentences', sentences.length, 3);
  for (const sentence of sentences) {
    check('newline offsets round-trip', text.slice(sentence.start, sentence.end) === sentence.text);
  }
}

{
  const text = 'The value is 3.14 and the file is a.txt, see www.example.com/x. Done.';
  const sentences = splitSentences(text);
  eq('decimals and domains do not split', sentences.length, 2);
}

{
  const text = 'I met J. R. Tolkien. He wrote books.';
  eq('initials do not split', splitSentences(text).length, 2);
}

{
  // Every sentence must be recoverable, and no character may be double-counted.
  const text = 'One. Two! Three?  Four\nFive. Mr. Six went to the U.S. Seven.';
  const sentences = splitSentences(text);
  let previousEnd = -1;
  let monotonic = true;
  for (const sentence of sentences) {
    if (sentence.start < previousEnd) monotonic = false;
    previousEnd = sentence.end;
  }
  check('sentence ranges never overlap', monotonic);
  check('sentence ranges stay inside the text', sentences.every((s) => s.end <= text.length));
}

/* -- Chunking -------------------------------------------------------------- */

{
  const text = Array.from({ length: 40 }, (_, i) => `This is sentence number ${i}.`).join(' ');
  const sentences = splitSentences(text);
  const chunks = chunkSentences(sentences, 200);
  check('chunking covers every sentence', chunks.flat().length === sentences.length);
  check('chunks preserve order', chunks.flat().every((s, i) => s.index === i));
  check('chunks respect the size target', chunks.every((c) => c.length === 1 || c.reduce((n, s) => n + s.text.length, 0) <= 200 + 40));
}

/* -- locate ---------------------------------------------------------------- */

{
  const text = 'The quick brown fox jumps over the lazy dog.';
  eq('exact match', locate(text, 'brown fox', 0, text.length), { start: 10, end: 19 });
  eq('case-insensitive fallback', locate(text, 'Brown Fox', 0, text.length), { start: 10, end: 19 });
  eq('whitespace-tolerant fallback', locate(text, 'brown   fox', 0, text.length), { start: 10, end: 19 });
  eq('miss returns null', locate(text, 'purple fox', 0, text.length), null);
}

{
  const text = 'cat here and cat there and cat everywhere';
  const near = locate(text, 'cat', 0, text.length, 26);
  eq('ambiguous matches resolve to the hint', near, { start: 27, end: 30 });
  const windowed = locate(text, 'cat', 13, 20);
  eq('search stays inside the window', windowed, { start: 13, end: 16 });
}

/* -- Anchoring model output ------------------------------------------------ */

const allowed = new Set<Category>(CATEGORIES);

{
  const text = 'I has two apple. She dont like it.';
  const sentences = splitSentences(text);
  const issues: ModelIssue[] = [
    { sentence: 0, original: 'has', replacement: 'have', category: 'grammar', message: 'Use “have”' },
    { sentence: 0, original: 'apple', replacement: 'apples', category: 'grammar', message: 'Pluralise' },
    { sentence: 1, original: 'dont', replacement: "doesn't", category: 'spelling', message: 'Add the apostrophe' },
  ];
  const anchored = anchorIssues(issues, sentences, text, allowed, new Set());
  eq('anchors every issue', anchored.length, 3);
  for (const suggestion of anchored) {
    check(
      `anchor is exact for “${suggestion.original}”`,
      text.slice(suggestion.start, suggestion.end) === suggestion.original,
      `${suggestion.start}..${suggestion.end} = ${JSON.stringify(text.slice(suggestion.start, suggestion.end))}`,
    );
  }
  // "dont" appears only in sentence 1; anchoring must not drift to sentence 0.
  const dont = anchored.find((s) => s.original === 'dont')!;
  check('anchors inside the cited sentence', dont.start >= sentences[1]!.start);
}

{
  // A word that appears in several sentences must anchor to the cited one.
  const text = 'The report is good. The report is late.';
  const sentences = splitSentences(text);
  const anchored = anchorIssues(
    [{ sentence: 1, original: 'report', replacement: 'summary', category: 'vocabulary', message: 'Reword' }],
    sentences,
    text,
    allowed,
    new Set(),
  );
  eq('picks the cited occurrence', anchored[0]!.start, 24);
}

{
  const text = 'This sentence is completely fine.';
  const anchored = anchorIssues(
    [{ sentence: 0, original: 'nonexistent phrase', replacement: 'x', category: 'clarity', message: 'x' }],
    splitSentences(text),
    text,
    allowed,
    new Set(),
  );
  eq('hallucinated spans are dropped', anchored.length, 0);
}

{
  const text = 'I love kubernetes deployments.';
  const anchored = anchorIssues(
    [{ sentence: 0, original: 'kubernetes', replacement: 'Kubernetes', category: 'spelling', message: 'Capitalise' }],
    splitSentences(text),
    text,
    allowed,
    new Set(['kubernetes']),
  );
  eq('personal dictionary suppresses spelling flags', anchored.length, 0);
}

{
  const text = 'Disabled category test here.';
  const anchored = anchorIssues(
    [{ sentence: 0, original: 'test', replacement: 'check', category: 'vocabulary', message: 'x' }],
    splitSentences(text),
    text,
    new Set<Category>(['grammar']),
    new Set(),
  );
  eq('disabled categories are filtered out', anchored.length, 0);
}

{
  // An out-of-range sentence index must clamp rather than throw.
  const text = 'Only one sentence.';
  const anchored = anchorIssues(
    [{ sentence: 9, original: 'one', replacement: 'a single', category: 'clarity', message: 'x' }],
    splitSentences(text),
    text,
    allowed,
    new Set(),
  );
  eq('out-of-range sentence index clamps', anchored.length, 1);
}

/* -- Merging --------------------------------------------------------------- */

{
  const make = (start: number, end: number, source: Suggestion['source']): Suggestion => ({
    id: `${source}-${start}`,
    start,
    end,
    original: 'x',
    replacement: 'y',
    category: 'grammar',
    severity: 'critical',
    message: 'm',
    source,
  });
  const merged = mergeSuggestions(
    [make(0, 5, 'proofreader')],
    [make(3, 8, 'model'), make(10, 12, 'model')],
  );
  eq('overlapping model suggestions lose to the proofreader', merged.map((s) => s.id), [
    'proofreader-0',
    'model-10',
  ]);
  check('merged output is sorted', merged.every((s, i) => i === 0 || s.start >= merged[i - 1]!.start));
}

/* -- Statistics ------------------------------------------------------------ */

{
  const stats = computeStats('The cat sat on the mat. The dog ran fast.');
  eq('counts words', stats.words, 10);
  eq('counts sentences', stats.sentences, 2);
  check('reading ease is easy for simple prose', stats.readingEase > 70, String(stats.readingEase));
  check('grade level is low for simple prose', stats.gradeLevel < 6, String(stats.gradeLevel));
}

{
  check('detects passive voice', isPassive('The report was written by the committee.'));
  check('detects irregular participles', isPassive('The window was broken yesterday.'));
  check('does not flag active voice', !isPassive('The committee wrote the report.'));
}

{
  const stats = computeStats('');
  eq('empty text has zero words', stats.words, 0);
  check('empty text does not produce NaN', Object.values(stats).every((v) => Number.isFinite(v)));
}

/* -- Scoring --------------------------------------------------------------- */

{
  const text = 'The cat sat on the mat. The dog ran fast. Birds sing in trees.';
  const stats = computeStats(text);
  const clean = computeScore(stats, []);
  const messy = computeScore(
    stats,
    Array.from({ length: 4 }, (_, i) => ({
      id: `s${i}`,
      start: i,
      end: i + 1,
      original: 'x',
      replacement: 'y',
      category: 'grammar' as Category,
      severity: 'critical' as const,
      message: 'm',
      source: 'model' as const,
    })),
  );
  check('clean text scores well', clean.overall >= 85, String(clean.overall));
  check('errors lower the score', messy.overall < clean.overall, `${messy.overall} vs ${clean.overall}`);
  check('scores stay in range', [clean, messy].every((s) => Object.values(s).every((v) => v >= 0 && v <= 100)));
}

/* -- Settings defaults ----------------------------------------------------- */

{
  check('every category ships enabled', CATEGORIES.every((c) => DEFAULT_SETTINGS.categories[c]));
}

/* -- Sentence splitting at full document size ------------------------------ */

{
  // Correctness at scale, not speed: a timing assertion here passed with the
  // old quadratic lookahead too, so it guarded nothing. Measured directly, the
  // two strategies differ by ~0.01 ms on 45k characters.
  const document_ = Array.from(
    { length: 700 },
    (_, i) => `This is sentence number ${i} and it carries a little filler text.`,
  ).join(' ');
  check('test document exceeds the pass limit', document_.length > 12_000, String(document_.length));

  const sentences = splitSentences(document_);
  eq('splits every sentence', sentences.length, 700);
  check(
    'offsets still round-trip at size',
    sentences.every((s) => document_.slice(s.start, s.end) === s.text),
  );
  check(
    'no sentence range overlaps another',
    sentences.every((s, i) => i === 0 || s.start >= sentences[i - 1]!.end),
  );
}

/* -- Language gating ------------------------------------------------------- */

{
  eq('base language strips the region', baseLanguage('en-GB'), 'en');
  eq('base language lowercases', baseLanguage('PT-BR'), 'pt');
  eq('base language defaults to English', baseLanguage(undefined), 'en');

  // Chrome aborts a Proofreader request for any language but English, so this
  // gate is the difference between a skipped stage and a failed pass.
  check('proofreader accepts English', proofreaderSupports('en'));
  check('proofreader accepts regional English', proofreaderSupports('en-US'));
  check('proofreader rejects French', !proofreaderSupports('fr'));
  check('proofreader rejects Hindi', !proofreaderSupports('hi'));

  eq('prompt language keeps supported codes', promptLanguage('es-MX'), 'es');
  eq('prompt language keeps Japanese', promptLanguage('ja'), 'ja');
  // Deliberately undefined, not 'en': forcing English would make the model
  // translate the text instead of correcting it.
  eq('prompt language omits unsupported codes', promptLanguage('hi'), undefined);
  eq('prompt language omits Arabic', promptLanguage('ar'), undefined);

  // An unknown language means "assume English", which is different from an
  // explicitly unsupported one.
  eq('unknown language assumes English', promptLanguage(undefined), 'en');
  eq('requirePromptLanguage passes supported codes', requirePromptLanguage('fr-CA'), 'fr');

  let threw = '';
  try {
    requirePromptLanguage('hi');
  } catch (error) {
    threw = (error as Error).message;
  }
  check('requirePromptLanguage rejects unsupported codes', threw.includes('hi'), threw);
  check('the rejection names the supported set', threw.includes('en'), threw);
}

/* -------------------------------------------------------------------------- */

if (failures.length > 0) {
  console.error(`\n${failures.length} failed, ${passed} passed\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`✓ all ${passed} checks passed`);
