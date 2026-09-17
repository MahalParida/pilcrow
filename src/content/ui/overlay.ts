import type { Suggestion } from '@/shared/types';
import { CATEGORY_META, MARK, NS, PRODUCT } from '@/shared/constants';
import { OVERLAY_CSS } from './styles';

export interface OverlayHandlers {
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onAddToDictionary: (id: string) => void;
  onExplain: (id: string) => Promise<string>;
  onNavigate: (delta: number) => void;
  onBadgeClick: () => void;
}

export type BadgeState = 'idle' | 'busy' | 'issues' | 'clean' | 'error';

const GAP = 8;

/**
 * All in-page chrome lives in one shadow root so the host page cannot restyle
 * it and we cannot leak styles into the host page.
 */
export class Overlay {
  private readonly host: HTMLDivElement;
  private readonly root: ShadowRoot;
  private readonly badge: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private toastTimer = 0;
  private current: Suggestion | null = null;

  constructor(private readonly handlers: OverlayHandlers) {
    this.host = document.createElement('div');
    this.host.id = `${NS}-overlay`;
    this.host.setAttribute('data-pilcrow-ignore', '');
    this.root = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    this.root.appendChild(style);

    this.badge = document.createElement('div');
    this.badge.className = 'badge';
    this.badge.setAttribute('role', 'button');
    this.badge.setAttribute('tabindex', '0');
    this.badge.title = `${PRODUCT} — click for suggestions`;
    this.badge.addEventListener('mousedown', (e) => e.preventDefault());
    this.badge.addEventListener('click', () => this.handlers.onBadgeClick());

    this.card = document.createElement('div');
    this.card.className = 'card';
    this.card.addEventListener('mousedown', (e) => e.preventDefault());

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';

    this.root.append(this.badge, this.card, this.toastEl);
    document.documentElement.appendChild(this.host);
  }

  /* ---- Badge ------------------------------------------------------------ */

  setBadge(options: { rect: DOMRect | null; state: BadgeState; count: number; visible: boolean }): void {
    const { rect, state, count, visible } = options;
    if (!visible || !rect) {
      this.badge.style.display = 'none';
      return;
    }
    this.badge.dataset.state = state;
    this.badge.innerHTML = '';

    if (state === 'busy') {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      this.badge.appendChild(spinner);
    } else {
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = MARK;
      this.badge.appendChild(mark);
      if (count > 0) {
        const label = document.createElement('span');
        label.textContent = String(count);
        this.badge.appendChild(label);
      }
    }

    this.badge.style.display = 'inline-flex';
    const width = this.badge.offsetWidth || 26;
    const left = Math.min(rect.right - width - 6, window.innerWidth - width - GAP);
    const top = Math.min(rect.bottom - 32, window.innerHeight - 32 - GAP);
    this.badge.style.left = `${Math.max(GAP, left)}px`;
    this.badge.style.top = `${Math.max(GAP, top)}px`;
  }

  /* ---- Suggestion card -------------------------------------------------- */

  showCard(payload: { rect: DOMRect; suggestion: Suggestion; index: number; total: number }): void {
    const { suggestion, index, total, rect } = payload;
    this.current = suggestion;
    const meta = CATEGORY_META[suggestion.category];

    this.card.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'card-head';
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.color = meta.color;
    const dot = document.createElement('span');
    dot.className = 'dot';
    chip.append(dot, document.createTextNode(meta.label));
    const counter = document.createElement('span');
    counter.className = 'counter';
    counter.textContent = `${index + 1} of ${total}`;
    head.append(chip, counter);

    const message = document.createElement('div');
    message.className = 'message';
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

    const explanation = document.createElement('div');
    explanation.className = 'explanation';
    if (suggestion.explanation) explanation.textContent = suggestion.explanation;

    const actions = document.createElement('div');
    actions.className = 'actions';

    const accept = document.createElement('button');
    accept.className = 'primary';
    accept.textContent = 'Accept';
    accept.addEventListener('click', () => this.handlers.onAccept(suggestion.id));

    const dismiss = document.createElement('button');
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => this.handlers.onDismiss(suggestion.id));

    actions.append(accept, dismiss);

    if (suggestion.category === 'spelling') {
      const learn = document.createElement('button');
      learn.textContent = 'Add to dictionary';
      learn.addEventListener('click', () => this.handlers.onAddToDictionary(suggestion.id));
      actions.appendChild(learn);
    }

    if (!suggestion.explanation) {
      const why = document.createElement('button');
      why.className = 'ghost';
      why.textContent = 'Why?';
      why.addEventListener('click', () => {
        why.disabled = true;
        why.textContent = 'Thinking…';
        this.handlers
          .onExplain(suggestion.id)
          .then((text) => {
            explanation.textContent = text;
            why.remove();
          })
          .catch(() => {
            why.disabled = false;
            why.textContent = 'Why?';
            this.toast('Could not generate an explanation.');
          });
      });
      actions.appendChild(why);
    }

    const nav = document.createElement('div');
    nav.className = 'nav';
    for (const [label, delta] of [['‹', -1], ['›', 1]] as const) {
      const button = document.createElement('button');
      button.className = 'ghost';
      button.textContent = label;
      button.disabled = total < 2;
      button.addEventListener('click', () => this.handlers.onNavigate(delta));
      nav.appendChild(button);
    }
    actions.appendChild(nav);

    this.card.append(head, message, diff, explanation, actions);
    this.card.style.display = 'flex';
    this.position(rect);
  }

  private position(rect: DOMRect): void {
    const width = this.card.offsetWidth;
    const height = this.card.offsetHeight;

    let top = rect.bottom + GAP;
    if (top + height > window.innerHeight - GAP) {
      const above = rect.top - height - GAP;
      top = above >= GAP ? above : Math.max(GAP, window.innerHeight - height - GAP);
    }
    const left = Math.min(
      Math.max(GAP, rect.left),
      Math.max(GAP, window.innerWidth - width - GAP),
    );

    this.card.style.top = `${top}px`;
    this.card.style.left = `${left}px`;
  }

  /** Generic result card used by the context-menu actions. */
  showResult(payload: {
    title: string;
    body: string;
    rect: DOMRect;
    onReplace?: () => void;
  }): void {
    this.current = null;
    this.card.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'card-head';
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.color = 'var(--pl-accent)';
    const dot = document.createElement('span');
    dot.className = 'dot';
    chip.append(dot, document.createTextNode(payload.title));
    head.append(chip);

    const body = document.createElement('div');
    body.className = 'result-body';
    body.textContent = payload.body;

    const actions = document.createElement('div');
    actions.className = 'actions';

    if (payload.onReplace) {
      const replace = document.createElement('button');
      replace.className = 'primary';
      replace.textContent = 'Replace';
      replace.addEventListener('click', () => {
        payload.onReplace?.();
        this.hideCard();
      });
      actions.appendChild(replace);
    }

    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => {
      void navigator.clipboard
        .writeText(payload.body)
        .then(() => this.toast('Copied to clipboard.'))
        .catch(() => this.toast('Clipboard access was blocked.'));
    });

    // A translation or summary is often far longer than the 340px card, and
    // reading it through a scrollbar that size is miserable.
    const expand = document.createElement('button');
    expand.className = 'ghost';
    expand.textContent = 'Expand';
    expand.addEventListener('click', () => {
      const expanded = this.card.classList.toggle('expanded');
      expand.textContent = expanded ? 'Collapse' : 'Expand';
      // The card just changed size, so its anchored position is now wrong.
      this.position(payload.rect);
    });

    const close = document.createElement('button');
    close.className = 'ghost';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.hideCard());

    actions.append(copy, expand, close);
    this.card.append(head, body, actions);
    this.card.classList.remove('expanded');
    this.card.style.display = 'flex';
    this.position(payload.rect);
  }

  hideCard(): void {
    this.card.style.display = 'none';
    this.current = null;
  }

  get openSuggestionId(): string | null {
    return this.current?.id ?? null;
  }

  get isCardOpen(): boolean {
    return this.card.style.display === 'flex';
  }

  /** True when the event happened inside our own UI. */
  contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.host.contains(target);
  }

  containsPath(event: Event): boolean {
    return event.composedPath().includes(this.host);
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.style.display = 'block';
    this.toastEl.style.left = `${GAP + 4}px`;
    this.toastEl.style.bottom = `${GAP + 4}px`;
    this.toastEl.style.top = 'auto';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.style.display = 'none';
    }, 3200);
  }

  destroy(): void {
    window.clearTimeout(this.toastTimer);
    this.host.remove();
  }
}
