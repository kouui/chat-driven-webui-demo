import type { DestId, NavTarget } from '../types';
import { getState } from './state';
import { leaveToHome, writeRoute } from './router';
import type { RouteCtx } from './router';
import { isMobile } from './dom';
import { captureOrigin } from './motion';
import type { Origin, OriginSrc } from './motion';

export type NavSource = 'text' | 'voice' | 'capsule' | 'wheel' | 'tutorial' | 'followup' | 'system' | 'hash';

export interface NavOpts {
  source?: NavSource;
  /** Element that should regain focus when an overlay opened by this call closes. */
  trigger?: HTMLElement | null;
  /** Keep candidates / no-match content when going home. */
  keepCenter?: boolean;
  /** The control the user touched (or a viewport point, e.g. the end of the typed text). Its geometry is captured
   *  before any DOM change; it brightens, sparks into the butterfly, and the page opens from its direction. */
  origin?: OriginSrc;
}

export interface CloseOpts {
  restoreFocus: boolean;
  /** Let the butterfly go to its next owner. false when another navigation follows. */
  settle: boolean;
  /** The overlay's visuals stay until the app calls `release()` (the page shell appears): no empty screen in between. */
  hold?: boolean;
}

export interface NavHooks {
  /** The touched control feedback (brighten + spark). Runs first, before the DOM changes. */
  touch(origin: Origin | null): void;
  showPage(id: DestId, anchor: string | undefined, source: NavSource, origin: Origin | null): void;
  showHome(ctx: RouteCtx): void;
  openWheel(trigger?: HTMLElement | null): void;
  openTutorial(trigger?: HTMLElement | null): void;
  closeWheel(o: CloseOpts): void;
  closeTutorial(o: CloseOpts): void;
  /** A navigation supersedes any running microphone demo. */
  cancelVoice(): void;
}

let hooks: NavHooks;
export function bindNav(h: NavHooks): void {
  hooks = h;
}

const NO_SETTLE: CloseOpts = { restoreFocus: false, settle: false };
const HOLD: CloseOpts = { restoreFocus: false, settle: false, hold: true };

/** The ONE entry point for going anywhere: text, capsules, wheel, tutorial, follow-ups, system intents. */
export function navigate(target: NavTarget, opts: NavOpts = {}): void {
  const source = opts.source ?? 'system';
  const origin = captureOrigin(opts.origin ?? (target.id === 'sys:wheel' || target.id === 'sys:tutorial' ? opts.trigger : null));
  hooks.cancelVoice();
  if (origin) hooks.touch(origin);
  switch (target.id) {
    case 'sys:wheel':
      hooks.openWheel(opts.trigger);
      return;
    case 'sys:tutorial':
      hooks.openTutorial(opts.trigger);
      return;
    case 'sys:home': {
      hooks.closeWheel(NO_SETTLE);
      if (isMobile()) hooks.closeTutorial(NO_SETTLE);
      const ctx: RouteCtx = { source, keepCenter: opts.keepCenter };
      const wasOpen = getState().route !== null;
      hooks.showHome(ctx); // the visible close starts at once and invalidates the old operation ...
      if (wasOpen) leaveToHome(); // ... history catches up asynchronously (never treated as a newer user action)
      return;
    }
    default: {
      hooks.closeWheel(HOLD); // the dial / sheet leaves when the page shell appears
      if (isMobile()) hooks.closeTutorial(HOLD);
      const anchor = target.anchor && target.anchor !== 'title' ? target.anchor : undefined;
      writeRoute({ id: target.id, anchor }, getState().route === null);
      hooks.showPage(target.id, anchor, source, origin);
    }
  }
}

/** Called by the router for back/forward and the initial hash. */
export function applyRoute(route: { id: DestId | null; anchor?: string }, ctx: RouteCtx): void {
  hooks.cancelVoice();
  hooks.closeWheel(NO_SETTLE);
  if (route.id) {
    if (isMobile()) hooks.closeTutorial(NO_SETTLE);
    hooks.showPage(route.id, route.anchor, ctx.source as NavSource, null);
  } else {
    hooks.showHome(ctx);
  }
}
