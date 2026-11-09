// Fictional, internally consistent finance data. Currency: USD. "Today" is fixed to 2026-11-09.
import type { L10n } from '../types';

export const DEMO_DATE = '2026-11-09';
const L = (zh: string, en: string, ja: string): L10n => ({ zh, en, ja });
const round2 = (n: number) => Math.round(n * 100) / 100;

export function daysUntil(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${DEMO_DATE}T00:00:00Z`)) / 86_400_000);
}

// ---------------------------------------------------------------- holdings
export type AssetClass = 'stock' | 'bond' | 'gold' | 'cash';
export type Sector = 'tech' | 'broad' | 'intl' | 'bond' | 'gold' | 'cash';
export interface Holding {
  symbol: string;
  name: L10n;
  cls: AssetClass;
  sector: Sector;
  shares: number;
  price: number;
  dayPct: number; // today's move, percent
}

export const holdings: Holding[] = [
  { symbol: 'VOO', name: L('标普 500 ETF', 'S&P 500 ETF', 'S&P 500 ETF'), cls: 'stock', sector: 'broad', shares: 42, price: 630.5, dayPct: 0.3 },
  { symbol: 'NVDA', name: L('英伟达', 'Nvidia', 'エヌビディア'), cls: 'stock', sector: 'tech', shares: 80, price: 177.5, dayPct: 1.2 },
  { symbol: 'BND', name: L('美国债券 ETF', 'Total Bond ETF', '米国債券ETF'), cls: 'bond', sector: 'bond', shares: 255, price: 74.1, dayPct: -0.1 },
  { symbol: 'QQQ', name: L('纳斯达克 100 ETF', 'Nasdaq-100 ETF', 'ナスダック100 ETF'), cls: 'stock', sector: 'tech', shares: 20, price: 620, dayPct: 0.5 },
  { symbol: 'AAPL', name: L('苹果', 'Apple', 'アップル'), cls: 'stock', sector: 'tech', shares: 36, price: 270, dayPct: 0.4 },
  { symbol: 'CASH', name: L('货币基金（现金）', 'Money market (cash)', 'MMF（現金）'), cls: 'cash', sector: 'cash', shares: 9560, price: 1, dayPct: 0 },
  { symbol: 'MSFT', name: L('微软', 'Microsoft', 'マイクロソフト'), cls: 'stock', sector: 'tech', shares: 17, price: 505, dayPct: 0.6 },
  { symbol: 'VXUS', name: L('国际股票 ETF', 'International ETF', '外国株ETF'), cls: 'stock', sector: 'intl', shares: 140, price: 66.4, dayPct: 0.1 },
  { symbol: 'GLD', name: L('黄金 ETF', 'Gold ETF', 'ゴールドETF'), cls: 'gold', sector: 'gold', shares: 22, price: 368, dayPct: 0.2 },
];

export const holdingValue = (h: Holding): number => round2(h.shares * h.price);
export const totalAssets: number = round2(holdings.reduce((s, h) => s + holdingValue(h), 0));
export const holdingsByValue: Holding[] = [...holdings].sort((a, b) => holdingValue(b) - holdingValue(a));
export const topHolding: Holding = holdingsByValue[0];
export const weightOf = (h: Holding): number => (holdingValue(h) / totalAssets) * 100;

export const todayChange = (() => {
  const amount = round2(holdings.reduce((s, h) => s + (holdingValue(h) * h.dayPct) / 100, 0));
  return { amount, pct: (amount / (totalAssets - amount)) * 100 };
})();

export const allocation: { cls: AssetClass; value: number; pct: number }[] = (
  ['stock', 'bond', 'cash', 'gold'] as AssetClass[]
).map((cls) => {
  const value = round2(holdings.filter((h) => h.cls === cls).reduce((s, h) => s + holdingValue(h), 0));
  return { cls, value, pct: (value / totalAssets) * 100 };
});

/** Last 12 month-ends (Dec 2025 … Nov 2026 to date) as fractions of today's total. */
export const netWorthSeries: number[] = [0.868, 0.884, 0.9, 0.905, 0.867, 0.855, 0.89, 0.935, 0.962, 0.953, 0.988, 1].map((f) =>
  Math.round(totalAssets * f),
);

// ---------------------------------------------------------------- cash flow (Nov 1–9, 2026)
export type CategoryId = 'housing' | 'groceries' | 'dining' | 'transport' | 'shopping' | 'subs' | 'utilities' | 'health' | 'fun' | 'income';
export interface Tx {
  date: string;
  merchant: L10n;
  category: CategoryId;
  amount: number; // negative = spending
}

export const transactions: Tx[] = [
  { date: '2026-11-09', merchant: L('星光影城', 'Starlight Cinema', 'スターライト映画館'), category: 'fun', amount: -28 },
  { date: '2026-11-09', merchant: L('周末集市', 'Weekend Market', 'ウィークエンドマーケット'), category: 'groceries', amount: -48.1 },
  { date: '2026-11-08', merchant: L('面馆小野', 'Ono Noodle House', '麺処おの'), category: 'dining', amount: -21.5 },
  { date: '2026-11-08', merchant: L('康宁药房', 'Greenway Pharmacy', 'グリーンウェイ薬局'), category: 'health', amount: -23.4 },
  { date: '2026-11-07', merchant: L('网约车', 'Ride share', 'ライドシェア'), category: 'transport', amount: -18.6 },
  { date: '2026-11-06', merchant: L('城市生鲜', 'City Grocer', 'シティ・グロッサー'), category: 'groceries', amount: -54.25 },
  { date: '2026-11-06', merchant: L('在线商城', 'Online Mall', 'オンラインモール'), category: 'shopping', amount: -132.9 },
  { date: '2026-11-05', merchant: L('水电燃气', 'Power & Water', '電気・水道'), category: 'utilities', amount: -96.5 },
  { date: '2026-11-05', merchant: L('工资入账', 'Payroll', '給与'), category: 'income', amount: 6200 },
  { date: '2026-11-04', merchant: L('寿司花', 'Sushi Hana', '寿司はな'), category: 'dining', amount: -64 },
  { date: '2026-11-03', merchant: L('云盘空间', 'Cloud storage', 'クラウドストレージ'), category: 'subs', amount: -9.99 },
  { date: '2026-11-03', merchant: L('影音会员', 'Streaming plan', '動画配信プラン'), category: 'subs', amount: -15.99 },
  { date: '2026-11-02', merchant: L('晨光咖啡', 'Morning Roast Café', 'モーニングロースト'), category: 'dining', amount: -9.8 },
  { date: '2026-11-02', merchant: L('城市生鲜', 'City Grocer', 'シティ・グロッサー'), category: 'groceries', amount: -86.4 },
  { date: '2026-11-01', merchant: L('公交卡充值', 'Transit card top-up', '交通ICチャージ'), category: 'transport', amount: -40 },
  { date: '2026-11-01', merchant: L('房租', 'Rent', '家賃'), category: 'housing', amount: -1500 },
];

const expenses = transactions.filter((x) => x.amount < 0);
export const monthSpend: number = round2(-expenses.reduce((s, x) => s + x.amount, 0));
export const monthIncome: number = round2(transactions.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0));
export const monthNet: number = round2(monthIncome - monthSpend);
export const lastMonthSameDaysSpend = 2387.1;
export const monthBudget = 3900;

export const spendByCategory: { cat: CategoryId; value: number; pct: number }[] = (() => {
  const m = new Map<CategoryId, number>();
  for (const x of expenses) m.set(x.category, (m.get(x.category) ?? 0) - x.amount);
  return [...m.entries()]
    .map(([cat, v]) => ({ cat, value: round2(v), pct: (v / monthSpend) * 100 }))
    .sort((a, b) => b.value - a.value);
})();
export const topCategory = spendByCategory[0];

/** Spending per day (rent excluded so the other days stay readable), Nov 1 … Nov 9. */
export const dailySpend: { date: string; value: number }[] = Array.from({ length: 9 }, (_, i) => {
  const date = `2026-11-0${i + 1}`;
  return { date, value: round2(-expenses.filter((x) => x.date === date && x.category !== 'housing').reduce((s, x) => s + x.amount, 0)) };
});

// ---------------------------------------------------------------- returns (cumulative %, month-end, Jan … Nov 9)
export const portfolioCum = [1.8, 3.1, 0.6, -4.2, -1.5, 2.9, 5.6, 7.2, 6.1, 9.9, 11.8];
export const benchmarkCum = [1.2, 2.4, 0.2, -5.1, -2.3, 2.0, 4.1, 5.5, 4.6, 8.4, 9.6];
export const ytdReturn = portfolioCum[portfolioCum.length - 1];
export const benchmarkReturn = benchmarkCum[benchmarkCum.length - 1];
export const excessReturn = round2(ytdReturn - benchmarkReturn);

const toIndex = (cum: number[]): number[] => [1, ...cum.map((c) => 1 + c / 100)];
const monthlyReturns = (cum: number[]): number[] => {
  const idx = toIndex(cum);
  return idx.slice(1).map((v, i) => (v / idx[i] - 1) * 100);
};
export const monthlyPortfolio = monthlyReturns(portfolioCum);
export const bestMonth = (() => {
  const i = monthlyPortfolio.indexOf(Math.max(...monthlyPortfolio));
  return { month: i, value: monthlyPortfolio[i] };
})();
export const worstMonth = (() => {
  const i = monthlyPortfolio.indexOf(Math.min(...monthlyPortfolio));
  return { month: i, value: monthlyPortfolio[i] };
})();

// ---------------------------------------------------------------- risk
const annualVol = (cum: number[]): number => {
  const r = monthlyReturns(cum);
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  const variance = r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(variance) * Math.sqrt(12);
};
export const volatility = annualVol(portfolioCum);
export const benchmarkVolatility = annualVol(benchmarkCum);
export const beta = 0.93;

export const maxDrawdown = (() => {
  const idx = toIndex(portfolioCum); // idx[0] = Dec 31, idx[1] = Jan end …
  let peak = 0;
  let best = { depth: 0, peak: 0, trough: 0 };
  idx.forEach((v, i) => {
    if (v > idx[peak]) peak = i;
    const d = v / idx[peak] - 1;
    if (d < best.depth) best = { depth: d, peak, trough: i };
  });
  let recover: number | null = null;
  for (let i = best.trough + 1; i < idx.length; i++) {
    if (idx[i] >= idx[best.peak]) {
      recover = i;
      break;
    }
  }
  // idx index i (>=1) corresponds to month index i-1 (0 = Jan).
  return { depthPct: best.depth * 100, peakMonth: best.peak - 1, troughMonth: best.trough - 1, recoverMonth: recover === null ? null : recover - 1 };
})();

export const techShare: number =
  (holdings.filter((h) => h.sector === 'tech').reduce((s, h) => s + holdingValue(h), 0) / totalAssets) * 100;
export const techLimit = 30;
export const top3Share: number = (holdingsByValue.slice(0, 3).reduce((s, h) => s + holdingValue(h), 0) / totalAssets) * 100;

// ---------------------------------------------------------------- auto-invest plans
export interface Plan {
  symbol: string;
  name: L10n;
  amount: number;
  dayOfMonth: number;
  next: string | null; // null when paused
  active: boolean;
}

export const plans: Plan[] = [
  { symbol: 'QQQ', name: L('纳斯达克 100 ETF', 'Nasdaq-100 ETF', 'ナスダック100 ETF'), amount: 150, dayOfMonth: 13, next: '2026-11-13', active: true },
  { symbol: 'VOO', name: L('标普 500 ETF', 'S&P 500 ETF', 'S&P 500 ETF'), amount: 400, dayOfMonth: 15, next: '2026-11-15', active: true },
  { symbol: 'BND', name: L('美国债券 ETF', 'Total Bond ETF', '米国債券ETF'), amount: 200, dayOfMonth: 1, next: '2026-12-01', active: true },
  { symbol: 'GLD', name: L('黄金 ETF', 'Gold ETF', 'ゴールドETF'), amount: 100, dayOfMonth: 20, next: null, active: false },
];
export const activePlans = plans.filter((p) => p.active);
export const monthlyAmount: number = activePlans.reduce((s, p) => s + p.amount, 0);
export const nextRun: Plan = [...activePlans].sort((a, b) => (a.next as string).localeCompare(b.next as string))[0];

// ---------------------------------------------------------------- trades
export interface Trade {
  date: string;
  side: 'buy' | 'sell';
  symbol: string;
  qty: number;
  price: number;
  auto: boolean;
}
const tr = (date: string, side: 'buy' | 'sell', symbol: string, qty: number, price: number, auto: boolean): Trade => ({ date, side, symbol, qty, price, auto });
export const trades: Trade[] = [
  tr('2026-11-04', 'buy', 'NVDA', 5, 176.8, false),
  tr('2026-11-01', 'buy', 'BND', 2.699, 74.1, true),
  tr('2026-10-28', 'sell', 'AAPL', 10, 269.4, false),
  tr('2026-10-20', 'buy', 'GLD', 0.272, 367.6, true),
  tr('2026-10-15', 'buy', 'VOO', 0.634, 630.9, true),
  tr('2026-10-13', 'buy', 'QQQ', 0.242, 619.8, true),
  tr('2026-10-02', 'buy', 'MSFT', 3, 502.3, false),
  tr('2026-09-22', 'sell', 'NVDA', 8, 171.2, false),
  tr('2026-09-15', 'buy', 'VOO', 0.646, 619.2, true),
  tr('2026-09-13', 'buy', 'QQQ', 0.247, 607.1, true),
];
export const tradeAmount = (x: Trade): number => round2(x.qty * x.price);
export const lastBuy: Trade = trades.find((x) => x.side === 'buy') as Trade;
