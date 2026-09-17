import type { CATEGORIES } from './constants';

export type Category = (typeof CATEGORIES)[number];
export type Severity = 'critical' | 'advisory';
export type SuggestionSource = 'proofreader' | 'model' | 'rule';

/** One actionable edit, anchored to a character range in the analysed text. */
export interface Suggestion {
  id: string;
  start: number;
  end: number;
  /** The exact text currently occupying [start, end). */
  original: string;
  /** What it should become. Empty string means "delete". */
  replacement: string;
  category: Category;
  severity: Severity;
  /** Short imperative headline, e.g. "Add a comma". */
  message: string;
  /** Optional longer rationale, shown on demand. */
  explanation?: string;
  source: SuggestionSource;
}

export interface ToneReading {
  label: string;
  confidence: number;
}

export interface DocStats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  sentences: number;
  paragraphs: number;
  readingSeconds: number;
  speakingSeconds: number;
  /** Flesch Reading Ease, 0–100. Higher is easier. */
  readingEase: number;
  /** Flesch–Kincaid US grade level. */
  gradeLevel: number;
  /** Share of sentences written in the passive voice, 0–1. */
  passiveRatio: number;
  uniqueWordRatio: number;
  averageWordsPerSentence: number;
}

export interface Score {
  /** 0–100 overall writing score. */
  overall: number;
  correctness: number;
  clarity: number;
  engagement: number;
  delivery: number;
}

export interface Goals {
  audience: 'general' | 'knowledgeable' | 'expert';
  formality: 'informal' | 'neutral' | 'formal';
  domain: 'general' | 'academic' | 'business' | 'technical' | 'creative' | 'casual';
  intent: 'inform' | 'describe' | 'convince' | 'tell-story';
}

export interface AnalysisResult {
  requestId: string;
  /** Hash of the text this result describes, so stale results can be dropped. */
  textHash: string;
  language: string;
  suggestions: Suggestion[];
  tones: ToneReading[];
  stats: DocStats;
  score: Score;
  /** True when only part of the text was analysed (see MAX_CHARS_PER_PASS). */
  truncated: boolean;
  /** Wall-clock time for the pass, for the diagnostics report. */
  elapsedMs: number;
  /** Per-stage milliseconds, so a slow pass can be attributed. */
  timings: { detect: number; proofread: number; model: number; tone: number };
  /** Sentences answered from cache versus sent to the model. */
  reuse: { cached: number; prompted: number };
  /** Set when Chrome's model cannot attest output for this language. */
  unsupportedLanguage: boolean;
}

export interface Settings {
  enabled: boolean;
  autoCheck: boolean;
  showBadge: boolean;
  showInlineHighlights: boolean;
  debounceMs: number;
  categories: Record<Category, boolean>;
  goals: Goals;
  /** Free-text house-style rules enforced on every check. */
  styleRules: string[];
  /** Origins where the assistant stays out of the way. */
  disabledSites: string[];
  /** Language the model should assume when checking. 'auto' detects. */
  checkLanguage: string;
  /** Default target for the translate action. */
  translateTo: string;
}

/** Outcome of trying to bring one API's model onto the device. */
export interface WarmupApiResult {
  api: string;
  label: string;
  ready: boolean;
  error?: string;
}

export interface WarmupReport {
  ok: boolean;
  detail?: string;
  apis: WarmupApiResult[];
}

export interface CapabilityReport {
  languageModel: AIAvailability | 'missing';
  proofreader: AIAvailability | 'missing';
  rewriter: AIAvailability | 'missing';
  writer: AIAvailability | 'missing';
  summarizer: AIAvailability | 'missing';
  translator: AIAvailability | 'missing';
  languageDetector: AIAvailability | 'missing';
  /** False when even the Prompt API is unusable — the extension is inert. */
  usable: boolean;
}

/* RPC contract between content script / panels and the service worker */

export interface RpcRequests {
  capabilities: { params: void; result: CapabilityReport };
  warmup: { params: { translateTarget?: string } | void; result: WarmupReport };
  analyze: {
    /** The engine host cannot read storage, so state comes with the call. */
    params: { text: string; language?: string; settings: Settings; dictionary: string[] };
    result: AnalysisResult;
  };
  rewrite: {
    params: {
      text: string;
      tone?: 'more-formal' | 'as-is' | 'more-casual';
      length?: 'shorter' | 'as-is' | 'longer';
      instruction?: string;
      context?: string;
      /** Declared to the model so it does not silently translate the text. */
      language?: string;
    };
    result: { text: string };
  };
  compose: {
    params: {
      instruction: string;
      tone?: 'formal' | 'neutral' | 'casual';
      length?: 'short' | 'medium' | 'long';
      context?: string;
      language?: string;
    };
    result: { text: string };
  };
  summarize: {
    params: { text: string; type?: SummarizerType; length?: SummarizerLength; language?: string };
    result: { text: string };
  };
  translate: {
    params: { text: string; target: string; source?: string };
    result: { text: string; source: string };
  };
  detectLanguage: {
    params: { text: string };
    result: { language: string; confidence: number };
  };
  explain: {
    params: {
      sentence: string;
      original: string;
      replacement: string;
      message: string;
      language?: string;
    };
    result: { text: string };
  };
  synonyms: {
    params: { word: string; sentence: string; language?: string };
    result: { words: string[] };
  };
}

export type RpcMethod = keyof RpcRequests;

export interface RpcCall<M extends RpcMethod = RpcMethod> {
  kind: 'call';
  id: string;
  method: M;
  params: RpcRequests[M]['params'];
}

export type RpcReply<M extends RpcMethod = RpcMethod> =
  | { kind: 'reply'; id: string; ok: true; result: RpcRequests[M]['result'] }
  | { kind: 'reply'; id: string; ok: false; error: string };

export interface RpcCancel {
  kind: 'cancel';
  id: string;
}

/** Pushed from the service worker without a matching request. */
export type RpcEvent =
  | { kind: 'event'; name: 'download-progress'; loaded: number; api: string }
  | { kind: 'event'; name: 'settings-changed' };

export type RpcInbound = RpcCall | RpcCancel;
export type RpcOutbound = RpcReply | RpcEvent;

/* Messages exchanged directly between the panels and the content script */

export type TabMessage =
  | { type: 'panel:request-state' }
  | { type: 'panel:state'; state: EditorState | null }
  | { type: 'panel:apply'; suggestionId: string }
  | { type: 'panel:apply-all'; category?: Category }
  | { type: 'panel:ignore'; suggestionId: string }
  | { type: 'panel:add-to-dictionary'; suggestionId: string }
  | { type: 'panel:replace-all'; text: string }
  | { type: 'panel:insert'; text: string }
  | { type: 'panel:recheck' }
  | { type: 'panel:focus-suggestion'; suggestionId: string }
  | { type: 'cmd:check-now' }
  | { type: 'cmd:accept-first' }
  | { type: 'ctx:action'; action: 'rewrite' | 'summarize' | 'translate' | 'check'; selection: string };

/** Snapshot of the focused editor, mirrored into the side panel. */
export interface EditorState {
  /** Lets callers tell "switched off here" apart from "script never loaded". */
  mode: 'starting' | 'active' | 'disabled';
  hasEditor: boolean;
  text: string;
  analysis: AnalysisResult | null;
  busy: boolean;
  origin: string;
  fieldLabel: string;
  /**
   * Text selected anywhere on the page, editable or not. The panel falls back
   * to this so its tools work on an article or a job posting, not just on a
   * field you can type in. Filled in by the content script, which is the only
   * place that can see the live selection.
   */
  selection: string;
}

/** A reusable text snippet expanded by typing its trigger. */
export interface Snippet {
  id: string;
  trigger: string;
  text: string;
  label: string;
}
