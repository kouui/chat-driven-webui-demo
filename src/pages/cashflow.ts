import { h } from '../app/dom';
import { t, l, money, pct, signedMoney, fmtDate } from '../i18n';
import { destinations } from '../data/destinations';
import { monthSpend, monthIncome, monthNet, lastMonthSameDaysSpend, monthBudget, spendByCategory, topCategory, dailySpend, transactions } from '../data/mock';
import { pageHeader, kpi, panel, table, barRow, barChart, grid, signTone } from './widgets';

export function renderCashflow(): HTMLElement {
  const dest = destinations.find((d) => d.id === 'cashflow')!;
  const vsLast = ((monthSpend - lastMonthSameDaysSpend) / lastMonthSameDaysSpend) * 100;
  const maxCat = spendByCategory[0].value;
  const recent = transactions.slice(0, 8);
  return h(
    'div',
    { class: 'page' },
    pageHeader(l(dest.title), `${l(dest.summary)} · ${t('cf.range')}`),
    grid(
      3,
      kpi({
        perch: 'month-spend',
        label: t('cf.monthSpend'),
        value: money(monthSpend, 2),
        tone: 'gold',
        note: t('cf.vsLast', { x: pct(vsLast, 1, true) }),
      }),
      kpi({ label: t('cf.income'), value: money(monthIncome, 2), tone: 'pos', note: t('cf.budget', { x: money(monthBudget), p: pct((monthSpend / monthBudget) * 100, 0) }) }),
      kpi({ label: t('cf.net'), value: signedMoney(monthNet), tone: signTone(monthNet) }),
    ),
    h(
      'div',
      { class: 'grid grid-2 grid-top' },
      panel(
        t('cf.topCat'),
        h(
          'div',
          null,
          h('div', { class: 'kpi-value tone-gold', 'data-perch': 'top-category' }, `${t(`cat.${topCategory.cat}`)} · ${money(topCategory.value, 2)}`),
          h('div', { class: 'kpi-note' }, t('cf.topCatShare', { p: pct(topCategory.pct, 0) })),
          h('h4', { class: 'sub-title' }, t('cf.byCat')),
          h('ul', { class: 'barlist' }, spendByCategory.map((c, i) => barRow(t(`cat.${c.cat}`), money(c.value, 2), (c.value / maxCat) * 100, i === 0))),
        ),
      ),
      panel(
        t('cf.daily'),
        barChart(
          dailySpend.map((d) => ({ label: String(Number(d.date.slice(8))), value: d.value, hi: d.value === Math.max(...dailySpend.map((x) => x.value)) })),
          { aria: t('cf.dailyAria'), fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))) },
        ),
      ),
    ),
    panel(
      t('cf.recent'),
      table(
        [{ text: t('w.date') }, { text: t('w.merchant') }, { text: t('w.category') }, { text: t('w.amount'), num: true }],
        recent.map((x) => [
          fmtDate(x.date),
          l(x.merchant),
          t(`cat.${x.category}`),
          h('span', { class: x.amount > 0 ? 'tone-pos' : '' }, signedMoney(x.amount)),
        ]),
        t('cf.recent'),
      ),
      'recent-tx',
    ),
    h('p', { class: 'page-note' }, t('page.note')),
  );
}
