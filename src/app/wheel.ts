import { destinations } from '../data/destinations';
import { l, t } from '../i18n';
import { s, clear, trapTab } from './dom';
import { destGlyph } from './icons';
import { getState, setState } from './state';
import { navigate } from './navigate';
import type { CloseOpts } from './navigate';
import { announce } from './announce';
import { anim, ms, prefersReducedMotion } from './motion';
import type { Anim } from './motion';

/** The dial fades this long when it closes (design ms, through ms()). */
const CLOSE_FADE_MS = 120;
const R = 206; // outer radius (viewBox units)
const R0 = 66; // inner radius
const GAP = 0.018; // radians
const N = () => destinations.length;

const pt = (r: number, a: number): string => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
function sectorPath(i: number): string {
  const step = (2 * Math.PI) / N();
  const mid = -Math.PI / 2 + i * step;
  const a0 = mid - step / 2 + GAP;
  const a1 = mid + step / 2 - GAP;
  return `M ${pt(R, a0)} A ${R} ${R} 0 0 1 ${pt(R, a1)} L ${pt(R0, a1)} A ${R0} ${R0} 0 0 0 ${pt(R0, a0)} Z`;
}

export interface Wheel {
  open(trigger?: HTMLElement | null): void;
  close(o: CloseOpts): void;
  render(): void;
  isOpen(): boolean;
  /** The point on the dial's rim where the butterfly perches. */
  readonly rim: HTMLElement;
  /** A close that was started with `hold` finishes visually now (the dial fades; the page shell is appearing). */
  release(): void;
}

export function createWheel(deps: {
  input: HTMLInputElement;
  scrim: HTMLElement;
  button: HTMLElement;
  settle: () => void;
  /** The butterfly (perched on the rim) turns toward the active sector; null = neutral. */
  turn?: (el: Element | null) => void;
}): Wheel {
  const root = document.getElementById('wheel') as HTMLElement;
  const svgHost = document.getElementById('wheel-svg-host') as HTMLElement;
  const closeBtn = document.getElementById('wheel-close') as HTMLButtonElement;
  const rim = document.getElementById('wheel-rim') as HTMLElement;
  let sectors: SVGGElement[] = [];
  let active = 0;
  let trigger: HTMLElement | null = null;
  let leave: Anim | null = null;
  let leaveSeq = 0;
  let held = false;

  /** The perch element follows the active sector along the rim (CSS spring transition). The butterfly sits on it and
   *  follows with its own smoothing: no flight, no trail per sector change. The element is placed so that the
   *  butterfly's perch point ('top-right': 4px inside its right edge, 24px above it) is just outside the rim. */
  function placeRim(i: number): void {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / N();
    const rad = (R + 26) / 432; // fraction of the dial
    const x = 50 + 100 * rad * Math.cos(a);
    const y = 50 + 100 * rad * Math.sin(a);
    rim.style.left = `calc(${x.toFixed(2)}% - 4px)`;
    rim.style.top = `calc(${y.toFixed(2)}% + 24px)`;
  }

  function setActive(i: number, focus: boolean): void {
    const prev = active;
    active = (i + N()) % N();
    sectors.forEach((g, k) => {
      g.setAttribute('tabindex', k === active ? '0' : '-1');
      g.classList.toggle('is-active', k === active);
    });
    if (focus) sectors[active].focus({ preventScroll: true });
    // hover / arrow keys: the perch point slides along the rim to the active sector
    if (active !== prev || !rim.style.left) placeRim(active);
    if (getState().overlay === 'wheel') deps.turn?.(sectors[active]); // also re-attaches after a language re-render
  }

  function select(i: number): void {
    // navigate() closes the wheel itself; it measures the sector first, while the dial is still on screen
    navigate({ id: destinations[i].id }, { source: 'wheel', origin: sectors[i] });
  }

  function render(): void {
    root.setAttribute('aria-label', t('wheel.title'));
    (document.getElementById('wheel-title') as HTMLElement).textContent = t('wheel.title');
    (document.getElementById('wheel-hint') as HTMLElement).textContent = t('wheel.hint');
    closeBtn.setAttribute('aria-label', t('wheel.close'));
    const hadFocus = svgHost.contains(document.activeElement); // the language switch rebuilds the sectors
    clear(svgHost);
    const step = (2 * Math.PI) / N();
    const gs = destinations.map((d, i) => {
      const mid = -Math.PI / 2 + i * step;
      const rl = 138;
      const x = rl * Math.cos(mid);
      const y = rl * Math.sin(mid);
      const label = l(d.title);
      const g = s(
        'g',
        { class: 'sector', role: 'menuitem', tabindex: '-1', 'aria-label': `${label}: ${l(d.summary)}`, 'data-index': i },
        s('title', null, l(d.summary)),
        s('path', { d: sectorPath(i) }),
        destGlyph(d.id, { size: 26, x: +(x - 13).toFixed(1), y: +(y - 36).toFixed(1), class: 'sector-icon' }),
        s('text', { class: 'sector-label', x: x.toFixed(1), y: (y + 22).toFixed(1), 'text-anchor': 'middle', 'aria-hidden': 'true' }, label),
      ) as SVGGElement;
      g.addEventListener('click', () => select(i));
      g.addEventListener('pointerenter', (e) => {
        if ((e as PointerEvent).pointerType !== 'touch' && i !== active) setActive(i, false);
      });
      g.addEventListener('focus', () => {
        active = i;
        sectors.forEach((k, idx) => k.setAttribute('tabindex', idx === i ? '0' : '-1'));
      });
      return g;
    });
    const svg = s('svg', { viewBox: '-216 -216 432 432', class: 'wheel-svg', role: 'menu', 'aria-label': t('wheel.title') }, s('circle', { class: 'wheel-bg', r: R + 6 }), ...gs);
    svgHost.append(svg);
    sectors = gs;
    setActive(active, hadFocus);
  }

  function open(tr?: HTMLElement | null): void {
    if (getState().overlay === 'wheel') return;
    trigger = tr ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : deps.input);
    setState({ overlay: 'wheel' });
    document.body.classList.add('overlay-wheel');
    deps.scrim.hidden = false;
    held = false;
    leaveSeq++;
    leave?.cancel();
    leave = null;
    root.removeAttribute('inert');
    root.hidden = false;
    deps.button.setAttribute('aria-expanded', 'true');
    active = Math.max(0, destinations.findIndex((d) => d.id === getState().route)); // start on the current page
    rim.style.transition = 'none';
    placeRim(active); // the open flight aims at the final rim point
    void rim.offsetWidth;
    rim.style.transition = '';
    render();
    setActive(active, true);
    announce(t('announce.wheel'));
    deps.settle();
  }

  /** The visual part of closing: the dial fades (120ms) and the dimmed home comes back. */
  function finishClose(): void {
    held = false;
    document.body.classList.remove('overlay-wheel');
    deps.scrim.hidden = true;
    if (prefersReducedMotion()) {
      root.hidden = true;
      return;
    }
    // own token: a newer navigation must not cancel it, only a re-open does
    const mine = ++leaveSeq;
    root.setAttribute('inert', '');
    const a = anim(root, [{ opacity: 1 }, { opacity: 0 }], { duration: ms(CLOSE_FADE_MS), easing: 'linear', fill: 'forwards', own: true });
    leave = a;
    void a.finished.then(() => {
      if (mine !== leaveSeq) return;
      root.hidden = true;
      root.removeAttribute('inert');
      a.cancel();
      leave = null;
    });
  }

  function close(o: CloseOpts): void {
    if (getState().overlay !== 'wheel') return;
    setState({ overlay: 'none' });
    deps.turn?.(null);
    deps.button.setAttribute('aria-expanded', 'false');
    // `hold`: the dial stays on screen (inert) until `release()`: the outgoing UI leaves when the page shell appears
    if (o.hold) {
      held = true;
      root.setAttribute('inert', '');
    } else finishClose();
    if (o.restoreFocus) (trigger && trigger.isConnected ? trigger : deps.input).focus({ preventScroll: true });
    if (o.settle) deps.settle();
    trigger = null;
  }

  root.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    trapTab(e, root);
    const onSector = (e.target as Element).closest?.('.sector');
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        setActive(active + 1, true);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        setActive(active - 1, true);
        break;
      case 'Home':
        e.preventDefault();
        setActive(0, true);
        break;
      case 'End':
        e.preventDefault();
        setActive(N() - 1, true);
        break;
      case 'Enter':
      case ' ':
        if (onSector) {
          e.preventDefault();
          select(active);
        }
        break;
      default:
    }
  });
  closeBtn.addEventListener('click', () => close({ restoreFocus: true, settle: true }));
  deps.scrim.addEventListener('click', () => {
    if (getState().overlay === 'wheel') close({ restoreFocus: true, settle: true });
  });

  return { open, close, rim, release: () => held && finishClose(), render: () => getState().overlay === 'wheel' && render(), isOpen: () => getState().overlay === 'wheel' };
}

