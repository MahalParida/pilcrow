import type { EditorAdapter, HighlightSpan } from './base';
import { watchViewport } from './base';
import { NS } from '@/shared/constants';

/**
 * `<input>` and `<textarea>` do not expose their text to the DOM, so the
 * Custom Highlight API cannot reach it. This adapter renders a pixel-aligned
 * mirror of the field on top of it, with transparent text and visible
 * underlines, which is how every inline writing assistant does this.
 */

const COPIED_STYLES = [
  'direction', 'textAlign', 'textIndent', 'textTransform',
  'letterSpacing', 'wordSpacing', 'lineHeight', 'tabSize', 'fontFamily',
  'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'wordBreak', 'overflowWrap',
] as const;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;',
  );

export class InputAdapter implements EditorAdapter {
  readonly kind = 'input' as const;
  readonly element: HTMLInputElement | HTMLTextAreaElement;

  private mirror: HTMLDivElement | null = null;
  private inner: HTMLDivElement | null = null;
  private readonly teardown: Array<() => void> = [];

  constructor(element: HTMLInputElement | HTMLTextAreaElement) {
    this.element = element;
    const sync = () => this.position();
    this.element.addEventListener('scroll', sync, { passive: true });
    this.teardown.push(() => this.element.removeEventListener('scroll', sync));
  }

  getText(): string {
    return this.element.value;
  }

  setText(text: string): void {
    this.writeValue(text, text.length);
  }

  replaceRange(start: number, end: number, text: string): void {
    const value = this.element.value;
    if (start < 0 || end > value.length || start > end) return;
    this.writeValue(value.slice(0, start) + text + value.slice(end), start + text.length);
  }

  /**
   * Writes through the native value setter so frameworks that patch `value`
   * (React in particular) still observe the change.
   */
  private writeValue(next: string, caret: number): void {
    const prototype =
      this.element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (setter) setter.call(this.element, next);
    else this.element.value = next;

    try {
      this.element.setSelectionRange(caret, caret);
    } catch {
      // Some input types reject selection APIs.
    }
    // `input` only. `change` means "the user finished editing" and sites hang
    // form submission and autosave off it — firing it here would commit on
    // every accepted suggestion. React needs the native setter plus `input`.
    this.element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  getSelection(): { start: number; end: number } | null {
    const { selectionStart, selectionEnd } = this.element;
    if (selectionStart === null || selectionEnd === null) return null;
    return { start: selectionStart, end: selectionEnd };
  }

  private ensureMirror(): HTMLDivElement {
    if (this.mirror) return this.mirror;
    const mirror = document.createElement('div');
    mirror.className = `${NS}-mirror`;
    const inner = document.createElement('div');
    inner.className = `${NS}-mirror-inner`;
    mirror.appendChild(inner);
    // documentElement, not body: a `transform` or `filter` on body makes it the
    // containing block for position:fixed, which would offset the underlines
    // from the field they belong to.
    document.documentElement.appendChild(mirror);
    this.mirror = mirror;
    this.inner = inner;
    return mirror;
  }

  renderHighlights(spans: HighlightSpan[]): void {
    if (spans.length === 0) {
      this.clearHighlights();
      return;
    }
    const mirror = this.ensureMirror();
    const inner = this.inner!;

    const text = this.element.value;
    const ordered = [...spans].sort((a, b) => a.start - b.start);
    let cursor = 0;
    let html = '';
    for (const span of ordered) {
      const start = Math.max(cursor, Math.min(span.start, text.length));
      const end = Math.max(start, Math.min(span.end, text.length));
      if (start >= end) continue;
      html += escapeHtml(text.slice(cursor, start));
      // The category and id are constrained upstream — the model pass drops any
      // category outside the enabled set, and ids are locally generated. They
      // are escaped anyway: this string becomes page HTML, so its safety should
      // not rest on an invariant held three modules away.
      html += `<span class="${NS}-hl ${NS}-hl-${escapeHtml(span.category)}" data-id="${escapeHtml(
        span.id,
      )}">${escapeHtml(text.slice(start, end))}</span>`;
      cursor = end;
    }
    html += escapeHtml(text.slice(cursor));
    // A trailing newline is not laid out unless something follows it.
    inner.innerHTML = `${html}​`;

    mirror.style.display = 'block';
    this.position();
  }

  clearHighlights(): void {
    if (this.inner) this.inner.innerHTML = '';
    if (this.mirror) this.mirror.style.display = 'none';
  }

  /** Re-aligns the mirror with the field's box, styles and scroll offset. */
  private position(): void {
    const mirror = this.mirror;
    if (!mirror || mirror.style.display === 'none') return;
    if (!this.element.isConnected) {
      mirror.style.display = 'none';
      return;
    }

    const computed = getComputedStyle(this.element);
    const rect = this.element.getBoundingClientRect();

    for (const property of COPIED_STYLES) {
      mirror.style[property] = computed[property];
    }
    mirror.style.boxSizing = 'border-box';
    mirror.style.width = `${rect.width}px`;
    mirror.style.height = `${rect.height}px`;
    mirror.style.top = `${rect.top}px`;
    mirror.style.left = `${rect.left}px`;
    mirror.style.whiteSpace =
      this.element instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre';
    mirror.style.borderColor = 'transparent';
    mirror.style.borderStyle = 'solid';

    if (this.inner) {
      this.inner.style.transform = `translate(${-this.element.scrollLeft}px, ${-this.element.scrollTop}px)`;
    }
  }

  private rangeWithin(start: number, end: number): Range | null {
    const inner = this.inner;
    if (!inner) return null;
    const walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let offset = 0;
    let startSet = false;

    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const length = node.data.length;
      if (!startSet && start <= offset + length) {
        range.setStart(node, Math.max(0, start - offset));
        startSet = true;
      }
      if (startSet && end <= offset + length) {
        range.setEnd(node, Math.max(0, end - offset));
        return range;
      }
      offset += length;
    }
    return startSet ? range : null;
  }

  rectFor(start: number, end: number): DOMRect | null {
    if (!this.mirror || this.mirror.style.display === 'none') {
      // Nothing rendered yet: fall back to the field itself.
      return this.element.isConnected ? this.element.getBoundingClientRect() : null;
    }
    this.position();
    const range = this.rangeWithin(start, end);
    const rect = range?.getBoundingClientRect();
    return rect && rect.width + rect.height > 0 ? rect : this.element.getBoundingClientRect();
  }

  hitTest(x: number, y: number): string | null {
    if (!this.inner) return null;
    for (const mark of this.inner.querySelectorAll<HTMLElement>(`.${NS}-hl`)) {
      for (const rect of mark.getClientRects()) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return mark.dataset.id ?? null;
        }
      }
    }
    return null;
  }

  anchorRect(): DOMRect {
    return this.element.getBoundingClientRect();
  }

  onChange(listener: () => void): () => void {
    this.element.addEventListener('input', listener);
    return () => this.element.removeEventListener('input', listener);
  }

  onReposition(listener: () => void): () => void {
    const handler = () => {
      this.position();
      listener();
    };
    const stop = watchViewport(this.element, handler);
    this.teardown.push(stop);
    return stop;
  }

  destroy(): void {
    for (const stop of this.teardown.splice(0)) stop();
    this.mirror?.remove();
    this.mirror = null;
    this.inner = null;
  }
}
