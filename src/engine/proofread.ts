import type { Category, Suggestion } from '@/shared/types';
import { uid } from '@/shared/text';
import { assertCanDownload, isUsable } from './availability';
import { monitorFor } from './session';
import { PROOFREADER_LANGUAGES, proofreaderSupports } from './languages';

const instances = new Map<string, Promise<ProofreaderInstance>>();

/**
 * Chrome derives the correction *types* and *explanations* in a pass separate
 * from the corrections themselves, and some builds throw
 * "Model provided wrong label count" when the two do not line up. Those labels
 * are decoration for us — the offsets and replacements are the value — so the
 * first such failure drops them for the rest of the session rather than losing
 * proofreading altogether.
 */
let labelsSupported = true;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isLabelMismatch = (error: unknown) => /wrong label count/i.test(message(error));

const CATEGORY_BY_TYPE: Record<string, Category> = {
  spelling: 'spelling',
  punctuation: 'punctuation',
  capitalization: 'grammar',
  preposition: 'grammar',
  'missing-words': 'grammar',
  grammar: 'grammar',
};

async function getProofreader(language: string): Promise<ProofreaderInstance | null> {
  const api = globalThis.Proofreader;
  if (!api) return null;
  // Requesting an unsupported language does not degrade — Chrome aborts the
  // whole request — so only ever ask for one it accepts.
  if (!proofreaderSupports(language)) return null;

  // A live instance is proof of availability; re-probing costs a round-trip on
  // every keystroke-triggered pass.
  const cached = instances.get(language);
  if (cached) {
    try {
      return await cached;
    } catch {
      instances.delete(language);
    }
  }

  try {
    const availability = await api.availability({
      expectedInputLanguages: [...PROOFREADER_LANGUAGES],
    });
    if (!isUsable(availability)) return null;
    // A model that is still downloading makes create() block rather than
    // fail, which would stall every keystroke-triggered pass.
    assertCanDownload(availability, 'The proofreader');
  } catch {
    return null;
  }

  let pending = instances.get(language);
  if (!pending) {
    pending = api.create({
      expectedInputLanguages: [...PROOFREADER_LANGUAGES],
      ...(labelsSupported
        ? { includeCorrectionTypes: true, includeCorrectionExplanations: true }
        : {}),
      monitor: monitorFor('proofreader'),
    });
    instances.set(language, pending);
  }
  try {
    return await pending;
  } catch (error) {
    instances.delete(language);
    if (labelsSupported && isLabelMismatch(error)) {
      labelsSupported = false;
      return getProofreader(language);
    }
    return null;
  }
}

function describe(correction: ProofreadCorrection, original: string): string {
  const kind = correction.type ?? correction.label ?? 'grammar';
  const target = correction.correction.trim();
  if (!target) return 'Remove this';
  if (!original.trim()) return `Insert “${target}”`;
  switch (kind) {
    case 'spelling':
      return `Spelling: “${target}”`;
    case 'punctuation':
      return `Punctuation: “${target}”`;
    case 'capitalization':
      return `Capitalise as “${target}”`;
    default:
      return `Change to “${target}”`;
  }
}

/**
 * Runs Chrome's dedicated Proofreader API when it is enabled. It returns exact
 * character indices, so its results are trusted over the Prompt API's for the
 * mechanical categories it covers.
 */
export async function runProofreader(
  text: string,
  language: string,
  signal?: AbortSignal,
): Promise<Suggestion[]> {
  const proofreader = await getProofreader(language);
  if (!proofreader || signal?.aborted) return [];

  let result: ProofreadResult;
  try {
    result = await proofreader.proofread(text);
  } catch (error) {
    // Origin-trial API; treat any failure as "not available right now".
    instances.delete(language);
    if (labelsSupported && isLabelMismatch(error)) {
      labelsSupported = false;
      return runProofreader(text, language, signal);
    }
    return [];
  }
  if (signal?.aborted) return [];

  const suggestions: Suggestion[] = [];
  for (const correction of result.corrections ?? []) {
    const start = Math.max(0, Math.min(correction.startIndex, text.length));
    const end = Math.max(start, Math.min(correction.endIndex, text.length));
    const original = text.slice(start, end);
    if (original === correction.correction) continue;

    const kind = String(correction.type ?? correction.label ?? 'grammar');
    const category = CATEGORY_BY_TYPE[kind] ?? 'grammar';
    suggestions.push({
      id: uid('p'),
      start,
      end,
      original,
      replacement: correction.correction,
      category,
      severity: 'critical',
      message: describe(correction, original),
      explanation: correction.explanation,
      source: 'proofreader',
    });
  }
  return suggestions;
}
