import { describe, expect, it, vi } from 'vitest';
import { bigrams, dice, diceStrings } from './bigram';
import { compact, foldKana, normalize, normalizeClauses, questionEnds } from './normalize';
import { detectLocale, segment, tokens } from './segment';
import { stem, stripCjkStop } from './stopwords';
import { cut, findNegations } from './negation';

describe('normalize', () => {
  it('applies NFKC, lowercase and full-width -> half-width', () => {
    expect(normalize('ＳＨＯＷ　Ｍｙ　ＲＥＴＵＲＮＳ')).toBe('show my returns');
    expect(normalize('ﾎﾟｰﾄﾌｫﾘｵ')).toBe('ぽーとふぉりお'); // half-width katakana -> full-width -> hiragana
  });
  it('strips ASCII and CJK punctuation / whitespace variants', () => {
    expect(normalize('  收益，分析！？')).toBe('收益 分析');
    expect(compact('「収益」を、見せて。')).toBe('収益を見せて');
    expect(compact('a　b\tc\nd')).toBe('abcd');
    expect(normalize('don’t show me')).toBe('dont show me');
  });
  it('folds katakana to hiragana for comparison, keeps the long-vowel mark', () => {
    expect(foldKana('リスク診断')).toBe('りすく診断');
    expect(normalize('ホーム')).toBe('ほーむ');
    expect(normalize('りすく')).toBe(normalize('リスク'));
  });
  it('keeps clause boundaries as "|" in the clause form', () => {
    expect(normalizeClauses('不要看收益，想看持仓')).toBe('不要看收益|想看持仓');
    expect(normalizeClauses('not returns, show holdings')).toBe('not returns|show holdings');
  });
  it('returns empty for empty / punctuation-only input', () => {
    expect(normalize('')).toBe('');
    expect(normalize('   ')).toBe('');
    expect(normalize('？！。。。')).toBe('');
  });
});

describe('bigram', () => {
  it('builds character bigram sets', () => {
    expect([...bigrams('收益分析')].sort()).toEqual(['分析', '益分', '收益'].sort());
    expect(bigrams('a').size).toBe(1);
    expect(bigrams('').size).toBe(0);
  });
  it('computes Dice', () => {
    expect(diceStrings('收益分析', '收益分析')).toBe(1);
    expect(diceStrings('收益分析', '收益分祈')).toBeCloseTo(2 / 3, 5);
    expect(diceStrings('abcd', 'wxyz')).toBe(0);
    expect(dice(new Set(), bigrams('ab'))).toBe(0);
  });
});

describe('segment', () => {
  it('picks the locale by script', () => {
    expect(detectLocale('我的收益')).toBe('zh');
    expect(detectLocale('我的収益', 'ja')).toBe('ja');
    expect(detectLocale('収益を見せて')).toBe('ja');
    expect(detectLocale('show returns')).toBe('en');
  });
  it('segments words (or falls back gracefully)', () => {
    expect(tokens('show my returns')).toEqual(['show', 'my', 'returns']);
    const segs = segment('我的收益怎么样');
    expect(segs.map((s) => s.segment).join('')).toBe('我的收益怎么样');
    expect(segment('')).toEqual([]);
  });
  it('works without Intl.Segmenter', async () => {
    const orig = Intl.Segmenter;
    vi.resetModules();
    (Intl as unknown as { Segmenter?: unknown }).Segmenter = undefined;
    try {
      const mod = await import('./segment');
      const segs = mod.segment('show 持仓');
      expect(segs.map((s) => s.segment)).toEqual(['show', '持', '仓']);
      expect(mod.tokens('收益 returns')).toContain('returns');
    } finally {
      (Intl as unknown as { Segmenter?: unknown }).Segmenter = orig;
      vi.resetModules();
    }
  });
});

describe('stop words / stemming / negation helpers', () => {
  it('strips CJK filler', () => {
    expect(stripCjkStop('看看我的持仓')).toBe('持仓');
    expect(stripCjkStop('収益を見せて')).toBe('収益');
  });
  it('stems plurals and -ing / -ed consistently', () => {
    expect(stem('holdings')).toBe(stem('holding'));
    expect(stem('returns')).toBe('return');
    expect(stem('invested')).toBe('invest');
    expect(stem('losses')).toBe('loss');
    expect(stem('p')).toBe('p');
  });
  it('finds negated spans', () => {
    const t = normalizeClauses('不要看收益，想看持仓');
    const { kept, removed } = cut(t, findNegations(t));
    expect(removed).toContain('收益');
    expect(kept).not.toContain('收益');
    expect(kept).toContain('持仓');
    const e = normalizeClauses('not returns, show holdings');
    expect(cut(e, findNegations(e)).kept).toContain('show holdings');
    const j = foldKana(normalizeClauses('収益じゃなくて、保有資産を見せて'));
    expect(cut(j, findNegations(j)).kept).toContain('保有資産');
    expect(findNegations(normalizeClauses('是不是太集中在科技股'))).toEqual([]);
  });
});

describe('questionEnds', () => {
  it('marks clause ends that carried a question mark', () => {
    expect([...questionEnds('成績はいい？')]).toEqual([5]);
    expect([...questionEnds('収益はいいの？ 保有を見せて')]).toEqual([6]);
    expect(questionEnds('成績はいい。').size).toBe(0);
  });
});
