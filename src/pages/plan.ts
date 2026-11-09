import { h } from '../app/dom';
import { t, l, money, fmtDate } from '../i18n';
import { destinations } from '../data/destinations';
import { plans, nextRun, monthlyAmount, activePlans, daysUntil } from '../data/mock';
import { pageHeader, kpi, panel, badge, grid } from './widgets';

export function relDays(n: number): string {
  return n === 0 ? t('w.today0') : n === 1 ? t('w.tomorrow') : t('w.daysLater', { n });
}

export function renderPlan(): HTMLElement {
  const dest = destinations.find((d) => d.id === 'plan')!;
  const nextIso = nextRun.next as string;
  return h(
    'div',
    { class: 'page' },
    pageHeader(l(dest.title), l(dest.summary)),
    grid(
      2,
      kpi({
        big: true,
        perch: 'next-run',
        wrap: true,
        label: t('pl.next'),
        value: fmtDate(nextIso, 'weekday'),
        tone: 'gold',
        note: `${relDays(daysUntil(nextIso))} · ${nextRun.symbol} · ${money(nextRun.amount)}`,
      }),
      kpi({ big: true, perch: 'monthly-amount', label: t('pl.monthly'), value: money(monthlyAmount), note: t('pl.monthlyNote', { n: activePlans.length }) }),
    ),
    panel(
      t('pl.list'),
      h(
        'ul',
        { class: 'cards' },
        plans.map((p) =>
          h(
            'li',
            { class: `plan-item${p.active ? '' : ' is-paused'}` },
            h('div', { class: 'plan-main' }, h('strong', null, p.symbol), h('span', { class: 'muted' }, l(p.name))),
            h('div', { class: 'plan-meta' }, h('span', { class: 'num' }, t('pl.perRun', { x: money(p.amount) })), h('span', { class: 'muted' }, t('pl.monthlyDay', { d: p.dayOfMonth }))),
            h(
              'div',
              { class: 'plan-next' },
              p.active ? badge(t('w.active'), 'pos') : badge(t('w.paused'), 'muted'),
              h('span', { class: 'num' }, p.next ? `${t('w.nextRun')} ${fmtDate(p.next)}` : t('pl.pausedNote')),
            ),
          ),
        ),
      ),
      'plan-list',
    ),
    h('p', { class: 'page-note' }, t('page.note')),
  );
}
