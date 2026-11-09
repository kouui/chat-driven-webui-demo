// Tiny DOM helpers (no framework).
export type Child = Node | string | number | null | undefined | false | Child[];
type AttrVal = string | number | boolean | null | undefined | ((e: Event) => void);
export type Attrs = Record<string, AttrVal>;

function applyAttrs(el: Element, attrs: Attrs | null | undefined): void {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') {
      el.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
}

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

export function $<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  // rendered = has layout boxes (works for SVG too, unlike `offsetParent`); the focused element always counts
  const rendered = (el: HTMLElement): boolean => el === document.activeElement || (!el.hidden && el.getClientRects().length > 0);
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(rendered);
}

/** Wrap Tab inside `root` (only acts when focus is already inside it). */
export function trapTab(e: KeyboardEvent, root: HTMLElement): void {
  if (e.key !== 'Tab') return;
  const items = focusables(root);
  if (!items.length) return;
  const active = document.activeElement as HTMLElement | null;
  if (!active || !root.contains(active)) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && (active === first || !items.includes(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

export function raf2(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

export const isMobile = (): boolean => window.matchMedia('(max-width: 768px)').matches;
export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
