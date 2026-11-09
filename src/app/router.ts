import type { DestId } from '../types';
import { destinations } from '../data/destinations';

export interface Route {
  id: DestId | null; // null = home
  anchor?: string;
}

const IDS = new Set<string>(destinations.map((d) => d.id));

export function parseHash(hash: string = location.hash): { route: Route; valid: boolean } {
  const raw = hash.replace(/^#\/?/, '');
  if (raw === '') return { route: { id: null }, valid: hash === '' || hash === '#/' || hash === '#' };
  const [path, query = ''] = raw.split('?');
  const id = path.replace(/\/$/, '');
  if (!IDS.has(id)) return { route: { id: null }, valid: false };
  const a = new URLSearchParams(query).get('a') ?? undefined;
  const dest = destinations.find((d) => d.id === id)!;
  const anchor = a && (a === 'title' || dest.anchors.includes(a)) ? a : undefined;
  return { route: { id: id as DestId, anchor }, valid: true };
}

export function formatHash(r: Route): string {
  if (!r.id) return '#/';
  return `#/${r.id}${r.anchor && r.anchor !== 'title' ? `?a=${encodeURIComponent(r.anchor)}` : ''}`;
}

/** Why / how a navigation happened; travels with the (possibly asynchronous) route change. */
export interface RouteCtx {
  source: string;
  /** Keep candidates / no-match content when going home. */
  keepCenter?: boolean;
  /** An overlay (wheel / tutorial) was opened while the close was pending: it is the newer action and
   *  must survive the home view, keep its butterfly lead and keep keyboard focus. */
  keepOverlay?: boolean;
}

/** A `history.back()` that has not produced its popstate yet. "The latest action wins": close requests
 *  coalesce into it, a page opened meanwhile is remembered (`then`) so the popstate re-pushes it instead
 *  of showing home, and an overlay opened meanwhile (`keepOverlay`) is not closed by the home view. */
let closing: { ctx: RouteCtx; then: Route | null; keepOverlay: boolean; timer: number } | null = null;

/** If the popstate for `history.back()` never arrives, apply it ourselves after this long. */
const CLOSE_TIMEOUT_MS = 600;

let applyHome: (r: Route, ctx: RouteCtx) => void = () => {};

/** Finish a pending close: the popstate arrived (or, `forced`, it never will). */
function completeClosing(forced: boolean): void {
  if (!closing) return;
  const { ctx, then, keepOverlay, timer } = closing;
  closing = null;
  window.clearTimeout(timer);
  if (forced) history.replaceState(null, '', then ? formatHash(then) : '#/'); // we are still on the page's entry
  else if (then) history.pushState({ aurea: true }, '', formatHash(then)); // the page is already showing
  if (!then) applyHome({ id: null }, keepOverlay ? { ...ctx, keepOverlay: true } : ctx);
}

/** A wheel / tutorial was opened: it is newer than a pending close, so the close must not undo it. */
export function noteOverlayOpened(): void {
  if (closing) closing.keepOverlay = true;
}

/** Write the route to history without firing popstate. Home -> page pushes; page -> page replaces. */
export function writeRoute(next: Route, fromHome: boolean): void {
  if (closing) {
    closing.then = next;
    return;
  }
  const hash = formatHash(next);
  if (hash === location.hash || (hash === '#/' && location.hash === '')) return;
  if (fromHome) history.pushState({ aurea: true }, '', hash);
  else history.replaceState(history.state, '', hash);
}

/** Leave a page: step back if we pushed the entry, otherwise rewrite to home. Returns true when the
 *  home view will be shown asynchronously by the popstate handler. */
export function leaveToHome(ctx: RouteCtx): boolean {
  if (closing) {
    closing.ctx = ctx; // a newer close replaces the older one, and cancels the page / overlay it was keeping
    closing.then = null;
    closing.keepOverlay = false;
    return true;
  }
  if (history.state && (history.state as { aurea?: boolean }).aurea) {
    closing = { ctx, then: null, keepOverlay: false, timer: window.setTimeout(() => completeClosing(true), CLOSE_TIMEOUT_MS) };
    history.back();
    return true;
  }
  history.replaceState(null, '', '#/');
  return false;
}

export function initRouter(onRoute: (r: Route, ctx: RouteCtx) => void): Route {
  const first = parseHash();
  // A reload keeps history.state; we can no longer trust that the previous entry is ours.
  history.replaceState(null, '', first.valid ? location.hash || '#/' : '#/');
  applyHome = onRoute;
  window.addEventListener('popstate', () => {
    if (closing) {
      completeClosing(false);
      return;
    }
    const p = parseHash();
    if (!p.valid) history.replaceState(null, '', '#/');
    onRoute(p.route, { source: 'hash' });
  });
  return first.route;
}
