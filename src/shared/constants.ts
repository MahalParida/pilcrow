/** Single source of truth for the product name — change it here only. */
export const PRODUCT = 'Pilcrow';
export const MARK = '¶';

/** Prefix for every DOM id, class, CSS custom-highlight and storage key. */
export const NS = 'pilcrow';

export const PORT_NAME = `${NS}-rpc`;

/** Handshake asking the service worker to bring the engine host online. */
export const ENSURE_BACKEND = `${NS}:ensure-backend`;

export const OFFSCREEN_PATH = 'offscreen/index.html';

/**
 * Readiness probe for the engine host. Creating an offscreen document resolves
 * before its deferred module script runs, so existence is not readiness — only
 * a reply to this proves the listeners are registered.
 */
export const PING_ENGINE = `${NS}:ping-engine`;

/**
 * Tells the engine host to drop its warm sessions. Offscreen documents cannot
 * use `chrome.storage`, so the service worker watches for changes and relays
 * this instead.
 */
export const RESET_SESSIONS = `${NS}:reset-sessions`;

/** Categories of writing issue, ordered by how loudly they should be surfaced. */
export const CATEGORIES = [
  'spelling',
  'grammar',
  'punctuation',
  'clarity',
  'conciseness',
  'vocabulary',
  'style',
  'inclusivity',
] as const;

export const CATEGORY_META: Record<
  (typeof CATEGORIES)[number],
  { label: string; color: string; blurb: string }
> = {
  spelling: { label: 'Spelling', color: '#dc2626', blurb: 'Misspelled or mistyped words' },
  grammar: { label: 'Grammar', color: '#dc2626', blurb: 'Agreement, tense and sentence structure' },
  punctuation: { label: 'Punctuation', color: '#ea580c', blurb: 'Commas, apostrophes and end marks' },
  clarity: { label: 'Clarity', color: '#2563eb', blurb: 'Hard-to-follow or ambiguous phrasing' },
  conciseness: { label: 'Conciseness', color: '#0d9488', blurb: 'Wordiness and redundancy' },
  vocabulary: { label: 'Word choice', color: '#7c3aed', blurb: 'Stronger or more precise wording' },
  style: { label: 'Style', color: '#c026d3', blurb: 'Your house style rules' },
  inclusivity: { label: 'Inclusive language', color: '#0891b2', blurb: 'Wording that may exclude readers' },
};

/** Issues in these categories count against correctness rather than polish. */
export const CRITICAL_CATEGORIES = new Set(['spelling', 'grammar', 'punctuation']);

export const DEFAULT_DEBOUNCE_MS = 900;

/** Text below this length is not worth a model round-trip. */
export const MIN_CHARS_TO_CHECK = 12;

/** Hard ceiling on a single analysis pass, to bound latency and context use. */
export const MAX_CHARS_PER_PASS = 12_000;

/** Sentences are batched into chunks of roughly this size before prompting. */
export const CHUNK_TARGET_CHARS = 1_100;

export const SUPPORTED_UI_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'tr', label: 'Turkish' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'zh-Hant', label: 'Chinese (Traditional)' },
  { code: 'ar', label: 'Arabic' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'th', label: 'Thai' },
  { code: 'id', label: 'Indonesian' },
] as const;
