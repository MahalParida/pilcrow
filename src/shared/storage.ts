import type { Category, Settings, Snippet } from './types';
import { CATEGORIES, DEFAULT_DEBOUNCE_MS, NS } from './constants';

const SETTINGS_KEY = `${NS}:settings`;
const DICTIONARY_KEY = `${NS}:dictionary`;
const SNIPPETS_KEY = `${NS}:snippets`;

const allCategoriesOn = () =>
  Object.fromEntries(CATEGORIES.map((c) => [c, true])) as Record<Category, boolean>;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  autoCheck: true,
  showBadge: true,
  showInlineHighlights: true,
  debounceMs: DEFAULT_DEBOUNCE_MS,
  categories: allCategoriesOn(),
  goals: {
    audience: 'general',
    formality: 'neutral',
    domain: 'general',
    intent: 'inform',
  },
  styleRules: [],
  disabledSites: [],
  checkLanguage: 'auto',
  translateTo: 'es',
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  const raw = stored[SETTINGS_KEY] as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    categories: { ...DEFAULT_SETTINGS.categories, ...(raw?.categories ?? {}) },
    goals: { ...DEFAULT_SETTINGS.goals, ...(raw?.goals ?? {}) },
    styleRules: raw?.styleRules ?? [],
    disabledSites: raw?.disabledSites ?? [],
  };
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

export function onSettingsChanged(callback: (settings: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area === 'sync' && SETTINGS_KEY in changes) void getSettings().then(callback);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/* Personal dictionary — kept in local storage, which has no per-item quota. */

export async function getDictionary(): Promise<string[]> {
  const stored = await chrome.storage.local.get(DICTIONARY_KEY);
  return (stored[DICTIONARY_KEY] as string[] | undefined) ?? [];
}

export async function addToDictionary(word: string): Promise<string[]> {
  const trimmed = word.trim();
  if (!trimmed) return getDictionary();
  const current = await getDictionary();
  if (current.some((w) => w.toLowerCase() === trimmed.toLowerCase())) return current;
  const next = [...current, trimmed].sort((a, b) => a.localeCompare(b));
  await chrome.storage.local.set({ [DICTIONARY_KEY]: next });
  return next;
}

export async function removeFromDictionary(word: string): Promise<string[]> {
  const next = (await getDictionary()).filter((w) => w !== word);
  await chrome.storage.local.set({ [DICTIONARY_KEY]: next });
  return next;
}

/* Snippets */

export async function getSnippets(): Promise<Snippet[]> {
  const stored = await chrome.storage.local.get(SNIPPETS_KEY);
  return (stored[SNIPPETS_KEY] as Snippet[] | undefined) ?? [];
}

export async function setSnippets(snippets: Snippet[]): Promise<void> {
  await chrome.storage.local.set({ [SNIPPETS_KEY]: snippets });
}

/** True when the assistant should stay silent on this page. */
export function isSiteDisabled(settings: Settings, hostname: string): boolean {
  return settings.disabledSites.some(
    (site) => hostname === site || hostname.endsWith(`.${site}`),
  );
}
