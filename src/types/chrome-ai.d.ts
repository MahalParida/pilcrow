/**
 * Ambient declarations for Chrome's built-in AI APIs (Gemini Nano).
 *
 * These ship as bare globals on `self` from Chrome 138. Only `LanguageModel`,
 * `Summarizer`, `Translator` and `LanguageDetector` are stable; `Proofreader`,
 * `Writer` and `Rewriter` are origin-trial/flag-gated, so every declaration
 * here is `declare var ... | undefined` and must be feature-detected.
 */

/** Older Chrome builds reported `readily`; current builds use `available`. */
type AIAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available' | 'readily';

interface AIDownloadProgressEvent extends Event {
  readonly loaded: number;
  readonly total?: number;
}

interface AICreateMonitor extends EventTarget {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: AIDownloadProgressEvent) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

interface AICreateOptionsBase {
  signal?: AbortSignal;
  monitor?: (monitor: AICreateMonitor) => void;
}

/* Prompt API */

type LanguageModelRole = 'system' | 'user' | 'assistant';

interface LanguageModelMessage {
  role: LanguageModelRole;
  content: string;
  prefix?: boolean;
}

interface LanguageModelExpected {
  type: 'text' | 'image' | 'audio';
  languages?: string[];
}

interface LanguageModelCreateOptions extends AICreateOptionsBase {
  initialPrompts?: LanguageModelMessage[];
  /** Chrome requires `temperature` and `topK` to be supplied together, or not at all. */
  temperature?: number;
  topK?: number;
  expectedInputs?: LanguageModelExpected[];
  expectedOutputs?: LanguageModelExpected[];
}

interface LanguageModelPromptOptions {
  signal?: AbortSignal;
  /** JSON Schema constraining the response. The model is forced to conform. */
  responseConstraint?: object;
  /** Skips injecting the schema into the prompt (saves tokens when re-used). */
  omitResponseConstraintInput?: boolean;
}

interface LanguageModelParams {
  defaultTopK: number;
  maxTopK: number;
  defaultTemperature: number;
  maxTemperature: number;
}

interface LanguageModelSession {
  prompt(input: string | LanguageModelMessage[], options?: LanguageModelPromptOptions): Promise<string>;
  promptStreaming(input: string | LanguageModelMessage[], options?: LanguageModelPromptOptions): ReadableStream<string>;
  append(messages: LanguageModelMessage[]): Promise<void>;
  clone(options?: { signal?: AbortSignal }): Promise<LanguageModelSession>;
  destroy(): void;
  /** Current naming. */
  readonly contextUsage?: number;
  readonly contextWindow?: number;
  /** Legacy naming, still present in some builds. */
  readonly inputUsage?: number;
  readonly inputQuota?: number;
}

interface LanguageModelStatic {
  availability(options?: Partial<LanguageModelCreateOptions>): Promise<AIAvailability>;
  params(): Promise<LanguageModelParams | null>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

declare var LanguageModel: LanguageModelStatic | undefined;

/* Proofreader API */

type ProofreadCorrectionType =
  | 'spelling' | 'punctuation' | 'capitalization' | 'preposition'
  | 'missing-words' | 'grammar' | string;

interface ProofreadCorrection {
  startIndex: number;
  endIndex: number;
  correction: string;
  /** Chrome has shipped this under both names across builds. */
  type?: ProofreadCorrectionType;
  label?: ProofreadCorrectionType;
  explanation?: string;
}

interface ProofreadResult {
  correctedInput: string;
  corrections: ProofreadCorrection[];
}

interface ProofreaderCreateOptions extends AICreateOptionsBase {
  expectedInputLanguages?: string[];
  includeCorrectionTypes?: boolean;
  includeCorrectionExplanations?: boolean;
}

interface ProofreaderInstance {
  proofread(input: string): Promise<ProofreadResult>;
  destroy(): void;
}

interface ProofreaderStatic {
  availability(options?: ProofreaderCreateOptions): Promise<AIAvailability>;
  create(options?: ProofreaderCreateOptions): Promise<ProofreaderInstance>;
}

declare var Proofreader: ProofreaderStatic | undefined;

/* Writing Assistance APIs */

type RewriterTone = 'more-formal' | 'as-is' | 'more-casual';
type RewriterLength = 'shorter' | 'as-is' | 'longer';
type RewriterFormat = 'as-is' | 'markdown' | 'plain-text';

interface RewriterCreateOptions extends AICreateOptionsBase {
  tone?: RewriterTone;
  format?: RewriterFormat;
  length?: RewriterLength;
  sharedContext?: string;
  expectedInputLanguages?: string[];
  expectedContextLanguages?: string[];
  outputLanguage?: string;
}

interface RewriterInstance {
  rewrite(input: string, options?: { context?: string; signal?: AbortSignal }): Promise<string>;
  rewriteStreaming(input: string, options?: { context?: string; signal?: AbortSignal }): ReadableStream<string>;
  destroy(): void;
}

interface RewriterStatic {
  availability(options?: RewriterCreateOptions): Promise<AIAvailability>;
  create(options?: RewriterCreateOptions): Promise<RewriterInstance>;
}

declare var Rewriter: RewriterStatic | undefined;

type WriterTone = 'formal' | 'neutral' | 'casual';
type WriterLength = 'short' | 'medium' | 'long';
type WriterFormat = 'markdown' | 'plain-text';

interface WriterCreateOptions extends AICreateOptionsBase {
  tone?: WriterTone;
  format?: WriterFormat;
  length?: WriterLength;
  sharedContext?: string;
  expectedInputLanguages?: string[];
  expectedContextLanguages?: string[];
  outputLanguage?: string;
}

interface WriterInstance {
  write(input: string, options?: { context?: string; signal?: AbortSignal }): Promise<string>;
  writeStreaming(input: string, options?: { context?: string; signal?: AbortSignal }): ReadableStream<string>;
  destroy(): void;
}

interface WriterStatic {
  availability(options?: WriterCreateOptions): Promise<AIAvailability>;
  create(options?: WriterCreateOptions): Promise<WriterInstance>;
}

declare var Writer: WriterStatic | undefined;

/* Summarizer API */

type SummarizerType = 'key-points' | 'tldr' | 'teaser' | 'headline';
type SummarizerLength = 'short' | 'medium' | 'long';
type SummarizerFormat = 'markdown' | 'plain-text';

interface SummarizerCreateOptions extends AICreateOptionsBase {
  type?: SummarizerType;
  length?: SummarizerLength;
  format?: SummarizerFormat;
  sharedContext?: string;
  expectedInputLanguages?: string[];
  outputLanguage?: string;
}

interface SummarizerInstance {
  summarize(input: string, options?: { context?: string; signal?: AbortSignal }): Promise<string>;
  summarizeStreaming(input: string, options?: { context?: string; signal?: AbortSignal }): ReadableStream<string>;
  destroy(): void;
}

interface SummarizerStatic {
  availability(options?: SummarizerCreateOptions): Promise<AIAvailability>;
  create(options?: SummarizerCreateOptions): Promise<SummarizerInstance>;
}

declare var Summarizer: SummarizerStatic | undefined;

/* Translator + LanguageDetector */

interface TranslatorCreateOptions extends AICreateOptionsBase {
  sourceLanguage: string;
  targetLanguage: string;
}

interface TranslatorInstance {
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  translateStreaming(input: string, options?: { signal?: AbortSignal }): ReadableStream<string>;
  destroy(): void;
}

interface TranslatorStatic {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<AIAvailability>;
  create(options: TranslatorCreateOptions): Promise<TranslatorInstance>;
}

declare var Translator: TranslatorStatic | undefined;

interface DetectedLanguage {
  detectedLanguage: string;
  confidence: number;
}

interface LanguageDetectorInstance {
  detect(input: string, options?: { signal?: AbortSignal }): Promise<DetectedLanguage[]>;
  destroy(): void;
}

interface LanguageDetectorStatic {
  availability(options?: { expectedInputLanguages?: string[] }): Promise<AIAvailability>;
  create(options?: AICreateOptionsBase & { expectedInputLanguages?: string[] }): Promise<LanguageDetectorInstance>;
}

declare var LanguageDetector: LanguageDetectorStatic | undefined;
