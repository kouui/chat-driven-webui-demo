import { h, s } from '../app/dom';
import type { Child } from '../app/dom';
import { t } from '../i18n';

export const COLORS = ['#F5C76A', '#6FD3C4', '#7FA8FF', '#B79CFF', '#FF9E7A', '#8A94A6'];
export const CLS_COLOR: Record<string, string> = { stock: '#F5C76A', bond: '#7FA8FF', cash: '#6FD3C4', gold: '#B79CFF' };

export function pageHeader(title: string, subtitle: string): HTMLElement {
  return h(
    'header',
    { class: 'page-head' },
    h('h2', { class: 'page-title', 'data-perch': 'title', tabindex: '-1', id: 'page-title' }, title),
    h('p', { class: 'page-sub' }, subtitle),
    h('span', { class: 'tag-demo' }, t('page.demo')),
  );
}

export interface KpiOpts {
  label: string;
  value: string;
  note?: Child;
  tone?: 'pos' | 'neg' | 'gold' | 'warn';
  perch?: string;
  big?: boolean;
  /** Compound text (e.g. "NVDA · $x") may wrap at spaces; numbers never do. */
  wrap?: boolean;
  extra?: Child;
}

export function kpi(o: KpiOpts): HTMLElement {
  return h(
    'div',
    { class: `kpi${o.big ? ' kpi-big' : ''}` },
    h('div', { class: 'kpi-label' }, o.label),
    // the anchor is the value itself: the butterfly lands in its left gutter, the pulse hugs the number
    h('div', { class: `kpi-value${o.wrap ? ' wrap' : ''}${o.tone ? ` tone-${o.tone}` : ''}`, 'data-perch': o.perch ?? null }, o.value),
    o.note ? h('div', { class: 'kpi-note' }, o.note) : null,
    o.extra,
  );
}

export function panel(title: string | null, children: Child, perch?: string, cls = ''): HTMLElement {
  return h('section', { class: `panel ${cls}`.trim(), 'data-perch': perch ?? null }, title ? h('h3', { class: 'panel-title' }, title) : null, children);
}

export function badge(text: string, tone: 'pos' | 'neg' | 'gold' | 'muted' | 'warn' = 'muted'): HTMLElement {
  return h('span', { class: `badge badge-${tone}` }, text);
}

export function grid(cols: 2 | 3, ...children: Child[]): HTMLElement {
  return h('div', { class: `grid grid-${cols}` }, ...children);
}

export function table(headers: { text: string; num?: boolean }[], rows: Child[][], caption: string): HTMLElement {
  return h(
    'div',
    { class: 'tbl-wrap', tabindex: '0', role: 'region', 'aria-label': caption },
    h(
      'table',
      { class: 'tbl' },
      h('caption', { class: 'sr-only' }, caption),
      h('thead', null, h('tr', null, headers.map((x) => h('th', { scope: 'col', class: x.num ? 'num' : '' }, x.text)))),
      h(
        'tbody',
        null,
        rows.map((r) => h('tr', null, r.map((cell, i) => h('td', { class: headers[i]?.num ? 'num' : '' }, cell)))),
      ),
    ),
  );
}

/** Visually hidden data table: the accessible equivalent of a chart. */
export function chartData(caption: string, headers: string[], rows: string[][]): HTMLElement {
  return h(
    'table',
    { class: 'sr-only' },
    h('caption', null, caption),
    h('thead', null, h('tr', null, headers.map((x) => h('th', { scope: 'col' }, x)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : null, c))))),
  );
}

// ------------------------------------------------------------------ charts
export function donut(
  slices: { label: string; value: number; color: string }[],
  o: { aria: string; centerLabel: string; centerValue: string; legend: (sl: { label: string; value: number; color: string }, pct: number) => Child },
): HTMLElement {
  const total = slices.reduce((a, x) => a + x.value, 0);
  const R = 46;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = slices.map((sl) => {
    const len = (sl.value / total) * C;
    const gap = slices.length > 1 ? 1.2 : 0;
    const el = s('circle', {
      cx: 60,
      cy: 60,
      r: R,
      fill: 'none',
      stroke: sl.color,
      'stroke-width': 14,
      'stroke-dasharray': `${Math.max(len - gap, 0.1)} ${C}`,
      'stroke-dashoffset': -offset,
      transform: 'rotate(-90 60 60)',
    });
    offset += len;
    return el;
  });
  const svg = s(
    'svg',
    { viewBox: '0 0 120 120', class: 'donut', role: 'img', 'aria-label': o.aria },
    s('circle', { cx: 60, cy: 60, r: R, fill: 'none', stroke: 'rgba(255,255,255,.06)', 'stroke-width': 14 }),
    ...arcs,
    s('text', { x: 60, y: 56, 'text-anchor': 'middle', class: 'donut-label' }, o.centerLabel),
    s('text', { x: 60, y: 73, 'text-anchor': 'middle', class: 'donut-value' }, o.centerValue),
  );
  return h(
    'div',
    { class: 'donut-wrap' },
    svg,
    h(
      'ul',
      { class: 'legend' },
      slices.map((sl) =>
        h('li', null, h('i', { class: 'swatch', style: `background:${sl.color}` }), o.legend(sl, (sl.value / total) * 100)),
      ),
    ),
  );
}

export interface Series {
  name: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

export function lineChart(series: Series[], labels: string[], o: { aria: string; fmt: (v: number) => string; legendFmt?: (v: number) => string; zeroLine?: boolean; width?: number; height?: number }): HTMLElement {
  const W = o.width ?? 520;
  const H = o.height ?? 210;
  const L = 40;
  const R = 12;
  const T = 12;
  const B = 26;
  const all = series.flatMap((x) => x.values);
  const lo = Math.min(...all, o.zeroLine ? 0 : Infinity);
  const hi = Math.max(...all, o.zeroLine ? 0 : -Infinity);
  const raw = (hi - lo || 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((c) => c >= raw) ?? raw;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const n = labels.length;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(n - 1, 1);
  const y = (v: number) => T + ((max - v) / (max - min)) * (H - T - B);
  const grid: SVGElement[] = [];
  for (let v = min; v <= max + step / 2; v += step) {
    grid.push(
      s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid-line' }),
      s('text', { x: L - 6, y: y(v) + 3.5, 'text-anchor': 'end', class: 'axis' }, o.fmt(v)),
    );
  }
  const xs = n > 8 ? 2 : 1;
  const xl = labels.map((lb, i) => (i % xs === 0 || i === n - 1 ? s('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'axis' }, lb) : null));
  const lines = series.map((sr) => {
    const d = sr.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    return s('path', { d, fill: 'none', stroke: sr.color, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': sr.dashed ? '5 4' : null });
  });
  const dots = series.map((sr) => {
    const i = sr.values.length - 1;
    return s('circle', { cx: x(i), cy: y(sr.values[i]), r: 3.4, fill: sr.color });
  });
  const zero = o.zeroLine ? s('line', { x1: L, x2: W - R, y1: y(0), y2: y(0), class: 'zero-line' }) : null;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': o.aria, preserveAspectRatio: 'xMidYMid meet' }, ...grid, zero, ...xl, ...lines, ...dots);
  const legend = h(
    'ul',
    { class: 'legend legend-row' },
    series.map((sr) => h('li', null, h('i', { class: `swatch${sr.dashed ? ' dashed' : ''}`, style: `background:${sr.color}` }), `${sr.name} ${(o.legendFmt ?? o.fmt)(sr.values[sr.values.length - 1])}`)),
  );
  const f = o.legendFmt ?? o.fmt;
  const data = chartData(o.aria, [t('w.month'), ...series.map((x) => x.name)], labels.map((lb, i) => [lb, ...series.map((x) => f(x.values[i]))]));
  return h('div', { class: 'chart-wrap' }, svg, legend, data);
}

export function sparkline(values: number[], aria: string): SVGElement {
  const W = 220;
  const H = 54;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => 2 + (i * (W - 4)) / (values.length - 1);
  const y = (v: number) => 4 + ((max - v) / (max - min || 1)) * (H - 10);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${d} L${x(values.length - 1)} ${H} L${x(0)} ${H} Z`;
  const gid = `spark-${Math.round(Math.random() * 1e6)}`;
  return s(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'spark', role: 'img', 'aria-label': aria, preserveAspectRatio: 'none' },
    s('defs', null, s('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, s('stop', { offset: '0', 'stop-color': '#F5C76A', 'stop-opacity': 0.32 }), s('stop', { offset: '1', 'stop-color': '#F5C76A', 'stop-opacity': 0 }))),
    s('path', { d: area, fill: `url(#${gid})` }),
    s('path', { d, fill: 'none', stroke: '#F5C76A', 'stroke-width': 2, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }),
    s('circle', { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 3, fill: '#FFF3C4' }),
  );
}

export function barChart(items: { label: string; value: number; hi?: boolean }[], o: { aria: string; fmt: (v: number) => string }): HTMLElement {
  const W = 520;
  const H = 190;
  const L = 8;
  const B = 24;
  const T = 22;
  const max = Math.max(...items.map((i) => i.value)) || 1;
  const bw = (W - L * 2) / items.length;
  const bars: (SVGElement | null)[] = [];
  items.forEach((it, i) => {
    const hgt = Math.max((it.value / max) * (H - T - B), it.value > 0 ? 2 : 0);
    const x = L + i * bw + bw * 0.2;
    const w = bw * 0.6;
    bars.push(
      s('rect', { x, y: H - B - hgt, width: w, height: hgt, rx: 3, fill: it.hi ? '#F5C76A' : 'rgba(245,199,106,.38)' }),
      s('text', { x: x + w / 2, y: H - 8, 'text-anchor': 'middle', class: 'axis' }, it.label),
      it.value > 0 ? s('text', { x: x + w / 2, y: H - B - hgt - 5, 'text-anchor': 'middle', class: 'axis axis-val' }, o.fmt(it.value)) : null,
    );
  });
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': o.aria, preserveAspectRatio: 'xMidYMid meet' }, s('line', { x1: L, x2: W - L, y1: H - B, y2: H - B, class: 'grid-line' }), ...bars);
  return h('div', { class: 'chart-wrap' }, svg, chartData(o.aria, [t('w.date'), t('w.amount')], items.map((it) => [it.label, o.fmt(it.value)])));
}

/** Horizontal meter with an optional limit marker (0..max). */
export function meter(value: number, o: { max: number; limit?: number; tone?: 'gold' | 'warn' | 'pos'; aria: string }): HTMLElement {
  const w = Math.min(100, (value / o.max) * 100);
  return h(
    'div',
    { class: 'meter', role: 'meter', 'aria-label': o.aria, 'aria-valuemin': 0, 'aria-valuemax': o.max, 'aria-valuenow': Math.round(value) },
    h('div', { class: `meter-fill tone-${o.tone ?? 'gold'}`, style: `width:${w}%` }),
    o.limit !== undefined ? h('div', { class: 'meter-limit', style: `left:${(o.limit / o.max) * 100}%` }) : null,
  );
}

export function barRow(label: string, value: string, pctWidth: number, hi = false): HTMLElement {
  return h(
    'li',
    { class: 'barrow' },
    h('span', { class: 'barrow-label' }, label),
    h('span', { class: 'barrow-track', 'aria-hidden': 'true' }, h('i', { class: hi ? 'hi' : '', style: `width:${Math.max(pctWidth, 1.5)}%` })),
    h('span', { class: 'barrow-val num' }, value),
  );
}

export const signTone = (v: number): 'pos' | 'neg' | undefined => (v > 0 ? 'pos' : v < 0 ? 'neg' : undefined);
