// Builds the butterfly DOM: position wrapper > fade wrapper > sprite > inline SVG.
// The SVG viewBox is 100x100 with the body axis at x=50, so wing groups can pivot around (50,50).

const NS = 'http://www.w3.org/2000/svg';
let uid = 0;

type Attrs = Record<string, string | number>;

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, kids: SVGElement[] = []): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const k of Object.keys(attrs)) el.setAttribute(k, String(attrs[k]));
  for (const c of kids) el.appendChild(c);
  return el;
}

function stop(offset: number, color: string, opacity = 1): SVGStopElement {
  return s('stop', { offset, 'stop-color': color, 'stop-opacity': opacity });
}

export interface ButterflyDom {
  root: HTMLElement; // positioned via translate3d (outer wrapper)
  fade: HTMLElement; // opacity cross-fade (reduced motion)
  sprite: HTMLElement; // bob / sink / tilt / scale
  svg: SVGSVGElement;
  /** Wing groups: right/left x upper/lower. Right wings rotate +θ, left wings -θ. */
  wings: { ur: SVGGElement; ul: SVGGElement; lr: SVGGElement; ll: SVGGElement };
}

const UPPER = 'M50 47 C57 30 72 9 89 11 C99 13 99 31 91 43 C83 54 64 54 50 50 Z';
const LOWER = 'M50 50 C64 54 82 55 87 66 C91 78 79 91 68 87 C58 83 52 68 50 56 Z';

export function buildButterflyDom(): ButterflyDom {
  const id = ++uid;
  const gWing = `bf-grad-w-${id}`;
  const gBody = `bf-grad-b-${id}`;
  const gGlow = `bf-grad-g-${id}`;

  const defs = s('defs', {}, [
    s('radialGradient', { id: gWing, gradientUnits: 'userSpaceOnUse', cx: 50, cy: 46, r: 50 }, [
      stop(0, '#FFF3C4'),
      stop(0.5, '#F5C76A'),
      stop(1, '#B8862B'),
    ]),
    s('linearGradient', { id: gBody, x1: 0, y1: 0, x2: 0, y2: 1 }, [stop(0, '#FFF3C4'), stop(1, '#B8862B')]),
    s('radialGradient', { id: gGlow, cx: 0.5, cy: 0.5, r: 0.5 }, [
      stop(0, '#F5C76A', 0.42),
      stop(0.55, '#F5C76A', 0.12),
      stop(1, '#F5C76A', 0),
    ]),
  ]);

  const veins = (mirror: boolean): SVGElement[] => {
    const lines = [
      'M50 49 C62 40 74 28 86 18',
      'M50 50 C64 46 80 40 92 32',
      'M50 51 C64 58 76 66 82 74',
    ];
    return lines.map((d) =>
      s('path', { d, fill: 'none', stroke: '#FFF3C4', 'stroke-opacity': mirror ? 0.4 : 0.4, 'stroke-width': 0.6, 'stroke-linecap': 'round' }),
    );
  };

  const wing = (cls: string, d: string, mirror: boolean, extras: SVGElement[]): SVGGElement => {
    const inner = s(
      'g',
      mirror ? { transform: 'translate(100 0) scale(-1 1)' } : {},
      [s('path', { d, fill: `url(#${gWing})`, stroke: '#FFF3C4', 'stroke-opacity': 0.55, 'stroke-width': 0.7, 'stroke-linejoin': 'round' }), ...extras],
    );
    return s('g', { class: `bf-wing ${cls}` }, [inner]);
  };

  const upperExtras = [...veins(false), s('circle', { cx: 85, cy: 24, r: 2.2, fill: '#FFF3C4', 'fill-opacity': 0.75 })];
  const lowerExtras = [s('circle', { cx: 74, cy: 76, r: 1.8, fill: '#FFF3C4', 'fill-opacity': 0.65 })];

  const ur = wing('bf-wing-ur', UPPER, false, upperExtras);
  const ul = wing('bf-wing-ul', UPPER, true, upperExtras.map((e) => e.cloneNode(true) as SVGElement));
  const lr = wing('bf-wing-lr', LOWER, false, lowerExtras);
  const ll = wing('bf-wing-ll', LOWER, true, lowerExtras.map((e) => e.cloneNode(true) as SVGElement));

  const body = s('g', { class: 'bf-body' }, [
    s('path', { d: 'M49 33 C44 24 41 17 38 13', fill: 'none', stroke: '#F5C76A', 'stroke-width': 1, 'stroke-linecap': 'round' }),
    s('path', { d: 'M51 33 C56 24 59 17 62 13', fill: 'none', stroke: '#F5C76A', 'stroke-width': 1, 'stroke-linecap': 'round' }),
    s('circle', { cx: 37.6, cy: 12.6, r: 1.4, fill: '#FFF3C4' }),
    s('circle', { cx: 62.4, cy: 12.6, r: 1.4, fill: '#FFF3C4' }),
    s('ellipse', { cx: 50, cy: 52, rx: 2.6, ry: 15, fill: `url(#${gBody})` }),
    s('circle', { cx: 50, cy: 35, r: 3.4, fill: '#FFF3C4' }),
  ]);

  // Order: glow, lower wings, upper wings, body.
  const svg = s('svg', { class: 'bf-svg', viewBox: '0 0 100 100', width: 64, height: 64, focusable: 'false', 'aria-hidden': 'true' }, [
    defs,
    s('circle', { class: 'bf-glow', cx: 50, cy: 50, r: 62, fill: `url(#${gGlow})` }),
    ll,
    lr,
    ul,
    ur,
    body,
  ]);

  const sprite = document.createElement('div');
  sprite.className = 'bf-sprite';
  sprite.appendChild(svg);
  const fade = document.createElement('div');
  fade.className = 'bf-fade';
  fade.appendChild(sprite);
  const root = document.createElement('div');
  root.className = 'bf-root';
  root.appendChild(fade);

  return { root, fade, sprite, svg, wings: { ur, ul, lr, ll } };
}
