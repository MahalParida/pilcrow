import { assertCanDownload, isUsable } from './availability';
import { languageExpectations } from './languages';

type ProgressListener = (api: string, loaded: number) => void;

const progressListeners = new Set<ProgressListener>();

export function onDownloadProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

/** Wires Chrome's download monitor through to any interested UI. */
export function monitorFor(api: string) {
  return (monitor: AICreateMonitor) => {
    monitor.addEventListener('downloadprogress', (event) => {
      for (const listener of progressListeners) listener(api, event.loaded);
    });
  };
}

export interface SessionSpec {
  /** Cache key; sessions with the same key share one warm base session. */
  key: string;
  system: string;
  /** 0–1, scaled onto the model's supported range. Low = deterministic. */
  creativity?: number;
  /**
   * BCP-47 code declared as input and output language. Required: Chrome cannot
   * attest to output safety without it and warns on every request. Callers
   * resolve it through `promptLanguage`/`requirePromptLanguage` first, so an
   * unsupported language is rejected before it reaches a session.
   */
  language: string;
}

const basePool = new Map<string, Promise<LanguageModelSession>>();

/** Language is part of a session's identity, so it belongs in the pool key. */
const poolKey = (spec: SessionSpec) => `${spec.key}:${spec.language}`;
let cachedParams: LanguageModelParams | null | undefined;

async function params(): Promise<LanguageModelParams | null> {
  if (cachedParams === undefined) {
    try {
      cachedParams = (await globalThis.LanguageModel?.params()) ?? null;
    } catch {
      cachedParams = null;
    }
  }
  return cachedParams;
}

async function createBase(spec: SessionSpec): Promise<LanguageModelSession> {
  const api = globalThis.LanguageModel;
  if (!api) {
    throw new Error('Chrome’s built-in Prompt API is not available in this browser.');
  }
  const availability = await api.availability(languageExpectations(spec.language));
  if (!isUsable(availability)) {
    throw new Error(
      'The on-device model is unavailable. Check chrome://on-device-internals for device requirements.',
    );
  }
  assertCanDownload(availability, 'The on-device language model');

  const options: LanguageModelCreateOptions = {
    initialPrompts: [{ role: 'system', content: spec.system }],
    monitor: monitorFor('languageModel'),
    ...languageExpectations(spec.language),
  };

  // Chrome rejects a session that sets only one of the two sampling params.
  const limits = await params();
  if (limits) {
    const creativity = spec.creativity ?? 0.15;
    options.temperature = Math.min(limits.maxTemperature, creativity * limits.maxTemperature);
    options.topK = limits.defaultTopK;
  }

  return api.create(options);
}

async function baseSession(spec: SessionSpec): Promise<LanguageModelSession> {
  const key = poolKey(spec);
  let existing = basePool.get(key);
  if (!existing) {
    existing = createBase(spec);
    basePool.set(key, existing);
  }
  try {
    return await existing;
  } catch (error) {
    basePool.delete(key);
    throw error;
  }
}

/**
 * Runs `task` against a fresh clone of a warm session, so the system prompt is
 * paid for once but no request pollutes the next one's context.
 */
export async function withSession<T>(
  spec: SessionSpec,
  task: (session: LanguageModelSession) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const base = await baseSession(spec);
  let session: LanguageModelSession;
  try {
    session = await base.clone({ signal });
  } catch {
    // A destroyed or wedged base session cannot be cloned; rebuild it once.
    basePool.delete(poolKey(spec));
    const rebuilt = await baseSession(spec);
    session = await rebuilt.clone({ signal });
  }

  try {
    return await task(session);
  } finally {
    try {
      session.destroy();
    } catch {
      // Already gone.
    }
  }
}

/** Prompts with a JSON Schema constraint and parses the guaranteed-valid reply. */
export async function promptJson<T>(
  session: LanguageModelSession,
  prompt: string,
  schema: object,
  signal?: AbortSignal,
): Promise<T> {
  const raw = await session.prompt(prompt, { responseConstraint: schema, signal });
  return parseJson<T>(raw);
}

export function parseJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Some builds wrap output in a fenced block despite the constraint.
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1]!) as T;
    const braced = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    if (braced) return JSON.parse(braced) as T;
    throw new Error('The model returned a response that could not be parsed.');
  }
}

/** Drops every cached session, e.g. after settings that change system prompts. */
export function resetSessions(): void {
  for (const [, pending] of basePool) {
    void pending.then((session) => {
      try {
        session.destroy();
      } catch {
        /* already destroyed */
      }
    }).catch(() => undefined);
  }
  basePool.clear();
}

/** Collects a streaming response into a single string. */
export async function collectStream(stream: ReadableStream<string>): Promise<string> {
  let out = '';
  for await (const chunk of stream as unknown as AsyncIterable<string>) out += chunk;
  return out;
}
