import type { AnalysisResult, Category, EditorState, Settings, Suggestion } from '@/shared/types';
import type { EditorAdapter, HighlightSpan } from './adapters/base';
import type { Overlay, BadgeState } from './ui/overlay';
import { MIN_CHARS_TO_CHECK } from '@/shared/constants';
import { hashText } from '@/shared/text';
import { addToDictionary } from '@/shared/storage';
import { describeField } from './adapters/base';
import type { RpcClient } from '@/shared/rpc';

/** Identity that survives re-analysis, so dismissals are not resurrected. */
const signature = (suggestion: Suggestion) =>
  `${suggestion.category}|${suggestion.original}|${suggestion.replacement}`;

export class EditorController {
  private suggestions: Suggestion[] = [];
  private readonly dismissed = new Set<string>();
  private analysis: AnalysisResult | null = null;
  private busy = false;
  private failed = false;
  private timer = 0;
  private inFlight: AbortController | null = null;
  private activeIndex = 0;
  private lastHash = '';
  /**
   * Set while we are the ones editing the field. Writing to an editor fires a
   * synchronous `input` event, which re-enters `handleInput()` and would wipe
   * the very suggestion list the caller is in the middle of updating.
   */
  private selfEditing = false;
  /** Reused across passes so language detection costs one round-trip, not one per check. */
  private detectedLanguage: string | null = null;
  private readonly stops: Array<() => void> = [];

  constructor(
    readonly adapter: EditorAdapter,
    private readonly overlay: Overlay,
    private readonly rpc: RpcClient,
    private settings: Settings,
    private dictionary: string[],
    private readonly onState: () => void,
  ) {
    this.stops.push(this.adapter.onChange(() => this.handleInput()));
    this.stops.push(this.adapter.onReposition(() => this.reposition()));
    this.paint();
    if (this.settings.autoCheck) this.schedule(300);
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
    this.paint();
  }

  updateDictionary(dictionary: string[]): void {
    this.dictionary = dictionary;
  }

  /** The language the last pass settled on, for tools that need to declare it. */
  get language(): string | undefined {
    return this.detectedLanguage ?? undefined;
  }

  /* ---- Scheduling ------------------------------------------------------- */

  private handleInput(): void {
    if (this.selfEditing) return; // Our own write; the caller manages state.
    // Offsets are stale the moment the text changes; drop decorations now and
    // re-derive them from the next analysis.
    this.overlay.hideCard();
    if (this.suggestions.length > 0) {
      this.suggestions = [];
      this.adapter.clearHighlights();
    }
    if (this.settings.autoCheck) this.schedule(this.settings.debounceMs);
    this.paint();
  }

  schedule(delay: number): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.run(), delay);
  }

  async run(force = false): Promise<void> {
    const text = this.adapter.getText();
    const hash = hashText(text);

    if (text.trim().length < MIN_CHARS_TO_CHECK) {
      this.suggestions = [];
      this.analysis = null;
      this.detectedLanguage = null;
      this.lastHash = hash;
      this.adapter.clearHighlights();
      this.paint();
      return;
    }
    if (!force && hash === this.lastHash && this.analysis) return;

    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;
    this.busy = true;
    this.failed = false;
    this.paint();

    try {
      const result = await this.rpc.call(
        'analyze',
        {
          text,
          language:
            this.settings.checkLanguage === 'auto'
              ? (this.detectedLanguage ?? undefined)
              : this.settings.checkLanguage,
          // The engine host has no storage access, so it is handed everything.
          settings: this.settings,
          dictionary: this.dictionary,
        },
        controller.signal,
      );
      // The field may have moved on while the model was thinking.
      if (controller.signal.aborted || hashText(this.adapter.getText()) !== hash) return;

      this.analysis = result;
      this.detectedLanguage = result.language;
      this.lastHash = hash;
      this.suggestions = result.suggestions.filter((s) => !this.dismissed.has(signature(s)));
      this.activeIndex = 0;
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') this.failed = true;
    } finally {
      if (this.inFlight === controller) {
        this.inFlight = null;
        this.busy = false;
      }
      this.paint();
    }
  }

  /* ---- Rendering -------------------------------------------------------- */

  private badgeState(): BadgeState {
    if (this.busy) return 'busy';
    if (this.failed) return 'error';
    if (this.suggestions.length > 0) return 'issues';
    return this.analysis ? 'clean' : 'idle';
  }

  /** Applies an edit without letting the resulting `input` event re-enter us. */
  private edit(start: number, end: number, replacement: string): void {
    this.selfEditing = true;
    try {
      this.adapter.replaceRange(start, end, replacement);
    } finally {
      this.selfEditing = false;
    }
  }

  private paint(): void {
    const spans: HighlightSpan[] = this.settings.showInlineHighlights
      ? this.suggestions.map(({ id, start, end, category }) => ({ id, start, end, category }))
      : [];
    this.adapter.renderHighlights(spans);

    this.overlay.setBadge({
      rect: this.adapter.anchorRect(),
      state: this.badgeState(),
      count: this.suggestions.length,
      visible: this.settings.showBadge && this.adapter.element.isConnected,
    });

    this.onState();
  }

  private reposition(): void {
    this.overlay.setBadge({
      rect: this.adapter.anchorRect(),
      state: this.badgeState(),
      count: this.suggestions.length,
      visible: this.settings.showBadge && this.adapter.element.isConnected,
    });
    const openId = this.overlay.openSuggestionId;
    if (openId) {
      const index = this.suggestions.findIndex((s) => s.id === openId);
      if (index >= 0) this.openAt(index);
      else this.overlay.hideCard();
    }
  }

  /* ---- Suggestion interaction ------------------------------------------- */

  openAt(index: number): void {
    if (this.suggestions.length === 0) {
      this.overlay.hideCard();
      return;
    }
    const wrapped = ((index % this.suggestions.length) + this.suggestions.length) % this.suggestions.length;
    this.activeIndex = wrapped;
    const suggestion = this.suggestions[wrapped]!;
    const rect = this.adapter.rectFor(suggestion.start, suggestion.end);
    if (!rect) return;
    this.overlay.showCard({
      rect,
      suggestion,
      index: wrapped,
      total: this.suggestions.length,
    });
  }

  openById(id: string): void {
    const index = this.suggestions.findIndex((s) => s.id === id);
    if (index >= 0) this.openAt(index);
  }

  navigate(delta: number): void {
    this.openAt(this.activeIndex + delta);
  }

  toggleCard(): void {
    if (this.overlay.isCardOpen) this.overlay.hideCard();
    else if (this.suggestions.length > 0) this.openAt(0);
    else this.overlay.toast(this.analysis ? 'No suggestions — this reads well.' : 'Checking…');
  }

  handleClick(x: number, y: number): boolean {
    const id = this.adapter.hitTest(x, y);
    if (!id) return false;
    this.openById(id);
    return true;
  }

  /**
   * Applies one edit and shifts the remaining offsets rather than waiting for a
   * fresh pass, so accepting a run of suggestions stays instant.
   */
  apply(id: string): void {
    const index = this.suggestions.findIndex((s) => s.id === id);
    if (index < 0) return;
    const suggestion = this.suggestions[index]!;

    const text = this.adapter.getText();
    if (text.slice(suggestion.start, suggestion.end) !== suggestion.original) {
      // The field changed underneath us; a re-check is the only safe move.
      this.overlay.toast('The text changed — rechecking.');
      this.overlay.hideCard();
      void this.run(true);
      return;
    }

    // Computed before the edit: the write re-enters this object, so reading
    // this.suggestions afterwards would read whatever the re-entry left behind.
    const delta = suggestion.replacement.length - (suggestion.end - suggestion.start);
    const remaining = this.suggestions
      .filter((s, i) => i !== index && !(s.start < suggestion.end && suggestion.start < s.end))
      .map((s) =>
        s.start >= suggestion.end ? { ...s, start: s.start + delta, end: s.end + delta } : s,
      );

    this.edit(suggestion.start, suggestion.end, suggestion.replacement);

    this.suggestions = remaining;
    this.lastHash = hashText(this.adapter.getText());
    this.adapter.renderHighlights(
      this.suggestions.map(({ id: sid, start, end, category }) => ({ id: sid, start, end, category })),
    );

    if (this.suggestions.length > 0) this.openAt(Math.min(index, this.suggestions.length - 1));
    else this.overlay.hideCard();
    this.paint();
  }

  applyAll(category?: Category): void {
    const targets = this.suggestions.filter((s) => !category || s.category === category);
    // Applying back-to-front keeps every remaining offset valid.
    for (const suggestion of [...targets].sort((a, b) => b.start - a.start)) {
      const text = this.adapter.getText();
      if (text.slice(suggestion.start, suggestion.end) !== suggestion.original) continue;
      this.edit(suggestion.start, suggestion.end, suggestion.replacement);
    }
    this.suggestions = this.suggestions.filter((s) => !targets.includes(s));
    this.overlay.hideCard();
    this.lastHash = '';
    this.paint();
    void this.run(true);
  }

  dismiss(id: string): void {
    const suggestion = this.suggestions.find((s) => s.id === id);
    if (!suggestion) return;
    this.dismissed.add(signature(suggestion));
    const index = this.suggestions.indexOf(suggestion);
    this.suggestions = this.suggestions.filter((s) => s.id !== id);
    if (this.suggestions.length > 0) this.openAt(Math.min(index, this.suggestions.length - 1));
    else this.overlay.hideCard();
    this.paint();
  }

  async learnWord(id: string): Promise<void> {
    const suggestion = this.suggestions.find((s) => s.id === id);
    if (!suggestion) return;
    const word = suggestion.original.trim();
    await addToDictionary(word);
    this.dismissed.add(signature(suggestion));
    this.suggestions = this.suggestions.filter(
      (s) => !(s.category === 'spelling' && s.original.trim().toLowerCase() === word.toLowerCase()),
    );
    this.overlay.hideCard();
    this.overlay.toast(`Added “${word}” to your dictionary.`);
    this.paint();
  }

  async explain(id: string): Promise<string> {
    const suggestion = this.suggestions.find((s) => s.id === id);
    if (!suggestion) throw new Error('Suggestion is no longer available');
    const text = this.adapter.getText();
    const from = text.lastIndexOf('.', suggestion.start) + 1;
    const to = text.indexOf('.', suggestion.end);
    const sentence = text.slice(from, to === -1 ? text.length : to + 1).trim();

    const result = await this.rpc.call('explain', {
      sentence: sentence || suggestion.original,
      original: suggestion.original,
      replacement: suggestion.replacement,
      message: suggestion.message,
      language: this.detectedLanguage ?? undefined,
    });
    suggestion.explanation = result.text;
    return result.text;
  }

  insertAtCursor(text: string): void {
    const selection = this.adapter.getSelection();
    const length = this.adapter.getText().length;
    const start = selection?.start ?? length;
    const end = selection?.end ?? length;
    this.edit(start, end, text);
    this.suggestions = [];
    this.lastHash = '';
    this.overlay.hideCard();
    this.paint();
    void this.run(true);
  }

  replaceAll(text: string): void {
    this.selfEditing = true;
    try {
      this.adapter.setText(text);
    } finally {
      this.selfEditing = false;
    }
    this.suggestions = [];
    this.lastHash = '';
    this.overlay.hideCard();
    this.paint();
    void this.run(true);
  }

  /* ---- State for the side panel ----------------------------------------- */

  getState(): EditorState {
    return {
      mode: 'active',
      hasEditor: true,
      text: this.adapter.getText(),
      analysis: this.analysis
        ? { ...this.analysis, suggestions: this.suggestions }
        : null,
      busy: this.busy,
      origin: location.hostname,
      fieldLabel: describeField(this.adapter.element),
      // Filled in by pushState(); only it can see the document selection.
      selection: '',
    };
  }

  destroy(): void {
    window.clearTimeout(this.timer);
    this.inFlight?.abort();
    for (const stop of this.stops.splice(0)) stop();
    this.adapter.destroy();
  }
}
