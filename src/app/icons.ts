import type { DestId } from '../types';
import { s } from './dom';

/** Small stroke glyphs (24x24 grid) keyed by destination id. They replace `Destination.icon` (emoji need a font). */
const GLYPHS: Record<DestId, string[]> = {
  overview: ['M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z', 'M15 3.8a8.5 8.5 0 0 1 5.2 5.2H15z'],
  cashflow: ['M4 8h14l-3.5-3.5', 'M20 16H6l3.5 3.5'],
  holdings: ['M3.5 8h17v11.5h-17z', 'M9 8V5.5h6V8', 'M3.5 13.5h17'],
  returns: ['M3.5 17l6-6 4 4 7-7.5', 'M15 7.5h5.5V13'],
  risk: ['M12 3.5l9.5 16.5h-19z', 'M12 10v5', 'M12 17.6v.4'],
  plan: ['M4 6h16v14H4z', 'M4 10.5h16', 'M8.5 3.5v4M15.5 3.5v4', 'M8.5 14.5h3'],
  trades: ['M6 3.5h12v17l-3-2-3 2-3-2-3 2z', 'M9.5 8.5h5M9.5 12h5'],
};

/** An inline `<svg>` glyph; place it with x/y (SVG parents) or CSS. */
export function destGlyph(id: DestId, o: { size: number; x?: number; y?: number; class?: string }): SVGElement {
  return s(
    'svg',
    { viewBox: '0 0 24 24', width: o.size, height: o.size, x: o.x, y: o.y, class: o.class, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' },
    ...GLYPHS[id].map((d) => s('path', { d })),
  );
}
