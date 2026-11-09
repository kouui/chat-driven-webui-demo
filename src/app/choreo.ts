// Choreography: the butterfly leads, the UI follows (docs/tasks/002-motion/spec.md).
//
// Every user action begins an operation (`beginOp`): older flights, reveals, pulses, underlines, hints and
// feedback classes are cancelled and their callbacks do nothing (`guide.cancel()` is bound to the token in app.ts).
// The page appears in the order request -> butterfly -> answer:
//   prepare (invisible, inert, measured)  ->  shell at `onApproach` (<=300ms before landing)  ->  content at landing
//   (`reveal`)  ->  pulse.
// The outgoing UI (home, wheel, tutorial sheet, the previous page's content) stays until the shell appears, so the
// screen is never empty. UI timing comes from the flight's callbacks and promises. The only timers are relative to
// those events (follow-ups at landing + 300ms, the post-landing hop) or watchdogs that run only if a callback never
// arrives.

import { perchPoint } from '../butterfly';
import type { Butterfly, DestId, MatchCandidate } from '../types';
import type { CancellableGuide } from '../butterfly';
import { destinations } from '../data/destinations';
import { butterflyOwner, getState } from './state';
import type { Center } from './center';
import { GHOST_OUT_MS } from './pagecard';
import type { PageCard } from './pagecard';
import { after, bind, beginOp, centerOf, claim, designMs, dist, feedback, frames, isCurrent, ms, prefersReducedMotion, REDUCED_MS, release } from './motion';
import type { Origin, Pt } from './motion';
import type { NavSource } from './navigate';

export interface ChoreoDeps {
  butterfly: Butterfly;
  /** `cancel` is optional so tests can pass a bare Guide. */
  guide: Partial<Pick<CancellableGuide, 'cancel'>> & Pick<CancellableGuide, 'focus' | 'release'>;
  page: PageCard;
  center: Center;
  input: HTMLInputElement;
  /** The element that gets a brief glow when the typed text is sent. */
  pill: HTMLElement;
  /** Home ring: the page shrinks toward its centre when it closes. */
  ring: HTMLElement;
  /** The Wheel button pulses once and the butterfly turns its head toward it (`turnToward(wheel button)`; after a no-match landing). */
  pulseWheel(op: number): void;
  /** Bring the butterfly to its owner (state-derived). */
  settle(o?: { pulse?: boolean }): void;
  /** Nobody is typing any more (leaves 'listening'; never flies). */
  rest?(): void;
  /** The wheel / tutorial sheet that was left with `hold` finishes leaving now (the shell appears). */
  releaseOverlays?(): void;
  /** Landing pads: re-derive the set / light one by key. */
  syncPads?(): void;
  lightPad?(key: string, state: 'dim' | 'near' | 'lit'): void;
}

export interface Choreo {
  /** The touched control brightens and sparks into the butterfly. Synchronous: it runs inside the click. */
  touch(origin: Origin | null): void;
  /** Typed text was sent: the command bar glows once. */
  inputSent(): void;
  /** Open a page (any entry: capsule, query, wheel, tutorial, follow-up, deep link). */
  page(id: DestId, anchor: string | undefined, source: NavSource, origin: Origin | null): void;
  /** A close started (the route changed). `keep`: the close belongs to the running sequence (candidates / no match). */
  closePage(keep: boolean): Promise<void>;
  /** Ambiguous query: a sweep over the row where the candidates appear, then the prompt. */
  candidates(items: MatchCandidate[], origin: Origin | null): void;
  /** No match: a small confused detour, tilt, the prompt, then the suggestions and the Wheel pulse. */
  noMatch(origin: Origin | null): void;
  /** Wheel / tutorial opens: older sequences end. */
  overlayOpened(): void;
  /** Microphone demo started. */
  voiceStart(): void;
  /** Microphone demo ended (submitted or cancelled). */
  voiceEnd(): void;
  /** The voice nest (a measurable element above the input while a page / overlay is open), or null when there is none. */
  nestAnchor(): HTMLElement | null;
  /** A new home visit begins (arming the hesitation hint once more). */
  homeVisit(): void;
  /** Hesitation hint at home (j). */
  hint(): void;
  /** The user did something while a hint was running: it ends at once. */
  cancelHint(): void;
}

// Every time in this file is DESIGN ms (tempo 1). Timers go through ms(); numbers handed to the butterfly
// (minDuration, maxDuration) stay design ms because the butterfly applies the tempo itself.
const POST_LAND_HOP_MS = 1200;
/** The touched control / sent input glows this long (`.is-sent`). */
const SENT_MS = 420;
/** The hesitation hint's border breath (`.is-hint`, chatbar.css). */
const HINT_PILL_MS = 1800;
/** The voice nest anchor outlives the demo this long. */
const NEST_LINGER_MS = 800;
/** A carried flight (page -> page nearby, hint arc) lasts at least this long. */
const CARRY_MIN_MS = 420;
/** Follow-up capsules appear this long after the landing. */
const FOLLOWUPS_MS = 300;
const WATCHDOG_MS = 1800;
/** The post-landing hop is capped by the butterfly itself (PerchOpts.maxDuration). */
const HOP_MAX_MS = 420;
/** Hesitation hint: the butterfly turns to the input, then makes a 24px arc toward it. */
const HINT_ARC_PX = 24;
const HINT_TURN_MS = 350;
/** After a no-match landing the butterfly looks at the Wheel button this long. */
const WHEEL_GLANCE_MS = 1200;
/** The ambiguous sweep (all waypoints) must finish within this budget; the last leg is forced at SWEEP_FORCE_MS. */
const SWEEP_BUDGET_MS = 1300;
const SWEEP_FORCE_MS = 820;
/** The whole sweep, including the final leg, lasts at most this long; the final leg's maxDuration is what remains. */
const SWEEP_TOTAL_MS = 1400;
const SWEEP_MIN_LEG_MS = 300;
/** BF's flight duration (A4) and the approach lead, to estimate a multi-leg sweep. */
const estDur = (L: number): number => Math.min(850, Math.max(380, 260 + 0.7 * L));
const APPROACH_LEAD = 300;
/** The content starts to fade in this long before the landing (timer relative to `onApproach`): it is readable as the
 *  butterfly settles. 0 = strictly at the landing. */
const CONTENT_LEAD_MS = 80;
/** The frame appears this long after `onApproach` (page from home): it stays empty only briefly (<=300ms incl. the fade). */
const SHELL_DELAY_MS = 80;
/** The old page's ghost is gone (100ms fade) this long before the new content starts. */
const GHOST_GAP_MS = 20;
/** Within this distance of the anchor's perch point the butterfly counts as sitting on it. */
const AT_ANCHOR_PX = 40;
/** Within this distance of the ring centre the butterfly counts as being home. */
const HOME_NEAR_PX = 24;

export function createChoreo(deps: ChoreoDeps): Choreo {
  const { butterfly, guide, page, center, input, pill, ring } = deps;
  let hinted = false;
  let hintOp = 0;
  let voiceOp = 0;

  const destIndex = (id: DestId | null): number => destinations.findIndex((d) => d.id === id);

  /** Flashes (touched control, sent input) start before the operation they belong to begins (navigate.ts touches first):
   *  they wait here and are bound to the next operation, so a LATER action clears them. */
  let pendingFlashes: Array<() => void> = [];
  const flash = (clear: () => void, op?: number): void => {
    if (op !== undefined) bind(op, clear);
    else pendingFlashes.push(clear);
  };

  /** A new action begins. `other`: it is not a page open/close, so a half-revealed page is completed first. */
  function begin(kind: 'page' | 'close' | 'other'): number {
    const op = beginOp();
    if (kind === 'other') page.finalize();
    const mine = pendingFlashes;
    pendingFlashes = [];
    mine.forEach((clear) => bind(op, clear));
    return op;
  }

  // ---- (R1) the touched control -------------------------------------------------------------------
  function touch(origin: Origin | null, op?: number): void {
    if (!origin) return;
    if (origin.el) flash(feedback(origin.el, 'is-sent', ms(SENT_MS)), op); // generation-guarded; a later operation clears it
    if (prefersReducedMotion()) return; // no particles
    // The spark leaves from the control; a far source (typed text, voice nest, tutorial step) becomes a pick-up streak
    // and the flight that starts in this same tick waits for it (BF).
    butterfly.spark(origin.el && origin.el.isConnected ? origin.el : { x: origin.x, y: origin.y });
  }

  // ---- post-landing hop (i) -----------------------------------------------------------------------
  /** Armed at the LANDING on a page's title: after 1.2s without interaction, one short hop to its primary KPI. Any
   *  interaction cancels it, also while the hop is in the air (the listeners stay until the hop is done; the butterfly
   *  then returns to the anchor). */
  function armHop(op: number, id: DestId): void {
    if (prefersReducedMotion()) return;
    const first = destinations.find((d) => d.id === id)?.anchors[0];
    if (!first) return;
    let off = (): void => {};
    let touched = false;
    let hopping = false;
    let returned = false;
    const onUser = (): void => {
      touched = true;
      off();
      if (!hopping || returned || !isCurrent(op)) return;
      // Interaction while the hop is in the air: the pulse / underline never follow and the butterfly goes back to
      // the anchor it came from (short, no dim).
      returned = true;
      guide.cancel?.();
      const home = page.target();
      if (!home) return release(op);
      void guide.focus(home.el, { ...home.opts, trail: 'none', maxDuration: HOP_MAX_MS }).then(() => release(op));
    };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    off = (): void => evs.forEach((e) => document.removeEventListener(e, onUser, true));
    evs.forEach((e) => document.addEventListener(e, onUser, { capture: true, passive: true }));
    bind(op, off);
    after(op, ms(POST_LAND_HOP_MS), () => {
      if (touched) return off();
      const tg = page.target(first);
      if (!tg) return off();
      const within = tg.opts.within?.getBoundingClientRect() ?? null;
      const r = tg.el.getBoundingClientRect();
      if (within && (r.top < within.top || r.bottom > within.bottom)) return off(); // off screen: no hop
      hopping = true;
      claim(op);
      void guide.focus(tg.el, { ...tg.opts, dim: true, pulse: true, trail: 'light', maxDuration: HOP_MAX_MS }).then(() => {
        hopping = false;
        off();
        if (!returned) release(op);
      });
    });
  }

  // ---- (a)(b)(e) page open ------------------------------------------------------------------------
  /** The page open whose flight has not landed yet (a repeated request for the same anchor joins it). */
  let landing: { op: number; route: DestId; anchor: string; confirm: boolean } | null = null;

  function openPage(id: DestId, anchor: string | undefined, source: NavSource, origin: Origin | null): void {
    const st = getState();
    const want = anchor ?? 'title';
    if (landing && isCurrent(landing.op) && st.route === id && st.anchor === want) {
      // The same page and anchor is still being flown to: no second operation (it would cancel the running
      // sequence and focus / announce before the landing). The running sequence confirms when it lands.
      landing.confirm = true;
      return;
    }
    if (st.route === id && st.anchor === want && page.visible()) {
      // Same page, same anchor, already landed: a short confirmation pulse. Handled as its own (short) operation: any
      // follow-ups that were still scheduled are completed here, never lost. A flight is only needed when something
      // (a wheel / sheet) took the butterfly away from the anchor.
      const op = begin('page');
      const here = page.target();
      const atAnchor = !!here && dist(butterfly.position(), perchPoint(here.el.getBoundingClientRect(), here.opts.side, here.opts.within?.getBoundingClientRect() ?? null)) < AT_ANCHOR_PX;
      page.confirm(op);
      page.arrive();
      page.revealFollowups();
      deps.releaseOverlays?.();
      deps.rest?.();
      if (!atAnchor) deps.settle();
      return;
    }
    const op = begin('page');
    const reduced = prefersReducedMotion();
    const prev = st.route;
    const dir = prev ? Math.sign(destIndex(id) - destIndex(prev)) || 1 : 1;
    const prevTarget = prev ? page.target() : null;
    const prevPt = prevTarget ? centerOf(prevTarget.el.getBoundingClientRect()) : null;

    const prep = page.prepare(id, anchor);
    const tg = page.target();
    const instant = source === 'hash'; // deep link / back button: content is not delayed for a flight
    bind(op, () => deps.releaseOverlays?.()); // a newer action ends a held wheel / sheet too
    deps.syncPads?.();
    if (!tg) {
      page.revealShell({ at: null, from: null, fade: true });
      void page.revealContent();
      page.revealFollowups();
      page.arrive();
      deps.releaseOverlays?.();
      return;
    }
    claim(op);

    const tr = tg.el.getBoundingClientRect();
    const sr = tg.opts.within?.getBoundingClientRect() ?? null;
    const land: Pt = perchPoint(tr, tg.opts.side, sr);
    const from = origin ? { x: origin.x, y: origin.y } : null;
    const slide = prep.shellShown && !prep.sameRoute ? dir : undefined; // the frame stays: the content slides

    let shellDone = prep.shellShown;
    let contentDone = prep.contentShown;
    let approached = false;
    let contentP: Promise<void> = Promise.resolve();
    let arrived = false;
    const mine = { op, route: id, anchor: want, confirm: false };
    if (!instant) landing = mine;

    /** The frame appears and the outgoing wheel / sheet leaves. */
    const openShell = (): void => {
      if (!isCurrent(op)) return;
      // The held wheel / sheet leaves even when the frame is already on screen (page -> page): the release must not
      // depend on whether the shell had to be revealed.
      deps.releaseOverlays?.();
      if (shellDone) return;
      shellDone = true;
      page.revealShell({ at: land, from, fade: instant || reduced });
      deps.syncPads?.();
    };
    /** The new content starts. `early`: the visual fade only (CONTENT_LEAD_MS before the landing); it stays inert, and
     *  nothing else (focus, announcement, pulse) happens before the landing. The old page's ghost is completely gone
     *  first, so old and new text are never on screen together. */
    const showContent = (early = false): void => {
      if (contentDone || !isCurrent(op)) return;
      contentDone = true;
      openShell();
      const start = (): Promise<void> => (isCurrent(op) ? page.revealContent({ dir: slide, early }) : Promise.resolve());
      if (!page.hasGhost()) {
        contentP = start();
        return;
      }
      contentP = new Promise<void>((resolve) => {
        bind(op, resolve);
        void page.exitGhost(dir).then(() => after(op, ms(GHOST_GAP_MS), () => void start().then(resolve)));
      });
    };
    /** The butterfly is <=300ms from landing. */
    const approach = (): void => {
      if (approached || !isCurrent(op)) return;
      approached = true;
      if (prep.shellShown || reduced || instant) openShell();
      else after(op, ms(SHELL_DELAY_MS), openShell); // the frame appears late enough to stay empty only briefly
      if (instant) showContent();
      else if (reduced) showContent(true); // reduced motion is ONE short cross-fade (still inert until the landing)
      else {
        if (prep.shellShown && !prep.sameRoute) after(op, ms(APPROACH_LEAD - CONTENT_LEAD_MS - GHOST_OUT_MS - GHOST_GAP_MS), () => void page.exitGhost(dir));
        after(op, ms(APPROACH_LEAD - CONTENT_LEAD_MS), () => showContent(true));
      }
      deps.syncPads?.();
    };
    /** The butterfly has landed: the only place that focuses, announces and (via the guide) pulses. */
    const arrive = (): void => {
      if (arrived || !isCurrent(op)) return;
      arrived = true;
      landing = null;
      page.arrive();
      if (mine.confirm) page.confirm(op);
      after(op, reduced ? REDUCED_MS : ms(FOLLOWUPS_MS), () => page.revealFollowups());
    };
    /** The flight failed or never reported: the page must still end up readable, but without a landing nothing is
     *  focused, announced or pulsed. */
    const recover = (): void => {
      if (!isCurrent(op)) return;
      landing = null;
      approached = true;
      openShell();
      showContent();
      page.unlockContent();
      after(op, ms(FOLLOWUPS_MS), () => page.revealFollowups());
    };

    if (instant) {
      approach();
      arrive();
    } else {
      after(op, ms(WATCHDOG_MS), recover);
    }

    const carry = prep.shellShown && prevPt && dist(prevPt, centerOf(tr)) < 120;
    const p = guide.focus(tg.el, {
      ...tg.opts,
      dim: true,
      pulse: true,
      underline: true,
      trail: reduced ? 'none' : instant ? 'light' : 'full',
      minDuration: carry ? CARRY_MIN_MS : undefined,
      onApproach: instant ? undefined : approach,
      reveal: instant
        ? undefined
        : () => {
            if (!isCurrent(op)) return;
            approach();
            showContent();
            page.unlockContent();
            arrive();
            if ((anchor ?? 'title') === 'title') armHop(op, id); // armed from the landing
            return contentP;
          },
    });
    void p.then((landed) => {
      if (!isCurrent(op)) return; // a newer action owns everything now
      if (landed) {
        approach();
        showContent();
        page.unlockContent();
        arrive();
      } else recover();
      release(op);
      if (instant && landed && (anchor ?? 'title') === 'title') armHop(op, id);
    });
  }

  // ---- (c) ambiguous / (d) no match ---------------------------------------------------------------

  /** Fly through `wps` (retargeting at `onApproach`, so the butterfly sweeps instead of stopping), then run `final`.
   *  `forceAt`: if the waypoints are still not done by then, the last leg starts at once (aggregate budget). */
  function sweepThrough(op: number, wps: Pt[], final: (remainingMs: number) => Promise<boolean>, forceAt: number, onFirst?: () => void): Promise<boolean> {
    const t0 = performance.now();
    return new Promise<boolean>((resolve) => {
      let finalStarted = false;
      const startFinal = (): void => {
        if (finalStarted || !isCurrent(op)) return;
        finalStarted = true;
        // the final leg gets whatever is left of the aggregate budget (never less than a readable minimum)
        resolve(final(Math.max(SWEEP_MIN_LEG_MS, SWEEP_TOTAL_MS - designMs(performance.now() - t0)))); // design ms: the butterfly applies the tempo
      };
      after(op, ms(forceAt), startFinal);
      const next = (i: number): void => {
        if (finalStarted || !isCurrent(op)) return;
        if (i >= wps.length) return startFinal();
        let kicked = false;
        const go = (ok: boolean): void => {
          if (kicked) return;
          kicked = true;
          if (i === 0) onFirst?.();
          if (!ok) {
            if (!finalStarted) {
              finalStarted = true;
              resolve(false);
            }
            return;
          }
          next(i + 1);
        };
        void butterfly.flyTo(wps[i], { trail: 'full', onApproach: () => go(true) }).then(go);
      };
      next(0);
    });
  }

  /** Total estimated time of a sweep over `pts` (each retarget starts APPROACH_LEAD before the previous landing). */
  function estimateSweep(pts: Pt[]): number {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += estDur(dist(pts[i - 1], pts[i])) - (i > 1 ? APPROACH_LEAD : 0);
    return total;
  }

  function candidates(items: MatchCandidate[], origin: Origin | null): void {
    const op = begin('other');
    touch(origin, op);
    const reduced = prefersReducedMotion();
    center.showCandidates(items, { hold: true, own: true });
    const { prompt, items: lis } = center.parts();
    const target = prompt ?? center.el;
    claim(op);
    const finish = (): void => {
      if (!isCurrent(op)) return;
      center.reveal('prompt');
      center.reveal('items'); // safety: nothing stays hidden
      release(op);
    };
    deps.syncPads?.();
    if (reduced || !prompt) {
      // one short sequence: the prompt with the butterfly's arrival, the candidates through the landing callback
      void guide
        .focus(target, { side: 'top', pulse: true, trail: 'none', onApproach: () => center.reveal('prompt'), reveal: () => center.reveal('items', true) })
        .then(finish);
      return;
    }
    const rects = lis.map((li) => li.getBoundingClientRect());
    const cs = rects.map(centerOf);
    // Stacked candidates (phones): a sweep over the row would stop on top of the first card and read as a
    // recommendation. The butterfly goes straight to the prompt and the candidates follow it, all equally bright.
    const stacked = rects.length > 1 && rects[1].top >= rects[0].bottom - 4;
    const above = (i: number): Pt => ({ x: cs[i].x, y: rects[i].top - 30 });
    let wps: Pt[] = stacked || !cs.length ? [] : cs.length > 1 ? [above(0), above(cs.length - 1)] : [above(0)];
    const pr = prompt.getBoundingClientRect();
    const promptPt = perchPoint(pr, 'top', null);
    const start = butterfly.position();
    // aggregate budget: drop waypoints until the whole sweep fits
    if (wps.length > 1 && estimateSweep([start, ...wps, promptPt]) > SWEEP_BUDGET_MS) wps = [above(Math.floor((cs.length - 1) / 2))];
    if (wps.length && estimateSweep([start, ...wps, promptPt]) > SWEEP_BUDGET_MS) wps = [];

    // Each candidate fades in as the butterfly passes over it; the prompt as it gets near.
    const shown = new Set<HTMLElement>();
    if (!stacked) {
      frames(op, () => {
        const bf = butterfly.position();
        lis.forEach((li, i) => {
          if (shown.has(li)) return;
          const c = cs[i];
          if ((Math.abs(bf.x - c.x) < 70 && Math.abs(bf.y - c.y) < 190) || dist(bf, c) < 130) {
            shown.add(li);
            center.reveal(li);
          }
        });
        return shown.size < lis.length;
      });
    }

    // the prompt appears when the butterfly gets near the row (its first waypoint), before the first candidate lights
    const showPrompt = (): void => center.reveal('prompt');
    void sweepThrough(
      op,
      wps,
      (left) => guide.focus(prompt, { side: 'top', pulse: true, trail: 'full', maxDuration: left, onApproach: () => (showPrompt(), stacked && center.reveal('items', true)), reveal: () => center.reveal('items') }),
      SWEEP_FORCE_MS,
      showPrompt,
    ).then(finish);
  }

  function noMatch(origin: Origin | null): void {
    const op = begin('other');
    touch(origin, op);
    const reduced = prefersReducedMotion();
    center.showNoMatch({ hold: true, own: true });
    butterfly.tilt();
    const { prompt } = center.parts();
    const target = prompt ?? center.el;
    claim(op);
    deps.syncPads?.();
    const done = (landed: boolean): void => {
      if (!isCurrent(op)) return;
      center.reveal('prompt');
      center.reveal('items', true);
      release(op);
      if (landed) {
        // only after landing: the Wheel button pulses and the butterfly turns toward it, then back to neutral
        deps.pulseWheel(op);
        after(op, ms(WHEEL_GLANCE_MS), () => butterfly.turnToward(null));
      }
    };
    const go = (): Promise<boolean> =>
      guide.focus(target, { side: 'top', pulse: false, trail: reduced ? 'none' : 'light', onApproach: () => center.reveal('prompt'), reveal: () => center.reveal('items', true) });
    if (reduced) {
      void go().then(done);
      return;
    }
    // a small detour (about 44px off the straight line) reads as "hmm?"
    const a = butterfly.position();
    const b = centerOf(target.getBoundingClientRect());
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d = Math.max(1, dist(a, b));
    const via = { x: mid.x + (-(b.y - a.y) / d) * 44, y: mid.y + ((b.x - a.x) / d) * 44 };
    let kicked = false;
    void new Promise<boolean>((resolve) => {
      void butterfly
        .flyTo(via, {
          trail: 'light',
          onApproach: () => {
            if (kicked) return;
            kicked = true;
            resolve(go());
          },
        })
        .then((ok) => {
          if (kicked) return;
          kicked = true;
          resolve(ok ? go() : false);
        });
    }).then(done);
  }

  // ---- (f) close ----------------------------------------------------------------------------------
  function closePage(keep: boolean): Promise<void> {
    if (!keep) begin('close');
    deps.releaseOverlays?.();
    deps.syncPads?.();
    const r = ring.getBoundingClientRect();
    return page.hide(r.width ? centerOf(r) : null);
  }

  // ---- voice --------------------------------------------------------------------------------------
  /** The voice nest: a 2px element inside the input, about 60px above its centre (46px on phones). The butterfly and its
   *  pad both measure it, so they follow layout changes (resize, rotation). */
  let nestEl: HTMLElement | null = null;

  function voiceStart(): void {
    const op = begin('other');
    voiceOp = op;
    claim(op); // a pending settle() must not start a second flight
    if (butterflyOwner() === 'home') {
      // The old page's perch (or a close flight that has not even started) must not survive: the butterfly acquires the
      // ring first, owned by this operation, and only then listens.
      const r = ring.getBoundingClientRect();
      const far = r.width > 0 && dist(butterfly.position(), centerOf(r)) > HOME_NEAR_PX;
      if (!far) {
        butterfly.setMode('voice');
        return;
      }
      void guide.release().then((ok) => {
        if (ok && isCurrent(op)) butterfly.setMode('voice');
      });
      return;
    }
    // The follow-ups sit right where the nest is: they step back (and become inert) while the ripples are up.
    document.body.classList.add('voice-nest');
    page.refreshInert();
    // A page or overlay is open: the butterfly goes to the voice nest.
    nestEl = document.createElement('i');
    nestEl.className = 'voice-nest-anchor';
    nestEl.setAttribute('aria-hidden', 'true');
    (input.parentElement ?? document.body).append(nestEl);
    const el = nestEl;
    deps.syncPads?.();
    void butterfly
      .flyTo(el, {
        side: 'top',
        trail: 'light',
        onApproach: () => isCurrent(op) && deps.lightPad?.('nest', 'near'),
      })
      .then((ok) => {
        if (!ok || !isCurrent(op)) return;
        butterfly.setMode('voice');
        deps.lightPad?.('nest', 'lit');
      });
  }

  function voiceEnd(): void {
    document.body.classList.remove('voice-nest');
    page.refreshInert();
    // The anchor outlives the demo a little: the butterfly may still sit on it until the next flight takes off.
    const old = nestEl;
    nestEl = null;
    if (old) window.setTimeout(() => old.remove(), ms(NEST_LINGER_MS));
    release(voiceOp);
    voiceOp = 0;
    deps.syncPads?.();
  }

  // ---- (j) hesitation hint ------------------------------------------------------------------------
  /** The hint's whole lifetime (the turn, the border breath, the return) is one operation; activity ends it. */
  function hint(): void {
    if (hinted || butterflyOwner() !== 'home' || getState().overlay !== 'none') return;
    hinted = true;
    const op = begin('other');
    hintOp = op;
    const r = input.getBoundingClientRect();
    const p = butterfly.position();
    const d = Math.max(1, dist(p, { x: r.left + r.width / 2, y: r.top + r.height / 2 }));
    const to = { x: p.x + ((r.left + r.width / 2 - p.x) / d) * HINT_ARC_PX, y: p.y + ((r.top + r.height / 2 - p.y) / d) * HINT_ARC_PX };
    flash(feedback(pill, 'is-hint', ms(HINT_PILL_MS)), op);
    butterfly.turnToward(input); // the head turns to the input first: visible even where the arc is short
    if (prefersReducedMotion()) {
      after(op, ms(HINT_PILL_MS), () => (hintOp = 0));
      return;
    }
    butterfly.setMode('listening'); // two or three flaps
    after(op, ms(HINT_TURN_MS), () => {
      void butterfly.flyTo(to, { trail: 'none', minDuration: CARRY_MIN_MS }).then((ok) => {
        if (!ok || !isCurrent(op)) return;
        butterfly.setMode('perched');
        butterfly.turnToward(null);
        void butterfly.home().then(() => {
          if (isCurrent(op)) hintOp = 0;
        });
      });
    });
  }

  function cancelHint(): void {
    if (!hintOp) return;
    const op = hintOp;
    hintOp = 0;
    if (!isCurrent(op)) return;
    beginOp(); // pill breath, pending callbacks: all bound to the hint's token
    if (prefersReducedMotion()) return;
    // The physical flight ends whatever is in the input: back to the ring (typed text keeps the listening flap).
    butterfly.setMode(input.value.trim() ? 'listening' : 'perched');
    void butterfly.home();
  }

  return {
    touch: (origin) => touch(origin),
    inputSent: () => flash(feedback(pill, 'is-sent', ms(SENT_MS))),
    page: openPage,
    closePage,
    candidates,
    noMatch,
    overlayOpened: () => void begin('other'),
    voiceStart,
    voiceEnd,
    nestAnchor: () => nestEl,
    homeVisit: () => {
      hinted = false;
    },
    hint,
    cancelHint,
  };
}
