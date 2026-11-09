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

/** Why / how a navigation happened; travels with the route change. */
export interface RouteCtx {
  source: string;
  /** Keep candidates / no-match content when going home. */
  keepCenter?: boolean;
}

/** A `history.back()` that has not produced its popstate yet. The visible close has ALREADY started (the app never
 *  waits for history); this only reconciles the history entry afterwards. A page opened meanwhile is remembered
 *  (`then`) so the popstate re-pushes it instead of leaving history on home. */
let closing: { then: Route | null; timer: number } | null = null;

/** If the popstate for `history.back()` never arrives, fix the entry ourselves after this long. */
const CLOSE_TIMEOUT_MS = 600;

/** The history traversal of a close whose fallback already ran may still deliver its popstate. Each entry is the time
 *  until which that late event is recognised (afterwards it is an ordinary back/forward again). */
const late: number[] = [];
const LATE_POP_MS = 4000;
/** The newest route the user asked for (a page, or home). A late close event restores history to it. */
let intended: Route = { id: null };

/** Finish a pending close: the popstate arrived (or, `forced`, it never will). Bookkeeping only, no UI. */
function completeClosing(forced: boolean): void {
  if (!closing) return;
  const { then, timer } = closing;
  closing = null;
  window.clearTimeout(timer);
  if (forced) {
    history.replaceState(null, '', then ? formatHash(then) : '#/'); // we are still on the page's entry
    late.push(Date.now() + LATE_POP_MS); // the traversal may still complete: that popstate is bookkeeping, not navigation
  }
  else if (then) history.pushState({ aurea: true }, '', formatHash(then)); // the page is already showing
}

/** Write the route to history without firing popstate. Home -> page pushes; page -> page replaces. */
export function writeRoute(next: Route, fromHome: boolean): void {
  intended = next;
  if (closing) {
    closing.then = next;
    return;
  }
  const hash = formatHash(next);
  if (hash === location.hash || (hash === '#/' && location.hash === '')) return;
  if (fromHome) history.pushState({ aurea: true }, '', hash);
  else history.replaceState(history.state, '', hash);
}

/** Leave a page in history: step back if we pushed the entry, otherwise rewrite to home. Never shows anything:
 *  the caller starts the visible close first. Returns true when a traversal is pending. */
export function leaveToHome(): boolean {
  intended = { id: null };
  if (closing) {
    closing.then = null; // a newer close cancels the page that was meant to replace it
    return true;
  }
  if (history.state && (history.state as { aurea?: boolean }).aurea) {
    closing = { then: null, timer: window.setTimeout(() => completeClosing(true), CLOSE_TIMEOUT_MS) };
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
  window.addEventListener('popstate', () => {
    // The late traversal of an earlier close (its fallback already ran): the entries are back in sync with `intended`
    // (the latest route the user asked for); it is never applied as a new action.
    while (late.length && late[0] < Date.now()) late.shift();
    if (late.length) {
      late.shift();
      if (intended.id && location.hash !== formatHash(intended)) history.pushState({ aurea: true }, '', formatHash(intended));
      return;
    }
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
