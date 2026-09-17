import type { DocStats, Score, Suggestion } from './types';
import { CRITICAL_CATEGORIES } from './constants';
import { clamp, countSyllables, isPassive, splitSentences, words } from './text';

const WORDS_PER_MINUTE_READING = 238;
const WORDS_PER_MINUTE_SPEAKING = 150;

export function computeStats(text: string): DocStats {
  const sentences = splitSentences(text);
  const tokens = words(text);
  const wordCount = tokens.length;
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0).length;
  const syllableCount = tokens.reduce((sum, word) => sum + countSyllables(word), 0);
  const passiveCount = sentences.filter((s) => isPassive(s.text)).length;
  const unique = new Set(tokens.map((w) => w.toLowerCase())).size;

  const wordsPerSentence = sentences.length > 0 ? wordCount / sentences.length : 0;
  const syllablesPerWord = wordCount > 0 ? syllableCount / wordCount : 0;

  const readingEase =
    wordCount > 0 && sentences.length > 0
      ? clamp(206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord, 0, 100)
      : 100;
  const gradeLevel =
    wordCount > 0 && sentences.length > 0
      ? Math.max(0, 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59)
      : 0;

  return {
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, '').length,
    words: wordCount,
    sentences: sentences.length,
    paragraphs: Math.max(paragraphs, text.trim() ? 1 : 0),
    readingSeconds: Math.round((wordCount / WORDS_PER_MINUTE_READING) * 60),
    speakingSeconds: Math.round((wordCount / WORDS_PER_MINUTE_SPEAKING) * 60),
    readingEase: Math.round(readingEase),
    gradeLevel: Math.round(gradeLevel * 10) / 10,
    passiveRatio: sentences.length > 0 ? passiveCount / sentences.length : 0,
    uniqueWordRatio: wordCount > 0 ? unique / wordCount : 1,
    averageWordsPerSentence: Math.round(wordsPerSentence * 10) / 10,
  };
}

/**
 * Turns issue density and readability into four 0–100 sub-scores. Everything is
 * normalised per 100 words so a long document is not punished for its length.
 */
export function computeScore(stats: DocStats, suggestions: Suggestion[]): Score {
  const per100 = (count: number) =>
    stats.words > 0 ? (count / stats.words) * 100 : count > 0 ? 100 : 0;

  const countIn = (predicate: (s: Suggestion) => boolean) =>
    suggestions.filter(predicate).length;

  const criticalDensity = per100(countIn((s) => CRITICAL_CATEGORIES.has(s.category)));
  const clarityDensity = per100(countIn((s) => s.category === 'clarity' || s.category === 'conciseness'));
  const vocabularyDensity = per100(countIn((s) => s.category === 'vocabulary'));
  const styleDensity = per100(countIn((s) => s.category === 'style' || s.category === 'inclusivity'));

  const correctness = clamp(100 - criticalDensity * 12, 0, 100);

  // Penalise both extremes: dense academic prose and choppy fragments.
  const sentenceLengthPenalty =
    stats.averageWordsPerSentence > 24
      ? (stats.averageWordsPerSentence - 24) * 2.5
      : stats.averageWordsPerSentence > 0 && stats.averageWordsPerSentence < 8
        ? (8 - stats.averageWordsPerSentence) * 2
        : 0;
  const clarity = clamp(
    100 - clarityDensity * 10 - sentenceLengthPenalty - Math.max(0, 40 - stats.readingEase) * 0.5,
    0,
    100,
  );

  const repetitionPenalty = stats.words >= 40 ? Math.max(0, 0.45 - stats.uniqueWordRatio) * 160 : 0;
  const engagement = clamp(
    100 - vocabularyDensity * 8 - stats.passiveRatio * 45 - repetitionPenalty,
    0,
    100,
  );

  const delivery = clamp(100 - styleDensity * 14 - per100(countIn((s) => s.category === 'punctuation')) * 6, 0, 100);

  const overall = Math.round(
    correctness * 0.4 + clarity * 0.25 + engagement * 0.2 + delivery * 0.15,
  );

  return {
    overall,
    correctness: Math.round(correctness),
    clarity: Math.round(clarity),
    engagement: Math.round(engagement),
    delivery: Math.round(delivery),
  };
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

export function readingEaseLabel(ease: number): string {
  if (ease >= 80) return 'Very easy';
  if (ease >= 60) return 'Easy';
  if (ease >= 50) return 'Fairly hard';
  if (ease >= 30) return 'Hard';
  return 'Very hard';
}
