import type { Category } from '@/shared/types';

export interface HighlightSpan {
  id: string;
  start: number;
  end: number;
  category: Category;
}

/**
 * Uniform view over the three kinds of editable surface on the web:
 * `<input>`, `<textarea>` and `[contenteditable]`. Everything above this
 * boundary works in plain character offsets.
 */
export interface EditorAdapter {
  readonly element: HTMLElement;
  readonly kind: 'input' | 'contenteditable';

  getText(): string;
  replaceRange(start: number, end: number, text: string): void;
  setText(text: string): void;
  getSelection(): { start: number; end: number } | null;

  renderHighlights(spans: HighlightSpan[]): void;
  clearHighlights(): void;

  /** Viewport rect of a character range, for positioning the suggestion card. */
  rectFor(start: number, end: number): DOMRect | null;
  /** Suggestion id under a viewport point, or null. */
  hitTest(x: number, y: number): string | null;
  /** Where the status badge should sit. */
  anchorRect(): DOMRect;

  onChange(listener: () => void): () => void;
  onReposition(listener: () => void): () => void;
  destroy(): void;
}

export type EditorElement = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'url', 'email', 'tel', '', 'password-not-supported',
]);

/** Fields we deliberately stay out of: credentials, codes, machine input. */
function isExcluded(element: Element): boolean {
  const el = element as HTMLElement;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if (el.closest('[data-pilcrow-ignore]')) return true;

  const autocomplete = (el.getAttribute('autocomplete') ?? '').toLowerCase();
  if (/(^|\s)(off|new-password|current-password|one-time-code|cc-|username)/.test(autocomplete)) {
    return true;
  }
  const name = `${el.getAttribute('name') ?? ''} ${el.id}`.toLowerCase();
  if (/(password|otp|pin|cvv|card|token|secret|captcha)/.test(name)) return true;
  return false;
}

export function isEditable(node: EventTarget | null): node is EditorElement {
  if (!(node instanceof HTMLElement)) return false;
  if (isExcluded(node)) return false;

  if (node instanceof HTMLTextAreaElement) return !node.readOnly && !node.disabled;
  if (node instanceof HTMLInputElement) {
    if (node.readOnly || node.disabled) return false;
    return TEXT_INPUT_TYPES.has(node.type.toLowerCase());
  }
  if (node.isContentEditable) {
    // Only the outermost editable host, not every nested editable child.
    const host = node.closest('[contenteditable=""],[contenteditable="true"]');
    return host === node;
  }
  return false;
}

/** Best-effort human label for the field, shown in the side panel. */
export function describeField(element: HTMLElement): string {
  const labelled = element.getAttribute('aria-label');
  if (labelled) return labelled;

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }

  if (element.id) {
    const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const wrapping = element.closest('label')?.textContent?.trim();
  if (wrapping) return wrapping.slice(0, 60);

  const placeholder =
    element.getAttribute('placeholder') ?? element.getAttribute('data-placeholder');
  if (placeholder) return placeholder;

  return element instanceof HTMLTextAreaElement
    ? 'Text area'
    : element instanceof HTMLInputElement
      ? 'Text field'
      : 'Editor';
}

/** Shared listener plumbing for scroll/resize driven repositioning. */
export function watchViewport(element: HTMLElement, listener: () => void): () => void {
  const options = { passive: true, capture: true } as const;
  window.addEventListener('scroll', listener, options);
  window.addEventListener('resize', listener, options);

  const resizeObserver = new ResizeObserver(listener);
  resizeObserver.observe(element);

  return () => {
    window.removeEventListener('scroll', listener, options);
    window.removeEventListener('resize', listener, options);
    resizeObserver.disconnect();
  };
}
