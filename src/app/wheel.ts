import { destinations } from '../data/destinations';
import { l, t } from '../i18n';
import { s, clear, trapTab } from './dom';
import { destGlyph } from './icons';
import { getState, setState } from './state';
import { navigate } from './navigate';
import type { CloseOpts } from './navigate';
import { announce } from './announce';

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
}

export function createWheel(deps: { input: HTMLInputElement; scrim: HTMLElement; button: HTMLElement; settle: () => void }): Wheel {
  const root = document.getElementById('wheel') as HTMLElement;
  const svgHost = document.getElementById('wheel-svg-host') as HTMLElement;
  const closeBtn = document.getElementById('wheel-close') as HTMLButtonElement;
  const rim = document.getElementById('wheel-rim') as HTMLElement;
  let sectors: SVGGElement[] = [];
  let active = 0;
  let trigger: HTMLElement | null = null;

  function setActive(i: number, focus: boolean): void {
    active = (i + N()) % N();
    sectors.forEach((g, k) => {
      g.setAttribute('tabindex', k === active ? '0' : '-1');
      g.classList.toggle('is-active', k === active);
    });
    if (focus) sectors[active].focus({ preventScroll: true });
  }

  function select(i: number): void {
    const dest = destinations[i];
    close({ restoreFocus: false, settle: false });
    navigate({ id: dest.id }, { source: 'wheel' });
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
    root.hidden = false;
    deps.button.setAttribute('aria-expanded', 'true');
    active = Math.max(0, destinations.findIndex((d) => d.id === getState().route)); // start on the current page
    render();
    setActive(active, true);
    announce(t('announce.wheel'));
    deps.settle();
  }

  function close(o: CloseOpts): void {
    if (getState().overlay !== 'wheel') return;
    setState({ overlay: 'none' });
    document.body.classList.remove('overlay-wheel');
    root.hidden = true;
    deps.scrim.hidden = true;
    deps.button.setAttribute('aria-expanded', 'false');
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

  return { open, close, rim, render: () => getState().overlay === 'wheel' && render(), isOpen: () => getState().overlay === 'wheel' };
}

