import type {
  Category,
  EditorState,
  Goals,
  Settings,
  Suggestion,
  TabMessage,
} from '@/shared/types';
import { CATEGORY_META, PRODUCT, SUPPORTED_UI_LANGUAGES } from '@/shared/constants';
import { RpcClient } from '@/shared/rpc';
import { getSettings, patchSettings } from '@/shared/storage';
import { formatDuration, readingEaseLabel } from '@/shared/stats';
import { describeCapability, isReady, needsDownload } from '@/engine/availability';
import { warmUpSummarizer, warmUpTranslator } from '@/engine/download';
import { onDownloadProgress } from '@/engine/session';

const rpc = new RpcClient();

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

let state: EditorState | null = null;
let settings: Settings;
let tabId: number | null = null;

/* Talking to the page */

async function currentTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

function send(message: TabMessage): void {
  if (tabId === null) return;
  chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
}

async function refreshState(): Promise<void> {
  tabId = await currentTabId();
  if (tabId === null) {
    state = null;
    render();
    return;
  }
  try {
    // frameId 0: every frame would otherwise answer and the first reply wins,
    // so a stray ad iframe could report "no field focused" over the real one.
    // Editors inside iframes still reach the panel through their state pushes.
    state =
      (await chrome.tabs.sendMessage(tabId, { type: 'panel:request-state' }, { frameId: 0 })) ??
      null;
  } catch {
    state = null; // No content script on this page.
  }
  render();
}

chrome.runtime.onMessage.addListener((message: { type?: string; state?: EditorState | null }, sender) => {
  if (message?.type !== 'panel:state') return;
  if (sender.tab?.id !== undefined && sender.tab.id !== tabId) return;
  state = message.state ?? null;
  render();
});

chrome.tabs.onActivated.addListener(() => void refreshState());
chrome.tabs.onUpdated.addListener((changedId, info) => {
  if (changedId === tabId && info.status === 'complete') void refreshState();
});

/* Rendering */

function scoreColor(score: number): string {
  if (score >= 85) return 'var(--good)';
  if (score >= 65) return 'var(--accent)';
  if (score >= 45) return 'var(--warn)';
  return 'var(--bad)';
}

function renderSummary(): void {
  const analysis = state?.analysis ?? null;
  const ring = $<SVGCircleElement & HTMLElement>('ring-value');
  const circumference = 2 * Math.PI * 19;

  if (analysis) {
    const value = analysis.score.overall;
    ring.style.strokeDashoffset = String(circumference * (1 - value / 100));
    ring.style.stroke = scoreColor(value);
    $('score').textContent = String(value);
  } else {
    ring.style.strokeDashoffset = String(circumference);
    $('score').textContent = '—';
  }

  $('field-label').textContent = state?.hasEditor
    ? `${state.fieldLabel} · ${state.origin}`
    : state?.mode === 'disabled'
      ? `Pilcrow is switched off on ${state.origin}`
      : usingSelection()
        ? `Selected text · ${state!.origin}`
        : state
          ? 'No text field focused'
          : 'Pilcrow is not running on this page';

  // Nothing to write back into when the source is a plain page selection.
  for (const id of ['rw-apply', 'cp-apply', 'tr-apply']) {
    ($(id) as HTMLButtonElement).disabled = !state?.hasEditor;
  }

  const tones = $('tones');
  tones.innerHTML = '';
  for (const tone of analysis?.tones ?? []) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = tone.label;
    chip.title = `${Math.round(tone.confidence * 100)}% confidence`;
    tones.appendChild(chip);
  }
}

function suggestionCard(suggestion: Suggestion): HTMLElement {
  const meta = CATEGORY_META[suggestion.category];
  const card = document.createElement('div');
  card.className = 'suggestion';
  card.tabIndex = 0;

  const top = document.createElement('div');
  top.className = 'top';
  const cat = document.createElement('span');
  cat.className = 'cat';
  cat.style.color = meta.color;
  cat.textContent = meta.label;
  top.append(cat);

  const message = document.createElement('div');
  message.className = 'msg';
  message.textContent = suggestion.message;

  const diff = document.createElement('div');
  diff.className = 'diff';
  const del = document.createElement('del');
  del.textContent = suggestion.original || '(nothing)';
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = '→';
  const ins = document.createElement('ins');
  ins.textContent = suggestion.replacement || '(remove)';
  diff.append(del, arrow, ins);

  card.append(top, message, diff);

  if (suggestion.explanation) {
    const why = document.createElement('div');
    why.className = 'why';
    why.textContent = suggestion.explanation;
    card.appendChild(why);
  }

  const acts = document.createElement('div');
  acts.className = 'acts';
  const accept = document.createElement('button');
  accept.className = 'small primary';
  accept.textContent = 'Accept';
  accept.addEventListener('click', (event) => {
    event.stopPropagation();
    send({ type: 'panel:apply', suggestionId: suggestion.id });
  });
  const ignore = document.createElement('button');
  ignore.className = 'small';
  ignore.textContent = 'Dismiss';
  ignore.addEventListener('click', (event) => {
    event.stopPropagation();
    send({ type: 'panel:ignore', suggestionId: suggestion.id });
  });
  acts.append(accept, ignore);

  if (suggestion.category === 'spelling') {
    const learn = document.createElement('button');
    learn.className = 'small';
    learn.textContent = 'Add to dictionary';
    learn.addEventListener('click', (event) => {
      event.stopPropagation();
      send({ type: 'panel:add-to-dictionary', suggestionId: suggestion.id });
    });
    acts.appendChild(learn);
  }

  card.appendChild(acts);
  card.addEventListener('click', () =>
    send({ type: 'panel:focus-suggestion', suggestionId: suggestion.id }),
  );
  return card;
}

/**
 * The placeholder shown in place of a suggestion list. Built from nodes rather
 * than markup: the language name comes from the detector, and an empty state is
 * not worth interpolating anything into extension-origin HTML for.
 */
function emptyState(mark: string, message: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  const glyph = document.createElement('span');
  glyph.className = 'mark';
  glyph.textContent = mark;
  wrap.append(glyph, document.createTextNode(message));
  return wrap;
}

function renderSuggestions(): void {
  const container = $('suggestions');
  container.innerHTML = '';
  const suggestions = state?.analysis?.suggestions ?? [];

  const count = $('count');
  count.textContent = String(suggestions.length);
  count.dataset.show = suggestions.length > 0 ? '1' : '0';

  $('busy').hidden = !state?.busy;
  ($('recheck') as HTMLButtonElement).disabled = !state?.hasEditor;
  ($('accept-all') as HTMLButtonElement).disabled = suggestions.length === 0;

  if (!state?.hasEditor) {
    const reason =
      state?.mode === 'disabled'
        ? `${PRODUCT} is switched off on this site. Turn it back on from the popup.`
        : !state
          ? `${PRODUCT} is not running on this page. Browser pages and the Web Store are off limits; on other pages, refresh after updating the extension.`
          : `Click into any text field and ${PRODUCT} will start checking it. You can also select text anywhere on the page and use the Tools tab.`;
    container.appendChild(emptyState('¶', reason));
    return;
  }
  if (suggestions.length === 0) {
    if (state.analysis?.unsupportedLanguage) {
      container.appendChild(
        emptyState(
          '¶',
          `Chrome’s on-device model does not support ${state.analysis.language} yet. ` +
            'It supports German, English, Spanish, French and Japanese.',
        ),
      );
      return;
    }
    container.appendChild(
      state.analysis
        ? emptyState('✓', 'Nothing to fix. This reads well.')
        : emptyState('¶', 'Start typing to see suggestions.'),
    );
    return;
  }

  const grouped = new Map<Category, Suggestion[]>();
  for (const suggestion of suggestions) {
    const bucket = grouped.get(suggestion.category) ?? [];
    bucket.push(suggestion);
    grouped.set(suggestion.category, bucket);
  }

  for (const [category, items] of grouped) {
    const meta = CATEGORY_META[category];
    const head = document.createElement('div');
    head.className = 'group-head';
    const dot = document.createElement('span');
    dot.className = 'chip';
    dot.style.color = meta.color;
    const inner = document.createElement('span');
    inner.className = 'dot';
    dot.append(inner, document.createTextNode(meta.label));
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = `${items.length}`;
    const applyAll = document.createElement('button');
    applyAll.className = 'ghost small';
    applyAll.textContent = 'Accept all';
    applyAll.addEventListener('click', () => send({ type: 'panel:apply-all', category }));
    head.append(dot, n, applyAll);
    container.appendChild(head);
    for (const suggestion of items) container.appendChild(suggestionCard(suggestion));
  }
}

function renderInsights(): void {
  const stats = state?.analysis?.stats;
  const statsEl = $('stats');
  const readability = $('readability');

  if (!stats) {
    statsEl.innerHTML = '<div class="empty" style="grid-column: span 2">No text yet.</div>';
    readability.innerHTML = '';
    return;
  }

  const entries: Array<[string, string]> = [
    [String(stats.words), 'words'],
    [String(stats.characters), 'characters'],
    [String(stats.sentences), 'sentences'],
    [String(stats.paragraphs), 'paragraphs'],
    [formatDuration(stats.readingSeconds), 'reading time'],
    [formatDuration(stats.speakingSeconds), 'speaking time'],
  ];
  statsEl.innerHTML = '';
  for (const [value, label] of entries) {
    const stat = document.createElement('div');
    stat.className = 'stat';
    const b = document.createElement('b');
    b.textContent = value;
    const span = document.createElement('span');
    span.textContent = label;
    stat.append(b, span);
    statsEl.appendChild(stat);
  }

  readability.innerHTML = '';
  const rows: Array<[string, string, number]> = [
    ['Reading ease', `${stats.readingEase} · ${readingEaseLabel(stats.readingEase)}`, stats.readingEase / 100],
    ['Grade level', `${stats.gradeLevel}`, Math.min(1, stats.gradeLevel / 16)],
    ['Passive voice', `${Math.round(stats.passiveRatio * 100)}% of sentences`, stats.passiveRatio],
    ['Words per sentence', `${stats.averageWordsPerSentence}`, Math.min(1, stats.averageWordsPerSentence / 30)],
  ];
  for (const [label, value, fraction] of rows) {
    const row = document.createElement('div');
    row.style.marginBottom = '8px';
    const head = document.createElement('div');
    head.className = 'row';
    const name = document.createElement('span');
    name.textContent = label;
    const val = document.createElement('span');
    val.className = 'muted mono';
    val.style.marginLeft = 'auto';
    val.textContent = value;
    head.append(name, val);
    const meter = document.createElement('div');
    meter.className = 'meter';
    const fill = document.createElement('i');
    fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    meter.appendChild(fill);
    row.append(head, meter);
    readability.appendChild(row);
  }
}

function render(): void {
  renderSummary();
  renderSuggestions();
  renderInsights();
}

/* Tools */

/** True when the tools are working on a page selection, not an editable field. */
function usingSelection(): boolean {
  return !state?.hasEditor && !!state?.selection;
}

function fieldText(): string {
  if (state?.hasEditor) return state.text;
  return state?.selection ?? '';
}

/** Declared to the model so a rewrite does not silently become a translation. */
function fieldLanguage(): string | undefined {
  return state?.analysis?.language;
}

/**
 * Where to report download progress. A tool that has to fetch a model first
 * blocks inside create() for as long as the download takes — minutes, for a
 * multi-gigabyte model — so without this the button just sits on "Working…"
 * and the panel looks broken.
 */
let toolOutput: HTMLElement | null = null;

onDownloadProgress((api, loaded) => {
  if (toolOutput) {
    toolOutput.textContent = `Downloading the ${api} model — ${Math.round(loaded * 100)}%. This happens once.`;
  }
});

async function runTool(
  button: HTMLButtonElement,
  output: HTMLElement,
  actions: HTMLElement | null,
  work: () => Promise<string>,
): Promise<string | null> {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Working…';
  output.hidden = false;
  output.textContent = '…';
  if (actions) actions.hidden = true;
  toolOutput = output;

  try {
    const result = await work();
    output.textContent = result;
    if (actions) actions.hidden = false;
    return result;
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : 'That did not work.';
    return null;
  } finally {
    toolOutput = null;
    button.disabled = false;
    button.textContent = label;
  }
}

function copyToClipboard(text: string): void {
  void navigator.clipboard.writeText(text);
}

function wireTools(): void {
  const rwOut = $('rw-out');
  const rwActions = $('rw-actions');
  let rwResult = '';

  $('rw-run').addEventListener('click', async (event) => {
    const text = fieldText();
    if (!text.trim()) {
      rwOut.hidden = false;
      rwOut.textContent = 'Focus a text field with some text first.';
      return;
    }
    const result = await runTool(event.currentTarget as HTMLButtonElement, rwOut, rwActions, () =>
      rpc
        .call('rewrite', {
          text,
          tone: ($('rw-tone') as HTMLSelectElement).value as RewriterTone,
          length: ($('rw-length') as HTMLSelectElement).value as RewriterLength,
          instruction: ($('rw-instruction') as HTMLInputElement).value.trim() || undefined,
          language: fieldLanguage(),
        })
        .then((r) => r.text),
    );
    if (result) rwResult = result;
  });
  $('rw-apply').addEventListener('click', () => send({ type: 'panel:replace-all', text: rwResult }));
  $('rw-copy').addEventListener('click', () => copyToClipboard(rwResult));

  const cpOut = $('cp-out');
  const cpActions = $('cp-actions');
  let cpResult = '';

  $('cp-run').addEventListener('click', async (event) => {
    const instruction = ($('cp-instruction') as HTMLTextAreaElement).value.trim();
    if (!instruction) {
      cpOut.hidden = false;
      cpOut.textContent = 'Describe what you want written.';
      return;
    }
    const useContext = ($('cp-context') as HTMLInputElement).checked;
    const result = await runTool(event.currentTarget as HTMLButtonElement, cpOut, cpActions, () =>
      rpc
        .call('compose', {
          instruction,
          tone: ($('cp-tone') as HTMLSelectElement).value as WriterTone,
          length: ($('cp-length') as HTMLSelectElement).value as WriterLength,
          context: useContext && fieldText().trim() ? fieldText() : undefined,
          language: fieldLanguage(),
        })
        .then((r) => r.text),
    );
    if (result) cpResult = result;
  });
  $('cp-apply').addEventListener('click', () => send({ type: 'panel:insert', text: cpResult }));
  $('cp-copy').addEventListener('click', () => copyToClipboard(cpResult));

  const smOut = $('sm-out');
  $('sm-run').addEventListener('click', async (event) => {
    const text = fieldText();
    if (!text.trim()) {
      smOut.hidden = false;
      smOut.textContent = 'Focus a text field with some text first.';
      return;
    }
    await runTool(event.currentTarget as HTMLButtonElement, smOut, null, async () => {
      // Started here, not in the engine: downloading a model needs the user
      // activation from this click, which does not survive the message hop.
      await warmUpSummarizer().catch(() => undefined);
      return (
        await rpc.call('summarize', {
          text,
          type: ($('sm-type') as HTMLSelectElement).value as SummarizerType,
          language: fieldLanguage(),
        })
      ).text;
    });
  });

  const trOut = $('tr-out');
  const trActions = $('tr-actions');
  const trTarget = $('tr-target') as HTMLSelectElement;
  let trResult = '';

  for (const language of SUPPORTED_UI_LANGUAGES) {
    const option = document.createElement('option');
    option.value = language.code;
    option.textContent = language.label;
    trTarget.appendChild(option);
  }
  // Without this the select falls back to its first option on every open, so a
  // saved target is invisible and the panel looks like it ignores the setting.
  trTarget.value = settings.translateTo;
  if (!trTarget.value) trTarget.value = 'es';
  const runTranslate = async (button: HTMLButtonElement) => {
    const text = fieldText();
    if (!text.trim()) {
      trOut.hidden = false;
      trOut.textContent = 'Focus a text field with some text first.';
      return;
    }
    const target = trTarget.value;
    const source = (state?.analysis?.language ?? 'en').split('-')[0] || 'en';

    const result = await runTool(button, trOut, trActions, async () => {
      // Same reason as above: this click is the only place with the user
      // activation Chrome demands before it will fetch a language pack.
      await warmUpTranslator(source, target).catch(() => undefined);
      return (await rpc.call('translate', { text, target, source })).text;
    });
    if (result) trResult = result;
  };

  trTarget.addEventListener('change', () => {
    void patchSettings({ translateTo: trTarget.value });
    // A result already on screen is now in the wrong language, so redo it
    // rather than leaving the card and the picker disagreeing.
    if (trResult) void runTranslate($('tr-run') as HTMLButtonElement);
  });

  $('tr-run').addEventListener('click', (event) =>
    runTranslate(event.currentTarget as HTMLButtonElement),
  );
  $('tr-apply').addEventListener('click', () => send({ type: 'panel:replace-all', text: trResult }));
  $('tr-copy').addEventListener('click', () => copyToClipboard(trResult));
}

function wireGoals(): void {
  const fields: Array<[string, keyof Goals]> = [
    ['goal-audience', 'audience'],
    ['goal-formality', 'formality'],
    ['goal-domain', 'domain'],
    ['goal-intent', 'intent'],
  ];
  for (const [id, key] of fields) {
    const select = $(id) as HTMLSelectElement;
    select.value = settings.goals[key];
    select.addEventListener('change', () => {
      settings = { ...settings, goals: { ...settings.goals, [key]: select.value } as Goals };
      void patchSettings({ goals: settings.goals }).then(() => send({ type: 'panel:recheck' }));
    });
  }
}

function wireTabs(): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) {
    tab.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.tab')) other.classList.remove('active');
      tab.classList.add('active');
      for (const panel of document.querySelectorAll<HTMLElement>('[data-panel]')) {
        panel.hidden = panel.dataset.panel !== tab.dataset.tab;
      }
    });
  }
}

/** The header chip: green once the model is loaded and answering. */
function setPrivacyChip(state: 'checking' | 'ready' | 'pending' | 'off', title: string): void {
  const chip = $('privacy');
  chip.dataset.state = state;
  chip.title = title;
}

async function checkCapabilities(): Promise<void> {
  const notice = $('notice');
  try {
    const report = await rpc.call('capabilities', undefined);
    if (isReady(report.languageModel)) {
      setPrivacyChip('ready', 'Model ready — every check runs on this device');
    } else if (needsDownload(report.languageModel)) {
      setPrivacyChip('pending', `${describeCapability(report.languageModel)} — open the popup to download it`);
    } else {
      setPrivacyChip('off', describeCapability(report.languageModel));
    }
    if (report.usable) {
      notice.hidden = true;
      return;
    }
    notice.hidden = false;
    notice.innerHTML = `<strong>The on-device model is not available.</strong> ${describeCapability(
      report.languageModel,
    )}. ${PRODUCT} needs Chrome 138+ on desktop with about 22&nbsp;GB free disk space. Open <code>chrome://on-device-internals</code> for details.`;
  } catch (error) {
    setPrivacyChip('off', 'Could not reach the background worker');
    notice.hidden = false;
    notice.textContent = error instanceof Error ? error.message : 'Could not reach the background worker.';
  }
}

async function main(): Promise<void> {
  settings = await getSettings();
  wireTabs();
  wireTools();
  wireGoals();
  $('settings').addEventListener('click', () => void chrome.runtime.openOptionsPage());
  $('recheck').addEventListener('click', () => send({ type: 'panel:recheck' }));
  $('accept-all').addEventListener('click', () => send({ type: 'panel:apply-all' }));

  await Promise.all([refreshState(), checkCapabilities()]);
}

void main();
