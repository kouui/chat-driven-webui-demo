import { h } from '../app/dom';
import { t, l, money, pct, signedMoney, fmtDate } from '../i18n';
import { destinations } from '../data/destinations';
import { DEMO_DATE, totalAssets, todayChange, allocation, netWorthSeries, ytdReturn } from '../data/mock';
import { pageHeader, kpi, panel, donut, sparkline, grid, CLS_COLOR, signTone } from './widgets';

export function renderOverview(): HTMLElement {
  const dest = destinations.find((d) => d.id === 'overview')!;
  const tone = signTone(todayChange.amount);
  return h(
    'div',
    { class: 'page' },
    pageHeader(l(dest.title), `${l(dest.summary)} · ${t('page.asof', { d: fmtDate(DEMO_DATE, 'long') })}`),
    grid(
      2,
      kpi({
        big: true,
        perch: 'total-assets',
        label: t('ov.total'),
        value: money(totalAssets, 2),
        tone: 'gold',
        note: `${t('ov.ytd')} ${pct(ytdReturn, 1, true)}`,
        extra: h('div', { class: 'kpi-spark' }, sparkline(netWorthSeries, t('ov.trendAria')), h('div', { class: 'kpi-note' }, t('ov.trend'))),
      }),
      kpi({
        big: true,
        perch: 'today-change',
        label: t('ov.today'),
        value: signedMoney(todayChange.amount),
        tone,
        note: `${pct(todayChange.pct, 2, true)} · ${t('ov.todayNote')}`,
      }),
    ),
    panel(
      t('ov.allocation'),
      donut(
        allocation.map((a) => ({ label: t(`cls.${a.cls}`), value: a.value, color: CLS_COLOR[a.cls] })),
        {
          aria: t('ov.allocAria'),
          centerLabel: t('ov.total'),
          centerValue: `$${Math.round(totalAssets / 1000)}k`,
          legend: (sl, p) => h('span', { class: 'legend-text' }, h('span', { class: 'legend-name' }, sl.label), h('span', { class: 'legend-val num' }, `${pct(p, 1)} · ${money(sl.value)}`)),
        },
      ),
      'allocation',
    ),
    h('p', { class: 'page-note' }, t('page.note')),
  );
}
