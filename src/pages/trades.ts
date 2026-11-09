import { h, clear } from '../app/dom';
import { t, l, money, num, fmtDate } from '../i18n';
import { destinations } from '../data/destinations';
import { holdings, trades, tradeAmount, lastBuy } from '../data/mock';
import { pageHeader, kpi, panel, table, badge, grid } from './widgets';

type Filter = 'all' | 'buy' | 'sell';
let filter: Filter = 'all'; // survives language re-renders

function tradeTable(): HTMLElement {
  const rows = trades.filter((x) => filter === 'all' || x.side === filter);
  if (!rows.length) return h('p', { class: 'muted' }, t('tr.empty'));
  return table(
    [{ text: t('w.date') }, { text: t('w.side') }, { text: t('w.symbol') }, { text: t('w.shares'), num: true }, { text: t('w.price'), num: true }, { text: t('w.amount'), num: true }, { text: t('w.type') }],
    rows.map((x) => [
      fmtDate(x.date),
      badge(t(x.side === 'buy' ? 'w.buy' : 'w.sell'), x.side === 'buy' ? 'pos' : 'neg'),
      h('strong', null, x.symbol),
      num(x.qty, x.qty % 1 === 0 ? 0 : 3),
      money(x.price, 2),
      money(tradeAmount(x), 2),
      t(x.auto ? 'w.auto' : 'w.manual'),
    ]),
    t('tr.list'),
  );
}

export function renderTrades(): HTMLElement {
  const dest = destinations.find((d) => d.id === 'trades')!;
  const holder = h('div', { class: 'tbl-holder' }, tradeTable());
  const chips = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': t('tr.filter') },
    (['all', 'buy', 'sell'] as Filter[]).map((f) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(filter === f),
          onclick: (e: Event) => {
            filter = f;
            chips.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
            clear(holder);
            holder.append(tradeTable());
          },
        },
        t(f === 'all' ? 'w.all' : f === 'buy' ? 'w.buy' : 'w.sell'),
      ),
    ),
  );
  const name = holdings.find((x) => x.symbol === lastBuy.symbol);
  return h(
    'div',
    { class: 'page' },
    pageHeader(l(dest.title), l(dest.summary)),
    grid(
      2,
      kpi({
        big: true,
        perch: 'last-buy',
        wrap: true,
        label: t('tr.lastBuy'),
        value: `${lastBuy.symbol} · ${fmtDate(lastBuy.date, 'weekday')}`,
        tone: 'gold',
        note: `${t('tr.lastBuyNote', { n: num(lastBuy.qty, lastBuy.qty % 1 === 0 ? 0 : 3), p: money(lastBuy.price, 2) })} · ${money(tradeAmount(lastBuy), 2)}${name ? ` · ${l(name.name)}` : ''}`,
      }),
      kpi({ big: true, label: t('w.filled'), value: String(trades.length), note: `${fmtDate(trades[trades.length - 1].date)} – ${fmtDate(trades[0].date)}` }),
    ),
    panel(t('tr.list'), h('div', null, chips, holder), 'trade-list'),
    h('p', { class: 'page-note' }, t('page.note')),
  );
}
