import { describe, expect, it } from 'vitest';
import { destinations, systemIntents } from '../data/destinations';
import { LANGS } from '../types';
import type { DestId, MatchResult, TargetId } from '../types';
import { normalize } from './normalize';
import { createMatcher } from './index';

const matcher = createMatcher(destinations, systemIntents);
const run = (q: string, ui: 'zh' | 'en' | 'ja' = 'zh'): MatchResult => matcher.match(q, ui);
const top = (r: MatchResult) => (r.status === 'confident' ? r.best : r.candidates[0]);
const topId = (r: MatchResult) => top(r)?.target.id;

/** Every phrase/title/capsule text in the data, normalised: paraphrase tests must not reuse them. */
const verbatim = new Set<string>();
for (const d of destinations) {
  for (const l of LANGS) {
    verbatim.add(normalize(d.title[l]));
    d.phrases[l].forEach((p) => verbatim.add(normalize(p)));
    d.anchorIntents.forEach((a) => a.phrases[l].forEach((p) => verbatim.add(normalize(p))));
    d.capsules.forEach((c) => verbatim.add(normalize(c.text[l])));
    d.followUps.forEach((c) => verbatim.add(normalize(c.text[l])));
  }
}
for (const s of systemIntents) for (const l of LANGS) s.phrases[l].forEach((p) => verbatim.add(normalize(p)));

// Paraphrases (colloquial, NOT in the data). Each must land on its destination.
const PARAPHRASES: Record<DestId, { zh: string[]; en: string[]; ja: string[] }> = {
  overview: {
    zh: ['整体账户怎么样', '我的净资产是多少', '总览', '帮我看下我手头一共多少资产', '账户余额大概多少'],
    en: ['give me an overview', 'tell me my net worth', 'net worth please', 'how much am i worth right now', 'total assets'],
    ja: ['資産の概要を見せて', '総資産を知りたい', '純資産はいくら', '資産全体を見たい', '今の総資産'],
  },
  cashflow: {
    zh: ['这个月开销有多大', '最近收入和支出', '给我看看流水', '本月花销', '我是不是又剁手了'],
    en: ['how much have i spent on food', 'recent cash flow', 'monthly expenses', 'show my income', 'what are my bills this month'],
    ja: ['今月の出費を教えて', '支出を確認', '家計の収支を見せて', '最近の収入', '使いすぎてない'],
  },
  holdings: {
    zh: ['我有什么股票', '我手上的基金有哪些', '目前的仓位', '持有哪些标的', '看一下持仓'],
    en: ['what stocks do i have', 'list my positions', 'which etfs do i hold', 'show holdings', 'what shares do i own'],
    ja: ['持っている銘柄を教えて', '保有株を確認したい', 'どんなETFを持ってる', '保有銘柄', '株は何を持ってますか'],
  },
  returns: {
    zh: ['今年亏了还是赚了', '投资回报如何', '看看盈亏', '赚了多少', '收益率怎么样'],
    en: ['am i profitable', 'how much profit did i make', 'show me my gains and losses', 'what are my returns', 'investment performance'],
    ja: ['収益はどのくらい', '損益はどうなってる', '運用の利回りを教えて', 'いくら儲かってる', '利益を確認'],
  },
  risk: {
    zh: ['我的仓位安全吗', '有没有爆雷的风险', '投资组合风险评估一下', '风险大吗', '做个风险体检'],
    en: ['how risky is my portfolio', 'is my money safe', 'any danger in my investments', 'run a risk check', 'am i taking too much risk'],
    ja: ['リスクはありますか', '危険な投資になってない', '投資の安全度を診断して', 'リスクを教えて', '危ない状態？'],
  },
  plan: {
    zh: ['每月定投多少', '我设置了哪些自动扣款', '看看定投设置', '基金定投的情况', '定期定额还在扣吗'],
    en: ['show my dca plans', 'my recurring investment plans', 'when does my auto invest run', 'monthly auto invest amount', 'dollar cost averaging setup'],
    ja: ['積立の設定を見たい', '毎月の自動積立はいくら', 'つみたての次回はいつ', '積立プランを教えて', '積立の状況'],
  },
  trades: {
    zh: ['最近买了什么', '我卖出过什么', '查看成交', '看下委托记录', '这周下过哪些单'],
    en: ['what did i buy recently', 'show me my past orders', 'recent sells', 'my buy and sell history', 'what trades did i make'],
    ja: ['最近の売買を見せて', '注文の履歴を確認', '何を売った', '約定を確認したい', '取引を見たい'],
  },
};

describe('data sanity', () => {
  it('has the 7 destinations with contract ids and anchors', () => {
    expect(destinations.map((d) => d.id)).toEqual(['overview', 'cashflow', 'holdings', 'returns', 'risk', 'plan', 'trades']);
    const anchors: Record<string, string[]> = {
      overview: ['total-assets', 'today-change', 'allocation'],
      cashflow: ['month-spend', 'top-category', 'recent-tx'],
      holdings: ['holdings-list', 'top-holding'],
      returns: ['return-ytd', 'return-chart', 'benchmark'],
      risk: ['concentration', 'volatility', 'drawdown'],
      plan: ['next-run', 'monthly-amount', 'plan-list'],
      trades: ['last-buy', 'trade-list'],
    };
    for (const d of destinations) {
      expect(d.anchors).toEqual(anchors[d.id]);
      expect(d.anchorIntents.map((a) => a.anchor)).toEqual(d.anchors);
      expect(d.capsules.length).toBeGreaterThanOrEqual(3);
      expect(d.followUps).toHaveLength(2);
      for (const f of d.followUps) expect(f.target.id).not.toBe(d.id);
      for (const l of LANGS) {
        expect(d.phrases[l].length).toBeGreaterThanOrEqual(6);
        expect(d.title[l]).toBeTruthy();
        expect(d.summary[l]).toBeTruthy();
        for (const a of d.anchorIntents) expect(a.phrases[l].length).toBeGreaterThanOrEqual(3);
      }
      for (const c of [...d.capsules, ...d.followUps]) {
        const target = destinations.find((x) => x.id === c.target.id);
        if (target && c.target.anchor) expect(target.anchors).toContain(c.target.anchor);
      }
    }
    expect(systemIntents.map((s) => s.id)).toEqual(['sys:home', 'sys:wheel', 'sys:tutorial']);
  });

  it('paraphrase fixtures are not verbatim data', () => {
    for (const set of Object.values(PARAPHRASES)) {
      for (const l of LANGS) for (const q of set[l]) expect(verbatim.has(normalize(q)), q).toBe(false);
    }
  });

  it('every capsule text matches its own target', () => {
    for (const d of destinations) {
      for (const c of d.capsules) {
        for (const l of LANGS) {
          const r = run(c.text[l], l);
          expect(topId(r), `${l}: ${c.text[l]}`).toBe(d.id);
        }
      }
    }
  });
});

describe('destination paraphrases', () => {
  const stats = { total: 0, confident: 0 };
  for (const [id, set] of Object.entries(PARAPHRASES) as [DestId, (typeof PARAPHRASES)[DestId]][]) {
    for (const l of LANGS) {
      it(`${id} / ${l}`, () => {
        for (const q of set[l]) {
          const r = run(q, l);
          stats.total++;
          if (r.status === 'confident') stats.confident++;
          expect(r.status, `${q} -> ${JSON.stringify(r.candidates.map((c) => c.target.id))}`).not.toBe('none');
          expect(topId(r), `${q} (${JSON.stringify(r.candidates.map((c) => [c.target.id, c.score, c.reason]))})`).toBe(id);
        }
      });
    }
  }
  it('most paraphrases are confident (not just top-1 of an ambiguity)', () => {
    expect(stats.confident / stats.total).toBeGreaterThan(0.75);
  });
});

describe('single-word queries', () => {
  const cases: [string, DestId][] = [
    ['收益', 'returns'], ['风险', 'risk'], ['持仓', 'holdings'], ['定投', 'plan'], ['流水', 'cashflow'],
    ['总览', 'overview'], ['交易', 'trades'], ['returns', 'returns'], ['risk', 'risk'], ['holdings', 'holdings'],
    ['overview', 'overview'], ['trades', 'trades'], ['リスク', 'risk'], ['積立', 'plan'], ['収支', 'cashflow'],
    ['運用成績', 'returns'], ['取引履歴', 'trades'],
  ];
  for (const [q, id] of cases) {
    it(`${q} -> ${id}`, () => {
      const r = run(q);
      expect(r.status).toBe('confident');
      expect(topId(r)).toBe(id);
    });
  }
});

describe('anchors', () => {
  const cases: [string, TargetId, string][] = [
    ['我现在一共有多少钱', 'overview', 'total-assets'],
    ['今天是涨还是跌', 'overview', 'today-change'],
    ['我的资产配置比例', 'overview', 'allocation'],
    ['会不会太集中在一只股票上', 'risk', 'concentration'],
    ['what is the max drawdown', 'risk', 'drawdown'],
    ['ボラティリティは高い', 'risk', 'volatility'],
    ['下一次扣款是几号', 'plan', 'next-run'],
    ['每个月定投金额', 'plan', 'monthly-amount'],
    ['最近一次买入是什么时候', 'trades', 'last-buy'],
    ['when was the last time i bought', 'trades', 'last-buy'],
    ['am i beating the benchmark', 'returns', 'benchmark'],
    ['今年到现在收益多少', 'returns', 'return-ytd'],
    ['上个月的支出总共多少', 'cashflow', 'month-spend'],
    ['最大的开销是哪一类', 'cashflow', 'top-category'],
    ['最大持仓是哪只', 'holdings', 'top-holding'],
    ['下次什么时候扣钱', 'plan', 'next-run'],
  ];
  for (const [q, id, anchor] of cases) {
    it(`${q} -> ${id}#${anchor}`, () => {
      const r = run(q);
      expect(r.status, JSON.stringify(r.candidates)).toBe('confident');
      if (r.status === 'confident') {
        expect(r.best.target).toEqual({ id, anchor });
      }
    });
  }

  it('a vague allocation question still ranks Overview first', () => {
    expect(topId(run('各类资产的占比是多少'))).toBe('overview');
  });

  it('falls back to the title anchor when no anchor clears its threshold', () => {
    const r = run('收益分析');
    expect(r.status).toBe('confident');
    if (r.status === 'confident') expect(r.best.target).toEqual({ id: 'returns', anchor: 'title' });
    const r2 = run('show my holdings');
    if (r2.status === 'confident') expect(r2.best.target.anchor).toBe('title');
  });

  it('every anchor phrase in the data resolves to its own anchor', () => {
    for (const d of destinations) {
      for (const a of d.anchorIntents) {
        for (const l of LANGS) {
          for (const p of a.phrases[l]) {
            const r = run(p, l);
            expect(topId(r), p).toBe(d.id);
            expect(top(r)?.target.anchor, p).toBe(a.anchor);
          }
        }
      }
    }
  });
});

describe('system intents', () => {
  const cases: [string, TargetId][] = [
    ['打开轮盘', 'sys:wheel'], ['open the wheel menu', 'sys:wheel'], ['ホイールを出して', 'sys:wheel'], ['把转盘打开', 'sys:wheel'],
    ['教程', 'sys:tutorial'], ['tutorial', 'sys:tutorial'], ['チュートリアルを見せて', 'sys:tutorial'], ['想看新手教程', 'sys:tutorial'],
    ['回首页', 'sys:home'], ['go home', 'sys:home'], ['ホームに戻る', 'sys:home'], ['回到主页去', 'sys:home'],
  ];
  for (const [q, id] of cases) {
    it(`${q} -> ${id}`, () => {
      const r = run(q);
      expect(r.status).toBe('confident');
      expect(topId(r)).toBe(id);
      expect(top(r)?.target.anchor).toBeUndefined();
    });
  }
  it('generic "help" inside a page request does not hijack it', () => {
    const r = run('help me see my returns', 'en');
    expect(r.status).toBe('confident');
    expect(topId(r)).toBe('returns');
  });
});

describe('no match', () => {
  for (const q of ['天气怎么样', 'tell me a joke', '今日の天気', '明天吃什么', 'what time is it', '你好', 'asdfgh', 'こんにちは']) {
    it(`${q}`, () => {
      const r = run(q);
      expect(r.status).toBe('none');
    });
  }
  it('empty / whitespace / punctuation-only input', () => {
    for (const q of ['', '   ', '\n\t', '？！。。', '...']) {
      const r = run(q);
      expect(r.status).toBe('none');
      expect(r.candidates).toEqual([]);
    }
  });
  it('only stop words -> none', () => {
    for (const q of ['看看', '请问', 'show me', '見せて']) expect(run(q).status).toBe('none');
  });
});

describe('negation and compound requests', () => {
  it('"not X, want Y" goes to Y (or at worst lists Y first), never to X', () => {
    const cases: [string, DestId, DestId][] = [
      ['不要看收益，想看持仓', 'holdings', 'returns'],
      ['别看风险，帮我看看收益', 'returns', 'risk'],
      ['not returns, show holdings', 'holdings', 'returns'],
      ["don't show risk, show my trades", 'trades', 'risk'],
      ['収益じゃなくて、保有資産を見せて', 'holdings', 'returns'],
      ['リスクではなく積立プランを見たい', 'plan', 'risk'],
    ];
    for (const [q, want, not] of cases) {
      const r = run(q);
      expect(topId(r), q).toBe(want);
      expect(r.candidates.some((c) => c.target.id === not), q).toBe(false);
    }
  });
  it('a purely negated request never jumps to the negated page', () => {
    for (const q of ['不要看收益', "don't show returns", '収益じゃなくて']) {
      const r = run(q);
      expect(r.status, q).not.toBe('confident');
      expect(r.candidates.some((c) => c.target.id === 'returns'), q).toBe(false);
    }
  });
  it('"是不是" (question form) is not treated as negation', () => {
    const r = run('是不是太集中在科技股');
    expect(r.status).toBe('confident');
    expect(topId(r)).toBe('risk');
  });
  it('compound requests are ambiguous with both pages offered', () => {
    for (const q of ['看看收益和风险', 'show my returns and holdings', '持仓和交易']) {
      const r = run(q);
      expect(r.status, q).toBe('ambiguous');
      expect(new Set(r.candidates.map((c) => c.target.id)).size).toBe(r.candidates.length);
    }
  });
  it('vague queries are ambiguous or none, never confident', () => {
    for (const q of ['看看最近情况', 'how are things', '最近どう']) {
      expect(run(q).status, q).not.toBe('confident');
    }
  });
});

describe('navigation verb "return" vs the Returns page', () => {
  it('"return home" style requests go to sys:home', () => {
    for (const q of [
      'return home', 'Return to home', 'return to the home page', 'please return back', 'return to the main screen',
      'go back', 'take me back home', 'I want to return to the start', 'can you return me to the beginning',
    ]) {
      const r = run(q, 'en');
      expect(r.status, q).toBe('confident');
      expect(topId(r), q).toBe('sys:home');
    }
  });
  it('the financial noun still reaches Returns', () => {
    for (const q of ['show my returns', 'how are my returns', 'return on investment', 'what is my rate of return', 'my total return this year', 'returns this year']) {
      const r = run(q, 'en');
      expect(r.status, q).toBe('confident');
      expect(topId(r), q).toBe('returns');
    }
  });
  it('"go back to <page>" still prefers the named page', () => {
    expect(topId(run('go back to my holdings', 'en'))).toBe('holdings');
  });
});

describe('negation variants (ja / zh / en)', () => {
  const switched: [string, DestId, DestId][] = [
    // ja
    ['収益はいいから保有を見せて', 'holdings', 'returns'],
    ['リスクはもういい、積立プランを見たい', 'plan', 'risk'],
    ['収益以外で保有を見せて', 'holdings', 'returns'],
    ['リスクはいらないので取引履歴を見せて', 'trades', 'risk'],
    ['収益を見たくない、保有資産を見せて', 'holdings', 'returns'],
    ['リスクは見ないで、積立の設定を教えて', 'plan', 'risk'],
    ['収益ではなくて保有資産を見せて', 'holdings', 'returns'],
    // zh
    ['不用看收益，看持仓', 'holdings', 'returns'],
    ['先别看风险，看看收益', 'returns', 'risk'],
    ['不看风险，看定投', 'plan', 'risk'],
    ['別看風險，看持仓', 'holdings', 'risk'],
    ['收益用不着看，看持仓', 'holdings', 'returns'],
    ['不必看交易记录，看看收益', 'returns', 'trades'],
    ['我想看收益，不用看风险', 'returns', 'risk'],
    // en
    ['skip returns, show holdings', 'holdings', 'returns'],
    ['not interested in risk, show my trades', 'trades', 'risk'],
    ['returns can wait, show holdings', 'holdings', 'returns'],
    ['show holdings but returns can wait', 'holdings', 'returns'],
    ['ignore risk and show my dca plans', 'plan', 'risk'],
    ['the risk page is not needed, show trades', 'trades', 'risk'],
  ];
  for (const [q, want, not] of switched) {
    it(`${q} -> ${want}, never ${not}`, () => {
      const r = run(q);
      expect(topId(r), q).toBe(want);
      expect(r.candidates.some((c) => c.target.id === not), q).toBe(false);
    });
  }
  it('"はいい" as a question is a positive request, as a statement a refusal', () => {
    const asked: [string, DestId][] = [
      ['収益はいいですか', 'returns'], ['リスクはいいの？', 'risk'], ['成績はいいかな', 'returns'],
      ['収益はいい？', 'returns'], ['リスクはいいですか？', 'risk'], ['成績はいいですかね', 'returns'],
      ['保有はいいかしら', 'holdings'], ['積立はいいの', 'plan'],
    ];
    for (const [q, id] of asked) expect(topId(run(q, 'ja')), q).toBe(id);
    for (const [q, id] of [['収益はいいです', 'returns'], ['リスクはいい', 'risk'], ['収益はもういい', 'returns']] as const) {
      const r = run(q, 'ja');
      expect(r.status, q).not.toBe('confident');
      expect(r.candidates.some((c) => c.target.id === id), q).toBe(false);
    }
  });
  it('purely negated requests never navigate to or suggest the negated page', () => {
    const cases: [string, DestId][] = [
      ['リスクを見たくない', 'risk'], ['リスクは見ない', 'risk'], ['リスクを見ない', 'risk'], ['収益はいらない', 'returns'],
      ['リスクはいいです', 'risk'], ['収益は結構です', 'returns'],
      ['不用看收益', 'returns'], ['先别看风险', 'risk'], ['风险我先不看', 'risk'], ['別看風險', 'risk'], ['收益用不着', 'returns'],
      ['skip returns', 'returns'], ['not interested in risk', 'risk'], ['returns can wait', 'returns'], ['ignore the risk page', 'risk'],
    ];
    for (const [q, not] of cases) {
      const r = run(q);
      expect(r.status, q).not.toBe('confident');
      expect(r.candidates.some((c) => c.target.id === not), q).toBe(false);
    }
  });
  it('words that merely look like negators do not negate', () => {
    expect(topId(run('skip to the returns page', 'en'))).toBe('returns');
    expect(topId(run('i can wait for my returns', 'en'))).toBe('returns');
    expect(topId(run('別の銘柄を見せて'))).toBe('holdings');
    expect(topId(run('特别想看收益'))).toBe('returns');
  });
});

describe('negating an answer does not exclude its page', () => {
  it('another anchor of the same page can still be requested', () => {
    const cases: [string, TargetId, string][] = [
      ['不要看总资产，我只看资产配比', 'overview', 'allocation'],
      ['别看净资产，看看资产配置比例', 'overview', 'allocation'],
      ['总资产就不看了，今天涨了还是跌了', 'overview', 'today-change'],
      ["don't show total assets, show allocation", 'overview', 'allocation'],
      ['skip total assets, show asset mix', 'overview', 'allocation'],
      ['総資産は見たくない、資産配分を見せて', 'overview', 'allocation'],
      ['不要看最大持仓，看看持仓列表', 'holdings', 'holdings-list'],
    ];
    for (const [q, id, anchor] of cases) {
      const r = run(q);
      expect(r.status, `${q} ${JSON.stringify(r.candidates)}`).toBe('confident');
      if (r.status === 'confident') expect(r.best.target, q).toEqual({ id, anchor });
    }
  });
  it('an answer cue plus the page\'s own vocabulary still only blocks that answer', () => {
    const cases: [string, 'zh' | 'en' | 'ja', TargetId, string, string][] = [
      ['不要看收益走势，看看基准对比', 'zh', 'returns', 'benchmark', 'return-chart'],
      ['不要看收益走势，看看今年赚了多少', 'zh', 'returns', 'return-ytd', 'return-chart'],
      ["don't show the returns chart, show the benchmark", 'en', 'returns', 'benchmark', 'return-chart'],
      ['skip the performance trend, did i beat the market', 'en', 'returns', 'benchmark', 'return-chart'],
      ['収益の推移は見たくない、ベンチマークと比べて', 'ja', 'returns', 'benchmark', 'return-chart'],
      ['不要看风险集中度，看看最大回撤', 'zh', 'risk', 'drawdown', 'concentration'],
      ["don't show risk drawdown, show concentration", 'en', 'risk', 'concentration', 'drawdown'],
      ['不要看上一笔交易，看看全部交易记录', 'zh', 'trades', 'trade-list', 'last-buy'],
    ];
    for (const [q, ui, id, want, not] of cases) {
      const r = run(q, ui);
      expect(r.status, `${q} ${JSON.stringify(r.candidates)}`).toBe('confident');
      if (r.status === 'confident') {
        expect(r.best.target.id, q).toBe(id);
        expect(r.best.target.anchor, q).toBe(want);
        expect(r.best.target.anchor, q).not.toBe(not);
      }
    }
  });
  it('a page name alone (no answer cue) still excludes the whole page', () => {
    for (const [q, ui, id] of [['不要看收益', 'zh', 'returns'], ["don't show returns", 'en', 'returns'], ['リスクは見たくない', 'ja', 'risk']] as const) {
      expect(run(q, ui).candidates.some((c) => c.target.id === id), q).toBe(false);
    }
  });
  it('the negated anchor itself is never chosen', () => {
    const r = run('不要看总资产，今天涨了还是跌了');
    expect(top(r)?.target.anchor).not.toBe('total-assets');
    const r2 = run('不要看总资产');
    expect(r2.status).not.toBe('confident');
  });
  it('negating the page itself still excludes the whole page', () => {
    for (const q of ['不要看总览，看持仓', "don't show the overview, show holdings"]) {
      const r = run(q);
      expect(topId(r), q).toBe('holdings');
      expect(r.candidates.some((c) => c.target.id === 'overview'), q).toBe(false);
    }
  });
});

describe('exact phrase precedence', () => {
  it('every capsule text (all languages) resolves confidently to its own target and anchor', () => {
    for (const d of destinations) {
      for (const c of d.capsules) {
        for (const l of LANGS) {
          for (const ui of LANGS) {
            const r = run(c.text[l], ui);
            expect(r.status, `${l}/${ui}: ${c.text[l]} ${JSON.stringify(r.candidates)}`).toBe('confident');
            if (r.status !== 'confident') continue;
            expect(r.best.target.id, c.text[l]).toBe(c.target.id);
            expect(r.best.target.anchor, c.text[l]).toBe(c.target.anchor ?? 'title');
          }
        }
      }
    }
  });
  it('a unique exact phrase beats containment evidence for another page', () => {
    const r = run('今いくら持ってる？', 'ja');
    expect(r.status).toBe('confident');
    if (r.status === 'confident') expect(r.best.target).toEqual({ id: 'overview', anchor: 'total-assets' });
    // same shape in other languages: a known phrase that contains another page's keywords
    for (const [q, id] of [['income and expenses', 'cashflow'], ['where does my money go', 'cashflow']] as const) {
      const rr = run(q, 'en');
      expect(rr.status, q).toBe('confident');
      expect(topId(rr), q).toBe(id);
    }
  });
});

describe('anchor resolution for paraphrases', () => {
  const cases: [string, TargetId, string][] = [
    ['手头一共还有多少钱', 'overview', 'total-assets'],
    ['how much am i worth in total', 'overview', 'total-assets'],
    ['昨天到现在涨了还是跌了', 'overview', 'today-change'],
    ['股票债券各占几成', 'overview', 'allocation'],
    ['how much did i spend last month', 'cashflow', 'month-spend'],
    ['下个扣款日是哪天', 'plan', 'next-run'],
    ['when is the next auto invest run', 'plan', 'next-run'],
    ['どのくらい集中してる？', 'risk', 'concentration'],
    ['今年迄今の収益はいくら', 'returns', 'return-ytd'],
  ];
  for (const [q, id, anchor] of cases) {
    it(`${q} -> ${id}#${anchor}`, () => {
      const r = run(q);
      expect(topId(r), JSON.stringify(r.candidates)).toBe(id);
      expect(top(r)?.target.anchor, JSON.stringify(r.candidates)).toBe(anchor);
    });
  }
});

describe('result shape', () => {
  it('ambiguous has 2..3 candidates from different targets, sorted by score', () => {
    const r = run('收益和风险');
    expect(r.status).toBe('ambiguous');
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.candidates.length).toBeLessThanOrEqual(3);
    const ids = r.candidates.map((c) => c.target.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < r.candidates.length; i++) expect(r.candidates[i - 1]!.score).toBeGreaterThanOrEqual(r.candidates[i]!.score);
  });
  it('confident puts best first with label, reason and a 0..1 score', () => {
    const r = run('我的收益怎么样');
    expect(r.status).toBe('confident');
    if (r.status !== 'confident') return;
    expect(r.candidates[0]).toBe(r.best);
    expect(r.best.score).toBeGreaterThan(0.6);
    expect(r.best.score).toBeLessThanOrEqual(1);
    expect(r.best.label.zh).toBe('收益分析');
    expect(r.best.reason.length).toBeGreaterThan(0);
  });
  it('bigram evidence alone never navigates', () => {
    for (const q of ['retruns', '资产总蓝', 'holdngs']) {
      expect(run(q).status, q).not.toBe('confident');
    }
  });
});

describe('mixed language and UI hint', () => {
  const cases: [string, DestId][] = [
    ['show 我的持仓', 'holdings'],
    ['returns を見せて', 'returns'],
    ['我想看 risk', 'risk'],
    ['查一下 auto-invest', 'plan'],
    ['Aurea，帮我看看 cash flow', 'cashflow'],
    ['リスク check', 'risk'],
  ];
  for (const [q, id] of cases) {
    it(`${q} -> ${id}`, () => {
      expect(topId(run(q))).toBe(id);
    });
  }
  it('the answer does not depend on the UI language hint', () => {
    for (const q of ['我的收益怎么样', 'show my holdings', '積立プランを見せて', '収益']) {
      const a = run(q, 'zh');
      expect(topId(run(q, 'en'))).toBe(topId(a));
      expect(topId(run(q, 'ja'))).toBe(topId(a));
    }
  });
  it('full-width / katakana variants match', () => {
    expect(topId(run('ＳＨＯＷ　ＭＹ　ＨＯＬＤＩＮＧＳ'))).toBe('holdings');
    expect(topId(run('りすく'))).toBe('risk');
  });
});

describe('performance', () => {
  it('1000 matches take < 200ms', () => {
    const qs = ['我的钱都买了什么', 'show me my returns this year', '不要看收益，想看持仓', '天气怎么样', '積立の次回はいつ', 'asdf', '看看最近情况'];
    run('warmup');
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) run(qs[i % qs.length]!);
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(200);
  });
});
