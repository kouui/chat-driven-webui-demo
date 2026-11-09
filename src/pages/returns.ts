import { h } from '../app/dom';
import { t, l, pct, monthName } from '../i18n';
import { destinations } from '../data/destinations';
import { portfolioCum, benchmarkCum, ytdReturn, benchmarkReturn, excessReturn, bestMonth, worstMonth } from '../data/mock';
import { pageHeader, kpi, panel, lineChart, grid, signTone } from './widgets';

export function renderReturns(): HTMLElement {
  const dest = destinations.find((d) => d.id === 'returns')!;
  const labels = portfolioCum.map((_, i) => monthName(i));
  return h(
    'div',
    { class: 'page' },
    pageHeader(l(dest.title), l(dest.summary)),
    grid(
      3,
      kpi({ big: true, perch: 'return-ytd', label: t('rt.ytd'), value: pct(ytdReturn, 1, true), tone: signTone(ytdReturn), note: t('rt.ytdNote') }),
      kpi({
        big: true,
        perch: 'benchmark',
        label: `${t('rt.bench')} · ${t('rt.benchName')}`,
        value: pct(benchmarkReturn, 1, true),
        tone: signTone(benchmarkReturn),
        note: t('rt.excess', { x: `${excessReturn > 0 ? '+' : ''}${excessReturn.toFixed(1)} ${t('rt.pp')}` }),
      }),
      h(
        'div',
        { class: 'kpi kpi-stack' },
        h('div', { class: 'kpi-label' }, t('rt.best')),
        h('div', { class: 'kpi-value tone-pos sm' }, `${monthName(bestMonth.month)} ${pct(bestMonth.value, 1, true)}`),
        h('div', { class: 'kpi-label mt' }, t('rt.worst')),
        h('div', { class: 'kpi-value tone-neg sm' }, `${monthName(worstMonth.month)} ${pct(worstMonth.value, 1, true)}`),
      ),
    ),
    panel(
      t('rt.chart'),
      lineChart(
        [
          { name: t('w.portfolio'), color: '#F5C76A', values: portfolioCum },
          { name: t('rt.benchName'), color: '#7FA8FF', values: benchmarkCum, dashed: true },
        ],
        labels,
        { aria: t('rt.chartAria'), fmt: (v) => pct(v, 0, true), legendFmt: (v) => pct(v, 1, true), zeroLine: true },
      ),
      'return-chart',
    ),
    h('p', { class: 'page-note' }, t('page.note')),
  );
}
