import { h } from '../app/dom';
import { t, l, money, pct, num } from '../i18n';
import { destinations } from '../data/destinations';
import { holdingsByValue, holdingValue, weightOf, topHolding, techShare, holdings } from '../data/mock';
import { pageHeader, kpi, panel, table, grid, signTone } from './widgets';

export function renderHoldings(): HTMLElement {
  const dest = destinations.find((d) => d.id === 'holdings')!;
  return h(
    'div',
    { class: 'page' },
    pageHeader(l(dest.title), l(dest.summary)),
    grid(
      3,
      kpi({ wrap: true, perch: 'top-holding', label: t('ho.top'), value: `${topHolding.symbol} · ${money(holdingValue(topHolding))}`, tone: 'gold', note: t('ho.topNote', { p: pct(weightOf(topHolding), 1) }) }),
      kpi({ label: t('ho.techShare'), value: pct(techShare, 1), tone: 'warn', note: 'NVDA · AAPL · MSFT · QQQ' }),
      kpi({ label: t('ho.count'), value: String(holdings.length), note: t('ho.countNote') }),
    ),
    panel(
      t('ho.list'),
      table(
        [{ text: t('w.symbol') }, { text: t('w.name') }, { text: t('w.shares'), num: true }, { text: t('w.price'), num: true }, { text: t('w.value'), num: true }, { text: t('w.weight'), num: true }, { text: t('w.today'), num: true }],
        holdingsByValue.map((x) => [
          h('strong', null, x.symbol),
          l(x.name),
          num(x.shares, x.cls === 'cash' ? 0 : 0),
          x.cls === 'cash' ? '—' : money(x.price, 2),
          money(holdingValue(x)),
          pct(weightOf(x), 1),
          h('span', { class: `tone-${signTone(x.dayPct) ?? 'muted'}` }, pct(x.dayPct, 1, true)),
        ]),
        t('ho.list'),
      ),
      'holdings-list',
    ),
    h('p', { class: 'page-note' }, t('page.note')),
  );
}
