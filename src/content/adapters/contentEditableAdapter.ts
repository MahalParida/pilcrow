import type { EditorAdapter, HighlightSpan } from './base';
import { watchViewport } from './base';
import { NS } from '@/shared/constants';

/**
 * `[contenteditable]` keeps its text in the DOM, so the CSS Custom Highlight
 * API can underline ranges without inserting any wrapper elements — which
 * matters, because injecting nodes into a rich-text editor corrupts its model.
 */

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL',
  'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL',
]);

interface Segment {
  node: Text;
  start: number;
  end: number;
}

interface TextMap {
  text: string;
  segments: Segment[];
}

function buildTextMap(root: HTMLElement): TextMap {
  const segments: Segment[] = [];
  let text = '';

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        if (element.tagName === 'BR') return NodeFilter.FILTER_ACCEPT;
        const display = getComputedStyle(element).display;
        if (display === 'none') return NodeFilter.FILTER_REJECT;
        return BLOCK_TAGS.has(element.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (element.tagName === 'BR') {
        text += '\n';
      } else if (text.length > 0 && !text.endsWith('\n')) {
        text += '\n';
      }
      continue;
    }
    const textNode = node as Text;
    const start = text.length;
    text += textNode.data;
    segments.push({ node: textNode, start, end: text.length });
  }

  return { text, segments };
}

export class ContentEditableAdapter implements EditorAdapter {
  readonly kind = 'contenteditable' as const;
  readonly element: HTMLElement;

  private map: TextMap = { text: '', segments: [] };
  private ranges = new Map<string, Range>();
  private highlightKeys = new Set<string>();
  private readonly teardown: Array<() => void> = [];

  constructor(element: HTMLElement) {
    this.element = element;
    this.refresh();
  }

  private refresh(): TextMap {
    this.map = buildTextMap(this.element);
    return this.map;
  }

  getText(): string {
    return this.refresh().text;
  }

  private locateSegment(offset: number, preferEnd: boolean): { node: Text; offset: number } | null {
    const { segments } = this.map;
    if (segments.length === 0) return null;
    for (const segment of segments) {
      if (preferEnd ? offset <= segment.end : offset < segment.end) {
        if (offset < segment.start) {
          // The offset falls in a synthetic newline: clamp to the boundary.
          return { node: segment.node, offset: 0 };
        }
        return { node: segment.node, offset: offset - segment.start };
      }
    }
    const last = segments.at(-1)!;
    return { node: last.node, offset: last.node.data.length };
  }

  private rangeFor(start: number, end: number): Range | null {
    const from = this.locateSegment(start, false);
    const to = this.locateSegment(end, true);
    if (!from || !to) return null;
    const range = document.createRange();
    try {
      range.setStart(from.node, Math.min(from.offset, from.node.data.length));
      range.setEnd(to.node, Math.min(to.offset, to.node.data.length));
    } catch {
      return null;
    }
    return range.collapsed && start !== end ? null : range;
  }

  replaceRange(start: number, end: number, text: string): void {
    this.refresh();
    const range = this.rangeFor(start, end);
    if (!range) return;

    const selection = window.getSelection();
    if (!selection) return;

    this.element.focus({ preventScroll: true });
    selection.removeAllRanges();
    selection.addRange(range);

    // execCommand keeps the page's own undo stack and change events intact,
    // which direct DOM surgery does not. Rich editors depend on both.
    const applied = text
      ? document.execCommand('insertText', false, text)
      : document.execCommand('delete');

    if (!applied) {
      range.deleteContents();
      if (text) {
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      this.element.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
      );
    }
    this.refresh();
  }

  setText(text: string): void {
    this.replaceRange(0, this.getText().length, text);
  }

  getSelection(): { start: number; end: number } | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!this.element.contains(range.commonAncestorContainer)) return null;
    this.refresh();

    const offsetOf = (node: Node, offset: number): number | null => {
      const segment = this.map.segments.find((s) => s.node === node);
      if (segment) return segment.start + offset;
      return null;
    };
    const start = offsetOf(range.startContainer, range.startOffset);
    const end = offsetOf(range.endContainer, range.endOffset);
    return start === null || end === null ? null : { start, end };
  }

  renderHighlights(spans: HighlightSpan[]): void {
    this.clearHighlights();
    if (spans.length === 0 || !('highlights' in CSS)) return;
    this.refresh();

    const byCategory = new Map<string, Range[]>();
    for (const span of spans) {
      const range = this.rangeFor(span.start, span.end);
      if (!range) continue;
      this.ranges.set(span.id, range);
      const bucket = byCategory.get(span.category) ?? [];
      bucket.push(range);
      byCategory.set(span.category, bucket);
    }

    for (const [category, ranges] of byCategory) {
      const key = `${NS}-${category}`;
      CSS.highlights.set(key, new Highlight(...ranges));
      this.highlightKeys.add(key);
    }
  }

  clearHighlights(): void {
    for (const key of this.highlightKeys) CSS.highlights.delete(key);
    this.highlightKeys.clear();
    this.ranges.clear();
  }

  rectFor(start: number, end: number): DOMRect | null {
    this.refresh();
    const range = this.rangeFor(start, end);
    const rect = range?.getBoundingClientRect();
    return rect && rect.width + rect.height > 0 ? rect : this.element.getBoundingClientRect();
  }

  hitTest(x: number, y: number): string | null {
    for (const [id, range] of this.ranges) {
      for (const rect of range.getClientRects()) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return id;
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
    const stop = watchViewport(this.element, listener);
    this.teardown.push(stop);
    return stop;
  }

  destroy(): void {
    for (const stop of this.teardown.splice(0)) stop();
    this.clearHighlights();
  }
}
