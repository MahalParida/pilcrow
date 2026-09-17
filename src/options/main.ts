import type { CapabilityReport, Category, Settings, Snippet } from '@/shared/types';
import { CATEGORIES, CATEGORY_META, SUPPORTED_UI_LANGUAGES } from '@/shared/constants';
import { RpcClient } from '@/shared/rpc';
import {
  DEFAULT_SETTINGS,
  addToDictionary,
  getDictionary,
  getSettings,
  getSnippets,
  patchSettings,
  removeFromDictionary,
  setSnippets,
} from '@/shared/storage';
import { describeCapability, isReady, isUsable } from '@/engine/availability';
import { warmUpAll } from '@/engine/download';
import { onDownloadProgress } from '@/engine/session';
import { uid } from '@/shared/text';
import { formatReport, runDiagnostics } from './diagnostics';

const rpc = new RpcClient();

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let settings: Settings;

/* Model status */

const CAP_LABELS: Array<[keyof CapabilityReport, string]> = [
  ['languageModel', 'Prompt API'],
  ['proofreader', 'Proofreader'],
  ['rewriter', 'Rewriter'],
  ['writer', 'Writer'],
  ['summarizer', 'Summarizer'],
  ['translator', 'Translator'],
  ['languageDetector', 'Language detector'],
];

async function renderCapabilities(): Promise<void> {
  const container = $('capabilities');
  try {
    const report = await rpc.call('capabilities', undefined);
    container.innerHTML = '';
    for (const [key, label] of CAP_LABELS) {
      const state = report[key] as AIAvailability | 'missing';
      const row = document.createElement('div');
      row.className = 'cap';
      const led = document.createElement('span');
      led.className = 'led';
      led.dataset.ok = isReady(state) ? '1' : isUsable(state) ? '0' : '-1';
      const name = document.createElement('b');
      name.textContent = label;
      const status = document.createElement('span');
      status.className = 'state';
      status.textContent = describeCapability(state);
      row.append(led, name, status);
      container.appendChild(row);
    }
  } catch (error) {
    container.textContent =
      error instanceof Error ? error.message : 'Could not reach the background worker.';
  }
}

function wireDiagnostics(): void {
  const run = $('diag-run') as HTMLButtonElement;
  const copy = $('diag-copy') as HTMLButtonElement;
  const status = $('diag-status');
  const output = $('diag-out');
  let report = '';

  run.addEventListener('click', async () => {
    run.disabled = true;
    run.textContent = 'Running…';
    status.textContent = '';
    output.hidden = false;
    output.textContent = 'Checking every layer — the model calls can take a while…';
    try {
      const checks = await runDiagnostics(rpc, settings);
      report = formatReport(checks);
      output.textContent = report;
      copy.hidden = false;
      const failures = checks.filter((check) => check.status === 'fail').length;
      status.textContent =
        failures === 0 ? 'Everything passed.' : `${failures} check(s) failed.`;
    } catch (error) {
      output.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      run.disabled = false;
      run.textContent = 'Run diagnostics';
    }
  });

  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(report).then(() => {
      status.textContent = 'Report copied.';
    });
  });
}

/**
 * Downloads must be started from a page handling a real click: Chrome requires
 * transient user activation, and activation is not carried across a
 * `chrome.runtime` message, so the offscreen engine can never do this itself.
 */
function wireDownload(): void {
  const button = $('download-all') as HTMLButtonElement;
  const status = $('download-status');
  const errors = $('download-errors');

  onDownloadProgress((api, loaded) => {
    status.textContent = `Downloading ${api}: ${Math.round(loaded * 100)}%`;
  });

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Downloading…';
    status.textContent = 'This can take several minutes the first time.';
    errors.hidden = true;
    try {
      const report = await warmUpAll(settings.translateTo);
      // The status grid above is the single record of what is on the device, so
      // it is refreshed rather than duplicated; only what went wrong is listed.
      await renderCapabilities();
      const failed = report.apis.filter((entry) => !entry.ready);
      errors.innerHTML = '';
      for (const entry of failed) {
        const row = document.createElement('div');
        const name = document.createElement('b');
        name.textContent = entry.label;
        row.append(name, ` — ${entry.error ?? 'Download failed'}`);
        errors.appendChild(row);
      }
      if (report.detail) {
        const note = document.createElement('div');
        note.textContent = report.detail;
        errors.appendChild(note);
      }
      errors.hidden = errors.childElementCount === 0;
      status.textContent = !report.ok
        ? 'The core model could not be downloaded.'
        : failed.length === 0
          ? 'All models are ready.'
          : `Ready, except ${failed.length} optional model(s).`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Download failed.';
    } finally {
      button.disabled = false;
      button.textContent = 'Download models';
    }
  });
}

/* General settings */

function wireGeneral(): void {
  const toggles: Array<keyof Settings> = [
    'enabled',
    'autoCheck',
    'showBadge',
    'showInlineHighlights',
  ];
  for (const key of toggles) {
    const input = $(key) as HTMLInputElement;
    input.checked = Boolean(settings[key]);
    input.addEventListener('change', () => {
      void patchSettings({ [key]: input.checked } as Partial<Settings>);
    });
  }

  const debounce = $('debounceMs') as HTMLInputElement;
  const debounceValue = $('debounce-value');
  debounce.value = String(settings.debounceMs);
  debounceValue.textContent = `${(settings.debounceMs / 1000).toFixed(1)}s`;
  debounce.addEventListener('input', () => {
    debounceValue.textContent = `${(Number(debounce.value) / 1000).toFixed(1)}s`;
  });
  debounce.addEventListener('change', () => {
    void patchSettings({ debounceMs: Number(debounce.value) });
  });

  const language = $('checkLanguage') as HTMLSelectElement;
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = 'Detect automatically';
  language.appendChild(auto);
  for (const entry of SUPPORTED_UI_LANGUAGES) {
    const option = document.createElement('option');
    option.value = entry.code;
    option.textContent = entry.label;
    language.appendChild(option);
  }
  language.value = settings.checkLanguage;
  language.addEventListener('change', () => {
    void patchSettings({ checkLanguage: language.value });
  });

  const translateTo = $('translateTo') as HTMLSelectElement;
  for (const entry of SUPPORTED_UI_LANGUAGES) {
    const option = document.createElement('option');
    option.value = entry.code;
    option.textContent = entry.label;
    translateTo.appendChild(option);
  }
  translateTo.value = settings.translateTo;
  translateTo.addEventListener('change', () => {
    void patchSettings({ translateTo: translateTo.value });
  });
}

function wireCategories(): void {
  const container = $('categories');
  container.innerHTML = '';
  for (const category of CATEGORIES) {
    const meta = CATEGORY_META[category];
    const row = document.createElement('label');
    row.className = 'cat-row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = settings.categories[category] !== false;
    input.addEventListener('change', () => {
      settings = {
        ...settings,
        categories: { ...settings.categories, [category]: input.checked } as Record<Category, boolean>,
      };
      void patchSettings({ categories: settings.categories });
    });

    const text = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = meta.label;
    name.style.color = meta.color;
    const blurb = document.createElement('small');
    blurb.textContent = meta.blurb;
    text.append(name, blurb);

    row.append(input, text);
    container.appendChild(row);
  }
}

function wireStyleRules(): void {
  const textarea = $('styleRules') as HTMLTextAreaElement;
  textarea.value = settings.styleRules.join('\n');
  $('save-rules').addEventListener('click', () => {
    const rules = textarea.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    settings = { ...settings, styleRules: rules };
    void patchSettings({ styleRules: rules }).then(() => {
      const saved = $('rules-saved');
      saved.hidden = false;
      window.setTimeout(() => {
        saved.hidden = true;
      }, 1600);
    });
  });
}

/* Lists: dictionary, snippets, disabled sites */

function renderTags(
  container: HTMLElement,
  values: string[],
  onRemove: (value: string) => void,
  emptyText: string,
): void {
  container.innerHTML = '';
  if (values.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.style.fontSize = '12px';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  for (const value of values) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.append(document.createTextNode(value));
    const remove = document.createElement('button');
    remove.textContent = '×';
    remove.title = `Remove ${value}`;
    remove.addEventListener('click', () => onRemove(value));
    tag.appendChild(remove);
    container.appendChild(tag);
  }
}

async function wireDictionary(): Promise<void> {
  const container = $('dictionary');
  const input = $('dict-input') as HTMLInputElement;

  const refresh = async () => {
    const words = await getDictionary();
    renderTags(
      container,
      words,
      (word) => void removeFromDictionary(word).then(refresh),
      'No words yet. Anything you add here is never flagged as a misspelling.',
    );
  };

  const add = async () => {
    const word = input.value.trim();
    if (!word) return;
    input.value = '';
    await addToDictionary(word);
    await refresh();
  };

  $('dict-add').addEventListener('click', () => void add());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void add();
  });
  await refresh();
}

async function wireSnippets(): Promise<void> {
  const container = $('snippets');
  const trigger = $('snip-trigger') as HTMLInputElement;
  const text = $('snip-text') as HTMLInputElement;

  const refresh = async () => {
    const snippets = await getSnippets();
    container.innerHTML = '';
    if (snippets.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'muted';
      empty.style.fontSize = '12px';
      empty.textContent = 'No snippets yet.';
      container.appendChild(empty);
      return;
    }
    for (const snippet of snippets) {
      const row = document.createElement('div');
      row.className = 'snippet';
      const code = document.createElement('code');
      code.textContent = snippet.trigger;
      const preview = document.createElement('span');
      preview.textContent = snippet.text;
      const remove = document.createElement('button');
      remove.className = 'small';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        void getSnippets()
          .then((all) => setSnippets(all.filter((s) => s.id !== snippet.id)))
          .then(refresh);
      });
      row.append(code, preview, remove);
      container.appendChild(row);
    }
  };

  const add = async () => {
    const triggerValue = trigger.value.trim();
    const textValue = text.value;
    if (!triggerValue || !textValue.trim()) return;
    const snippet: Snippet = {
      id: uid('sn'),
      trigger: triggerValue,
      text: textValue,
      label: triggerValue,
    };
    const all = await getSnippets();
    await setSnippets([...all.filter((s) => s.trigger !== triggerValue), snippet]);
    trigger.value = '';
    text.value = '';
    await refresh();
  };

  $('snip-add').addEventListener('click', () => void add());
  text.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void add();
  });
  await refresh();
}

function wireSites(): void {
  const container = $('sites');
  const input = $('site-input') as HTMLInputElement;

  const refresh = () => {
    renderTags(
      container,
      settings.disabledSites,
      (site) => {
        settings = {
          ...settings,
          disabledSites: settings.disabledSites.filter((s) => s !== site),
        };
        void patchSettings({ disabledSites: settings.disabledSites }).then(refresh);
      },
      'Pilcrow runs everywhere.',
    );
  };

  const add = () => {
    const raw = input.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!raw || settings.disabledSites.includes(raw)) return;
    input.value = '';
    settings = { ...settings, disabledSites: [...settings.disabledSites, raw] };
    void patchSettings({ disabledSites: settings.disabledSites }).then(refresh);
  };

  $('site-add').addEventListener('click', add);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') add();
  });
  refresh();
}

async function main(): Promise<void> {
  settings = await getSettings();

  if (new URLSearchParams(location.search).get('welcome') === '1') {
    $('welcome').hidden = false;
    $('welcome-dismiss').addEventListener('click', () => {
      $('welcome').hidden = true;
    });
  }

  wireGeneral();
  wireDiagnostics();
  wireDownload();
  wireCategories();
  wireStyleRules();
  wireSites();

  $('reset').addEventListener('click', () => {
    void patchSettings(DEFAULT_SETTINGS).then(() => location.reload());
  });

  await Promise.all([renderCapabilities(), wireDictionary(), wireSnippets()]);
}

void main();
