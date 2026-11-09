import { h } from '../app/dom';
import { t, l, pct, monthName } from '../i18n';
import { destinations } from '../data/destinations';
import { techShare, techLimit, top3Share, volatility, benchmarkVolatility, beta, maxDrawdown } from '../data/mock';
import { pageHeader, kpi, panel, meter, badge, grid } from './widgets';

export function renderRisk(): HTMLElement {
  const dest = destinations.find((d) => d.id === 'risk')!;
  const over = techShare > techLimit;
  const dd = maxDrawdown;
  const ddNote =
    dd.recoverMonth === null
      ? t('rk.ddNoRecover', { a: monthName(dd.peakMonth), b: monthName(dd.troughMonth) })
      : t('rk.ddNote', { a: monthName(dd.peakMonth), b: monthName(dd.troughMonth), c: monthName(dd.recoverMonth) });
  const volMax = Math.max(volatility, benchmarkVolatility) * 1.25;
  return h(
    'div',
    { class: 'page' },
    pageHeader(l(dest.title), l(dest.summary)),
    grid(
      3,
      kpi({ label: t('rk.level'), value: t('rk.levelValue'), tone: 'warn', note: t('rk.levelNote') }),
      kpi({ label: t('rk.beta'), value: beta.toFixed(2), note: t('rk.volNote', { x: '1.00' }) }),
      kpi({ label: t('rk.top3'), value: pct(top3Share, 1), note: t('rk.top3Note') }),
    ),
    grid(
      3,
      h(
        'div',
        { class: 'kpi risk-tile' },
        h('div', { class: 'kpi-label' }, t('rk.concentration')),
        h('div', { class: `kpi-value ${over ? 'tone-warn' : 'tone-pos'}`, 'data-perch': 'concentration' }, pct(techShare, 1)),
        meter(techShare, { max: 60, limit: techLimit, tone: over ? 'warn' : 'gold', aria: t('rk.concentration') }),
        h('div', { class: 'kpi-note' }, over ? badge(t('rk.concOver', { x: pct(techLimit, 0) }), 'warn') : badge(t('w.ok'), 'pos')),
        h('div', { class: 'kpi-note' }, t('rk.concNote')),
      ),
      h(
        'div',
        { class: 'kpi risk-tile' },
        h('div', { class: 'kpi-label' }, t('rk.volatility')),
        h('div', { class: 'kpi-value', 'data-perch': 'volatility' }, pct(volatility, 1)),
        meter(volatility, { max: volMax, tone: 'gold', aria: t('rk.volAria') }),
        h('div', { class: 'kpi-note' }, t('rk.volNote', { x: pct(benchmarkVolatility, 1) })),
        meter(benchmarkVolatility, { max: volMax, tone: 'pos', aria: t('rt.benchName') }),
      ),
      h(
        'div',
        { class: 'kpi risk-tile' },
        h('div', { class: 'kpi-label' }, t('rk.drawdown')),
        h('div', { class: 'kpi-value tone-neg', 'data-perch': 'drawdown' }, pct(dd.depthPct, 1)),
        meter(Math.abs(dd.depthPct), { max: 20, tone: 'warn', aria: t('rk.drawdown') }),
        h('div', { class: 'kpi-note' }, ddNote),
      ),
    ),
    panel(t('rk.watch'), h('ul', { class: 'bullets' }, h('li', null, t('rk.w1')), h('li', null, t('rk.w2')), h('li', null, t('rk.w3')))),
    h('p', { class: 'page-note' }, t('page.note')),
  );
}
