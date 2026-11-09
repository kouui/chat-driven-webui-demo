import type { DestId, PerchOpts } from '../types';
import { destinations } from '../data/destinations';
import { renderPage } from '../pages';
import { l, t } from '../i18n';
import { h, clear, isMobile } from './dom';
import { getState, setState } from './state';
import { navigate } from './navigate';
import { announce } from './announce';
import { anim, centerOf, dist, feedback, ms, prefersReducedMotion, REDUCED_MS } from './motion';
import type { Anim, Pt } from './motion';

/** What `prepare()` found, so the choreography can pick the right transition. */
export interface Prepared {
  /** The card frame was already on screen (page -> page): only the content changes. */
  shellShown: boolean;
  /** The content was already readable and was not replaced (same page, another anchor). */
  contentShown: boolean;
  sameRoute: boolean;
}

export interface PageCard {
  /** Render the page invisible and inert, reset/scroll to the anchor instantly, measure. No animation. */
  prepare(id: DestId, anchor: string | undefined): Prepared;
  /** The frame appears: a clip-path circle grows from `at` (the landing point), with a <=12px nudge from `from`
   *  (the trigger) and a gold rim glow. `fade`: a plain cross-fade (reduced motion, deep links). */
  revealShell(o: { at: Pt | null; from: Pt | null; fade?: boolean }): void;
  /** The content fades in (8px rise, or a +-24px slide when `dir` is given). Resolves when it is fully visible.
   *  `early`: only the visual fade starts (shortly before the landing); the content stays inert and does not count as
   *  visible until `unlockContent()` (the landing). */
  revealContent(o?: { dir?: number; early?: boolean }): Promise<void>;
  /** The landing happened: early content becomes interactive and counts as visible. */
  unlockContent(): void;
  /** Follow-up capsules fade in (no pulse). */
  revealFollowups(): void;
  /** Title focus + screen-reader announcement (once per navigation). */
  arrive(): void;
  /** Snap everything to its final visible state (a newer, unrelated action took over a half-revealed page). */
  finalize(): void;
  /** Close: content fades (120ms), then the frame shrinks toward `toward`. `hidden` is set only afterwards. */
  hide(toward?: Pt | null): Promise<void>;
  /** A short confirmation pulse on the current anchor (same page, same anchor). Bound to the operation `op`. */
  confirm(op?: number): void;
  /** page -> page: the old content (kept dimmed since the action) fades out completely (100ms). Resolves when it is
   *  gone (at once without a ghost). Idempotent. */
  exitGhost(dir?: number): Promise<void>;
  /** An outgoing ghost is still on screen. */
  hasGhost(): boolean;
  /** Re-derive which parts are inert (the follow-ups also step back while the voice nest is up). */
  refreshInert(): void;
  /** The frame is on screen (or about to be) and no outgoing content is still showing: the pads may show. */
  padsVisible(): boolean;
  /** The scrollport of the page body. */
  readonly scroller: HTMLElement;
  /** Re-render in the current language; keeps the scroll position and every reveal state. */
  rerender(): void;
  isOpen(): boolean;
  /** Where the butterfly belongs: the current anchor (or the title) and how to perch on it. */
  target(anchor?: string): { el: HTMLElement; opts: PerchOpts } | null;
  /** Frame and content fully visible (nothing left to reveal). */
  visible(): boolean;
  /** Scroll the anchor into view (only when a navigation asked for it). */
  reveal(el: HTMLElement): void;
}

const EASE_OUT = 'cubic-bezier(0.2, 0.7, 0.25, 1)';
/** The outgoing page's ghost fades out this fast (completely), before the new content starts. */
export const GHOST_OUT_MS = 100;
// Page choreography times in DESIGN ms; every use goes through ms() (src/app/motion.ts).
const FADE_MS = 160; // ghost dim, content rise, shell cross-fade
const SHELL_REVEAL_MS = 360; // the frame opens (clip-path circle)
const RIM_MS = 640; // gold rim that follows the opening
const SLIDE_IN_MS = 220; // page -> page: the new content slides in
const CLOSE_FADE_MS = 120; // close: content + follow-ups fade
const CLOSE_SHRINK_MS = 280; // close: the frame shrinks toward the ring
const CONFIRM_MS = 600; // same-page confirmation pulse (card.css .bf-confirm)

export function createPageCard(opts: { look?: (el: HTMLElement | null) => void } = {}): PageCard {
  const wrap = document.getElementById('page-wrap') as HTMLElement;
  const card = document.getElementById('page-card') as HTMLElement;
  const scroll = document.getElementById('page-scroll') as HTMLElement;
  const body = document.getElementById('page-body') as HTMLElement;
  const followups = document.getElementById('followups') as HTMLElement;
  const rim = document.getElementById('page-rim') as HTMLElement | null;
  const home = document.getElementById('home') as HTMLElement;

  const anchorEl = (): HTMLElement | null => {
    const { anchor } = getState();
    const byAnchor = anchor && anchor !== 'title' ? body.querySelector<HTMLElement>(`[data-perch="${anchor}"]`) : null;
    return byAnchor ?? body.querySelector<HTMLElement>('[data-perch="title"]');
  };

  function renderFollowups(id: DestId): void {
    const dest = destinations.find((d) => d.id === id)!;
    clear(followups);
    followups.setAttribute('aria-label', t('page.followups'));
    followups.append(
      h('span', { class: 'followups-label', 'aria-hidden': 'true' }, t('page.followups')),
      ...dest.followUps.map((c) => {
        const btn = h('button', { type: 'button', class: 'capsule capsule-follow', onclick: (e: Event) => navigate(c.target, { source: 'followup', origin: e.currentTarget as HTMLElement }) }, l(c.text));
        // hover / focus: the app turns the butterfly toward it after 450ms (never a timed flight)
        for (const ev of ['pointerenter', 'focus']) btn.addEventListener(ev, () => opts.look?.(btn));
        for (const ev of ['pointerleave', 'blur']) btn.addEventListener(ev, () => opts.look?.(null));
        return btn;
      }),
    );
  }

  const focusTitle = (): void => body.querySelector<HTMLElement>('[data-perch="title"]')?.focus({ preventScroll: true });

  function fill(id: DestId): void {
    clear(body);
    body.append(renderPage(id));
    renderFollowups(id);
  }

  /** Inert follows visibility: nothing invisible can be tabbed to; the close button works as soon as the frame shows. */
  function syncInert(): void {
    const set = (el: HTMLElement, on: boolean): void => {
      if (on) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    };
    set(wrap, wrap.dataset.shell === '0' || wrap.dataset.exit === '1');
    set(scroll, wrap.dataset.content === '0' || wrap.dataset.early === '1');
    set(followups, wrap.dataset.fu === '0' || document.body.classList.contains('voice-nest'));
  }

  function unlock(): void {
    if (wrap.dataset.early !== '1') return;
    delete wrap.dataset.early;
    syncInert();
  }

  /** Bring an anchor into view. Untouched when it is already fully readable (a half-clipped title looks broken);
   *  otherwise the anchor goes just below the title band, so the title is either fully visible or fully gone. */
  function bringIntoView(el: HTMLElement): void {
    if (el.dataset.perch === 'title') return;
    const r = el.getBoundingClientRect();
    const w = scroll.getBoundingClientRect();
    if (w.height > 0 && r.top >= w.top + 56 && r.bottom <= w.bottom - 16) return; // the card's close button owns the top 56px
    const title = body.querySelector<HTMLElement>('[data-perch="title"]');
    if (!title || w.height <= 0) {
      el.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
      return;
    }
    const top = scroll.scrollTop;
    const anchorTop = r.top - w.top + top; // content coordinates
    const titleBottom = title.getBoundingClientRect().bottom - w.top + top;
    let s = Math.max(0, anchorTop - (Math.max(56, titleBottom) + 16)); // the anchor starts where the title band ends
    if (s > 0 && s < titleBottom + 4) s = titleBottom + 8; // never a half-clipped title
    s = Math.min(s, Math.max(0, scroll.scrollHeight - scroll.clientHeight) || s);
    scroll.scrollTop = s;
  }
  function scrollToAnchor(): void {
    const el = anchorEl();
    if (el) bringIntoView(el);
  }

  // ---- exit bookkeeping: the exit has its own token (a newer action elsewhere must not cancel it; only a new show() does)
  let exitSeq = 0;
  let exitAnims: Anim[] = [];
  const clearGhosts = (): void => {
    ghost = null;
    ghostExit = null;
    card.querySelectorAll('.card-ghost').forEach((g) => g.remove());
  };

  function cancelExit(): void {
    exitSeq++;
    exitAnims.forEach((a) => a.cancel());
    exitAnims = [];
    delete wrap.dataset.exit;
  }

  /** The outgoing content of a page -> page change stays (dimmed) until the butterfly approaches: the frame is never empty. */
  let ghost: HTMLElement | null = null;
  let ghostExit: Promise<void> | null = null;
  function makeGhost(): void {
    clearGhosts();
    const g = scroll.cloneNode(true) as HTMLElement;
    g.removeAttribute('id');
    g.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
    g.classList.add('card-ghost');
    g.setAttribute('aria-hidden', 'true');
    g.setAttribute('inert', '');
    const top = scroll.scrollTop;
    card.append(g);
    g.scrollTop = top;
    ghost = g;
    anim(g, [{ opacity: 1 }, { opacity: 0.4 }], { duration: prefersReducedMotion() ? REDUCED_MS : ms(FADE_MS), easing: 'ease-out', fill: 'forwards', own: true });
  }

  return {
    prepare(id, anchor) {
      const st = getState();
      const exiting = wrap.dataset.exit === '1';
      cancelExit();
      const shellShown = !wrap.hidden && !exiting && st.route !== null && wrap.dataset.shell === '1';
      const sameRoute = st.route === id;
      const keepContent = shellShown && sameRoute; // another anchor on the same page: nothing is replaced
      const contentShown = keepContent && wrap.dataset.content === '1';
      if (shellShown && !keepContent && wrap.dataset.content === '1') makeGhost();
      setState({ route: id, anchor: anchor ?? 'title', lastVisited: id, tutorialLeads: false, pointCapsules: false });
      home.setAttribute('inert', ''); // the home view fades only when the shell appears (`revealShell`)
      wrap.hidden = false;
      card.setAttribute('aria-labelledby', 'page-title');
      if (!shellShown) {
        clearGhosts();
        wrap.dataset.shell = '0';
      }
      if (!keepContent) {
        wrap.dataset.content = '0';
        wrap.dataset.fu = '0';
        delete wrap.dataset.early;
      }
      if (!keepContent) {
        fill(id);
        scroll.scrollTop = 0;
      }
      syncInert();
      scrollToAnchor(); // instant, while invisible: the butterfly aims at the final layout
      void card.offsetWidth; // measure now
      return { shellShown, contentShown, sameRoute };
    },

    revealShell({ at, from, fade }) {
      document.body.classList.add('has-page'); // the home view fades out now, under the opening shell
      wrap.dataset.shell = '1';
      syncInert();
      const cr = card.getBoundingClientRect();
      if (fade || prefersReducedMotion() || cr.width === 0) {
        anim(card, [{ opacity: 0 }, { opacity: 1 }], { duration: prefersReducedMotion() ? REDUCED_MS : ms(FADE_MS), easing: 'linear' });
        return;
      }
      const p = at ?? centerOf(cr);
      const x = p.x - cr.left;
      const y = p.y - cr.top;
      const R = Math.ceil(Math.max(Math.hypot(x, y), Math.hypot(cr.width - x, y), Math.hypot(x, cr.height - y), Math.hypot(cr.width - x, cr.height - y)));
      // a nudge of at most 12px from the side the trigger is on
      let dx = 0;
      let dy = 8;
      if (from) {
        const c = centerOf(cr);
        const d = dist(c, from);
        if (d > 1) {
          dx = ((from.x - c.x) / d) * 12;
          dy = ((from.y - c.y) / d) * 12;
        }
      }
      anim(
        card,
        [
          { clipPath: `circle(0px at ${x}px ${y}px)`, transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)` },
          { clipPath: `circle(${R}px at ${x}px ${y}px)`, transform: 'translate(0px, 0px)' },
        ],
        { duration: ms(SHELL_REVEAL_MS), easing: EASE_OUT },
      );
      if (rim) anim(rim, [{ opacity: 0.95 }, { opacity: 0 }], { duration: ms(RIM_MS), easing: 'ease-out' });
    },

    revealContent(o = {}) {
      wrap.dataset.content = '1';
      if (o.early) wrap.dataset.early = '1';
      else delete wrap.dataset.early;
      syncInert();
      const reduced = prefersReducedMotion();
      let kf: Keyframe[];
      let duration: number;
      if (reduced) {
        kf = [{ opacity: 0 }, { opacity: 1 }];
        duration = REDUCED_MS;
      } else if (o.dir) {
        kf = [{ opacity: 0, transform: `translateX(${24 * o.dir}px)` }, { opacity: 1, transform: 'translateX(0)' }];
        duration = ms(SLIDE_IN_MS);
      } else {
        kf = [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }];
        duration = ms(FADE_MS);
      }
      return anim(scroll, kf, { duration, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)' }).finished.then(() => {});
    },

    unlockContent: unlock,

    revealFollowups() {
      wrap.dataset.fu = '1';
      syncInert();
    },

    arrive() {
      const route = getState().route;
      if (!route) return;
      unlock();
      // A docked tutorial (desktop) keeps keyboard focus on its step list.
      if (!(getState().overlay === 'tutorial' && !isMobile())) focusTitle();
      const dest = destinations.find((d) => d.id === route)!;
      announce(t('announce.opened', { x: l(dest.title) }));
    },

    exitGhost(dir = 1) {
      const g = ghost;
      if (!g) return Promise.resolve();
      if (ghostExit) return ghostExit;
      const reduced = prefersReducedMotion();
      // The old text is completely gone before the new text becomes visible (no overprint).
      const a = anim(g, reduced ? [{ opacity: 0.4 }, { opacity: 0 }] : [{ opacity: 0.4, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-16 * dir}px)` }], {
        duration: ms(GHOST_OUT_MS),
        easing: 'ease-in',
        fill: 'forwards',
        own: true,
      });
      ghostExit = a.finished.then(() => {
        g.remove();
        if (ghost === g) {
          ghost = null;
          ghostExit = null;
        }
      });
      return ghostExit;
    },
    hasGhost: () => ghost !== null,
    refreshInert: syncInert,

    padsVisible: () => !wrap.hidden && wrap.dataset.exit !== '1' && wrap.dataset.shell === '1' && ghost === null,
    scroller: scroll,

    finalize() {
      if (wrap.hidden || getState().route === null) return;
      clearGhosts();
      document.body.classList.add('has-page');
      wrap.dataset.shell = '1';
      wrap.dataset.content = '1';
      wrap.dataset.fu = '1';
      delete wrap.dataset.early;
      syncInert();
    },

    async hide(toward) {
      setState({ route: null, anchor: 'title' });
      home.removeAttribute('inert');
      document.body.classList.remove('has-page');
      if (wrap.hidden) return;
      cancelExit();
      const token = exitSeq;
      const live = (): boolean => token === exitSeq;
      const done = (): void => {
        exitAnims.forEach((a) => a.cancel());
        exitAnims = [];
        clearGhosts();
        wrap.hidden = true;
        delete wrap.dataset.exit;
      };
      if (wrap.dataset.shell !== '1') {
        done(); // never became visible: nothing to animate
        return;
      }
      wrap.dataset.exit = '1';
      syncInert();
      const hold = (el: Element, kf: Keyframe[], duration: number, easing: string): Anim => {
        const a = anim(el, kf, { duration, easing, fill: 'forwards', own: true });
        exitAnims.push(a);
        return a;
      };
      if (prefersReducedMotion()) {
        await hold(card, [{ opacity: 1 }, { opacity: 0 }], REDUCED_MS, 'linear').finished;
      } else {
        hold(followups, [{ opacity: 1 }, { opacity: 0 }], ms(CLOSE_FADE_MS), 'linear');
        await hold(scroll, [{ opacity: 1 }, { opacity: 0 }], ms(CLOSE_FADE_MS), 'linear').finished;
        if (!live()) return;
        const cr = card.getBoundingClientRect();
        const c = toward ?? centerOf(cr);
        const x = c.x - cr.left;
        const y = c.y - cr.top;
        const R = Math.ceil(Math.max(Math.hypot(x, y), Math.hypot(cr.width - x, y), Math.hypot(x, cr.height - y), Math.hypot(cr.width - x, cr.height - y)));
        await hold(card, [{ clipPath: `circle(${R}px at ${x}px ${y}px)` }, { clipPath: `circle(0px at ${x}px ${y}px)` }], ms(CLOSE_SHRINK_MS), 'cubic-bezier(0.5, 0, 0.8, 0.4)').finished;
      }
      if (!live()) return;
      done();
    },

    confirm(op) {
      const el = anchorEl();
      if (el) feedback(el, 'bf-confirm', ms(CONFIRM_MS), op); // its own class: it never fights the guide's pulse
    },

    rerender() {
      const { route } = getState();
      if (!route) return;
      const focusInside = body.contains(document.activeElement);
      const top = scroll.scrollTop;
      fill(route);
      syncInert(); // the new follow-ups keep the old reveal state
      scroll.scrollTop = top;
      if (focusInside) focusTitle();
    },

    isOpen: () => getState().route !== null,
    visible: () => !wrap.hidden && wrap.dataset.exit !== '1' && wrap.dataset.shell === '1' && wrap.dataset.content === '1' && wrap.dataset.early !== '1' && getState().route !== null,

    target(anchor) {
      const el = anchor ? body.querySelector<HTMLElement>(`[data-perch="${anchor}"]`) : anchorEl();
      // The title and anchors perch inside their own top-left corner (the CSS leaves a gutter there),
      // clamped to the card's scrollport, so the butterfly never lands on the close button or a neighbour.
      return el ? { el, opts: { side: 'inside-top-left', within: scroll } } : null;
    },

    reveal: (el) => bringIntoView(el),
  };
}
