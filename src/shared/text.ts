export interface Sentence {
  index: number;
  start: number;
  end: number;
  text: string;
}

/** Words that end in a period without ending a sentence. */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'rev', 'hon',
  'vs', 'etc', 'eg', 'ie', 'al', 'cf', 'ca', 'circa', 'approx', 'est',
  'inc', 'ltd', 'co', 'corp', 'dept', 'univ', 'assn', 'bros',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
  'fig', 'no', 'vol', 'pp', 'ed', 'eds', 'ave', 'blvd', 'rd', 'apt', 'dept',
  'a.m', 'p.m', 'u.s', 'u.k', 'e.g', 'i.e',
]);

const TERMINATORS = new Set(['.', '!', '?', '…']);

/** Sticky: matches at a given index without slicing the remaining text. */
const NEXT_NON_SPACE = /\s*(\S)/y;
const CLOSERS = new Set(['"', "'", ')', ']', '}', '’', '”', '»']);

/**
 * Splits text into sentences while preserving exact character offsets, so a
 * model suggestion made against one sentence can be mapped back to the field.
 */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;

  const flush = (end: number) => {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(text[s]!)) s += 1;
    while (e > s && /\s/.test(text[e - 1]!)) e -= 1;
    if (e > s) out.push({ index: out.length, start: s, end: e, text: text.slice(s, e) });
    start = end;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;

    // A line break always ends a sentence: lists and chat messages rely on it.
    if (ch === '\n') {
      flush(i + 1);
      continue;
    }

    if (!TERMINATORS.has(ch)) continue;

    let j = i;
    while (j + 1 < text.length && TERMINATORS.has(text[j + 1]!)) j += 1;
    while (j + 1 < text.length && CLOSERS.has(text[j + 1]!)) j += 1;

    const next = text[j + 1];
    if (next !== undefined && !/\s/.test(next)) continue; // e.g. a decimal or URL

    if (ch === '.' && isAbbreviation(text, i)) continue;

    // "Foo. bar" is far more likely an abbreviation than a new sentence.
    NEXT_NON_SPACE.lastIndex = j + 1;
    const following = NEXT_NON_SPACE.exec(text);
    if (ch === '.' && following && /[a-z]/.test(following[1]!)) continue;

    flush(j + 1);
    i = j;
  }

  flush(text.length);
  return out;
}

function isAbbreviation(text: string, dotIndex: number): boolean {
  const before = text.slice(Math.max(0, dotIndex - 24), dotIndex);
  const token = before.match(/([\p{L}.]+)$/u)?.[1];
  if (!token) return false;
  if (/^\p{Lu}$/u.test(token)) return true; // a lone initial, "J. Smith"
  return ABBREVIATIONS.has(token.toLowerCase());
}

/** Groups sentences into prompt-sized chunks without splitting a sentence. */
export function chunkSentences(sentences: Sentence[], targetChars: number): Sentence[][] {
  const chunks: Sentence[][] = [];
  let current: Sentence[] = [];
  let size = 0;
  for (const sentence of sentences) {
    if (current.length > 0 && size + sentence.text.length > targetChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(sentence);
    size += sentence.text.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Finds `needle` inside `haystack[from, to)`. The model is asked to quote the
 * original verbatim, but it sometimes normalises whitespace or case, so this
 * degrades through progressively looser matches before giving up.
 */
export function locate(
  haystack: string,
  needle: string,
  from: number,
  to: number,
  hint = from,
): { start: number; end: number } | null {
  if (!needle) return null;
  const window = haystack.slice(from, to);

  const pickClosest = (positions: number[], length: number) => {
    if (positions.length === 0) return null;
    let best = positions[0]!;
    for (const p of positions) {
      if (Math.abs(from + p - hint) < Math.abs(from + best - hint)) best = p;
    }
    return { start: from + best, end: from + best + length };
  };

  const allIndexes = (haystackText: string, term: string) => {
    const found: number[] = [];
    let at = haystackText.indexOf(term);
    while (at !== -1) {
      found.push(at);
      at = haystackText.indexOf(term, at + 1);
    }
    return found;
  };

  const exact = pickClosest(allIndexes(window, needle), needle.length);
  if (exact) return exact;

  const lowerHit = pickClosest(
    allIndexes(window.toLowerCase(), needle.toLowerCase()),
    needle.length,
  );
  if (lowerHit) return lowerHit;

  // Last resort: treat runs of whitespace as interchangeable.
  const pattern = needle
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join('\\s+');
  if (!pattern) return null;
  const loose = new RegExp(pattern, 'i');
  const match = loose.exec(window);
  if (match) return { start: from + match.index, end: from + match.index + match[0].length };

  return null;
}

const IRREGULAR_PARTICIPLES = new Set([
  'begun', 'blown', 'broken', 'brought', 'built', 'bought', 'caught', 'chosen',
  'come', 'done', 'drawn', 'driven', 'eaten', 'fallen', 'felt', 'flown',
  'forgotten', 'found', 'given', 'gone', 'grown', 'heard', 'held', 'hidden',
  'kept', 'known', 'laid', 'led', 'left', 'lost', 'made', 'meant', 'met',
  'paid', 'put', 'read', 'run', 'said', 'seen', 'sent', 'set', 'shown', 'sold',
  'spoken', 'spent', 'stolen', 'taken', 'taught', 'told', 'thrown',
  'understood', 'won', 'worn', 'written',
]);

const BE_VERBS = /\b(am|is|are|was|were|be|been|being|get|gets|got|gotten)\b/i;

/** Crude but conventional passive-voice detector: a be-verb plus a participle. */
export function isPassive(sentence: string): boolean {
  const words = sentence.split(/\s+/);
  for (let i = 0; i < words.length - 1; i += 1) {
    if (!BE_VERBS.test(words[i]!)) continue;
    for (let j = i + 1; j <= Math.min(i + 3, words.length - 1); j += 1) {
      const candidate = words[j]!.toLowerCase().replace(/[^a-z]/g, '');
      if (!candidate) continue;
      if (IRREGULAR_PARTICIPLES.has(candidate)) return true;
      if (/(?:ed|en)$/.test(candidate) && candidate.length > 3) return true;
      if (!/ly$/.test(candidate)) break; // adverbs may sit between; anything else ends it
    }
  }
  return false;
}

export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w
    .replace(/(?:[^laeiouy]es|[^laeiouy]e)$/, '')
    .replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export const words = (text: string): string[] => text.match(/[\p{L}\p{N}'’-]+/gu) ?? [];

export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

let uidCounter = 0;
export const uid = (prefix = 's') => `${prefix}${(uidCounter += 1).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
