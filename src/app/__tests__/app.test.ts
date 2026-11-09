// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { LANGS } from '../../types';
import { destinations } from '../../data/destinations';
import { dict } from '../../i18n/dict';
import { getLang, setLang, t, onLangChange } from '../../i18n';
import { renderers } from '../../pages';
import { parseHash, formatHash } from '../router';
import * as mock from '../../data/mock';
import { butterflyOwner, getState } from '../state';
import type { AppState } from '../state';

describe('i18n', () => {
  it('has all three languages for every key', () => {
    for (const [key, row] of Object.entries(dict)) {
      expect(row.length, key).toBe(3);
      row.forEach((v, i) => {
        if (key === 'brand.local' && i === 1) return; // intentionally empty in English
        expect(v.trim().length, `${key}[${i}]`).toBeGreaterThan(0);
      });
    }
  });

  it('interpolates variables and notifies listeners', () => {
    const seen: string[] = [];
    const off = onLangChange((l) => seen.push(l));
    setLang('en');
    expect(t('toast.go', { x: 'Returns' })).toBe('Taking you to: Returns');
    setLang('zh');
    expect(t('toast.go', { x: '收益分析' })).toBe('带你查看：收益分析');
    expect(getLang()).toBe('zh');
    expect(seen).toEqual(['en', 'zh']);
    off();
  });
});

describe('router', () => {
  it('parses ids, anchors and invalid hashes', () => {
    expect(parseHash('#/').route.id).toBeNull();
    expect(parseHash('').valid).toBe(true);
    expect(parseHash('#/returns').route).toEqual({ id: 'returns', anchor: undefined });
    expect(parseHash('#/returns?a=benchmark').route.anchor).toBe('benchmark');
    expect(parseHash('#/returns?a=nope').route.anchor).toBeUndefined();
    expect(parseHash('#/bogus').valid).toBe(false);
    expect(formatHash({ id: 'risk', anchor: 'concentration' })).toBe('#/risk?a=concentration');
    expect(formatHash({ id: null })).toBe('#/');
  });
});

describe('mock data', () => {
  it('is internally consistent', () => {
    expect(mock.allocation.reduce((s, a) => s + a.pct, 0)).toBeCloseTo(100, 6);
    expect(mock.allocation.reduce((s, a) => s + a.value, 0)).toBeCloseTo(mock.totalAssets, 1);
    expect(mock.spendByCategory.reduce((s, c) => s + c.value, 0)).toBeCloseTo(mock.monthSpend, 1);
    expect(mock.monthlyAmount).toBe(750);
    expect(mock.nextRun.next).toBe('2026-11-13');
    expect(mock.daysUntil('2026-11-13')).toBe(4);
    expect(mock.lastBuy.symbol).toBe('NVDA');
    expect(mock.maxDrawdown.depthPct).toBeLessThan(0);
    expect(mock.techShare).toBeGreaterThan(mock.techLimit);
  });
});

describe('pages', () => {
  for (const lang of LANGS) {
    for (const d of destinations) {
      it(`${d.id} renders title + every anchor in ${lang}`, () => {
        setLang(lang);
        const el = renderers[d.id]();
        const title = el.querySelector('[data-perch="title"]');
        expect(title?.textContent).toContain(d.title[lang]);
        expect(title?.getAttribute('tabindex')).toBe('-1');
        for (const a of d.anchors) expect(el.querySelector(`[data-perch="${a}"]`), `${d.id}/${a}`).not.toBeNull();
      });
    }
  }
});

describe('butterfly owner', () => {
  const base: AppState = { ...getState(), route: null, overlay: 'none', center: { kind: 'capsules' }, tutorialLeads: false, pointCapsules: false };
  const own = (o: Partial<AppState>) => butterflyOwner({ ...base, ...o });
  it('derives overlay > page > centre prompt > home', () => {
    expect(own({})).toBe('home');
    expect(own({ center: { kind: 'nomatch', suggestions: [] } })).toBe('prompt');
    expect(own({ route: 'risk', center: { kind: 'nomatch', suggestions: [] } })).toBe('page');
    expect(own({ overlay: 'tutorial', route: 'risk' })).toBe('page'); // content navigated after the drawer opened
    expect(own({ overlay: 'tutorial', route: 'risk', tutorialLeads: true })).toBe('tutorial');
    expect(own({ overlay: 'wheel', route: 'risk', tutorialLeads: true })).toBe('wheel');
    expect(own({ pointCapsules: true })).toBe('capsules');
  });
});
