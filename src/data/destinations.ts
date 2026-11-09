// Destination + system-intent data for the Aurea demo (personal finance AI assistant).
// Pure data: consumed by the intent matcher, the wheel, the tutorial and the page shells.
import type { AnchorIntent, Capsule, Destination, L10n, L10nList, SystemIntent, TargetId } from '../types';

const L = (zh: string, en: string, ja: string): L10n => ({ zh, en, ja });
const P = (zh: string[], en: string[], ja: string[]): L10nList => ({ zh, en, ja });
const K = (high: string[], med: string[]) => ({ high, med });
const cap = (id: TargetId, zh: string, en: string, ja: string, anchor?: string): Capsule => ({
  text: L(zh, en, ja),
  target: anchor ? { id, anchor } : { id },
});
const anchor = (
  id: string,
  label: L10n,
  phrases: L10nList,
  keywords: L10nList,
): AnchorIntent => ({ anchor: id, label, phrases, keywords });

// ---------------------------------------------------------------------------
// 1. overview
// ---------------------------------------------------------------------------
const overview: Destination = {
  id: 'overview',
  icon: '🧭',
  title: L('资产总览', 'Overview', '資産概要'),
  summary: L('一眼看清总资产、今日变动与资产配比', 'Total assets, today’s change and allocation at a glance', '総資産・今日の増減・資産配分をひと目で'),
  anchors: ['total-assets', 'today-change', 'allocation'],
  phrases: P(
    ['资产总览', '账户概况', '整体情况怎么样', '总览一下', '看看整体资产', '我的资产状况', '先看个总览', '资产概况'],
    ['overview', 'asset overview', 'account overview', 'how am i doing overall', 'give me the big picture', 'my financial summary', 'account summary', 'show my overall situation'],
    ['資産概要', '資産の全体像', '口座の概況', '全体の状況を見せて', '資産状況を教えて', 'ざっくり全体を見たい', '今の資産状況', '総合サマリー'],
  ),
  keywords: {
    zh: K(['总览', '概览', '概况', '总资产', '净资产', '总额', '全部资产', '资产状况', '整体情况', '资产配置', '配置比例', '资产分布'], ['资产', '账户', '整体', '总体', '余额', '家底', '身家']),
    en: K(['overview', 'net worth', 'total assets', 'total balance', 'big picture', 'account summary', 'financial summary', 'overall', 'allocation', 'asset allocation', 'asset mix'], ['assets', 'balance', 'account', 'wealth', 'total', 'summary', 'worth']),
    ja: K(['資産概要', '総資産', '純資産', '資産総額', '概要', '全体像', '資産状況', '総額', '資産配分', '資産の内訳'], ['資産', '残高', '口座', '全体', '合計', '財産']),
  },
  anchorIntents: [
    anchor(
      'total-assets',
      L('总资产', 'Total assets', '総資産'),
      P(
        ['我现在有多少钱', '我一共有多少资产', '我的总资产是多少', '现在账上一共多少钱', '我的净资产有多少', '我现在身家多少'],
        ['how much money do i have', 'what is my total assets', 'what is my net worth', 'how much am i worth', 'total balance right now', 'how much do i have in total'],
        ['今いくら持ってる', '総資産はいくら', '私の資産は全部でいくら', '純資産を教えて', '今の資産合計は', '全部でいくらある'],
      ),
      P(['总资产', '净资产', '一共多少', '身家', '家底', '账上', '有多少钱', '有多少资产', '有多少存款'], ['total assets', 'net worth', 'worth', 'how much do i have', 'how much money', 'in total'], ['総資産', '純資産', '資産合計', 'いくら持', 'いくらある']),
    ),
    anchor(
      'today-change',
      L('今日变动', 'Today’s change', '今日の増減'),
      P(
        ['今天涨了还是跌了', '今日涨跌多少', '今天账户变动了多少', '今天赚了还是亏了', '比昨天多了还是少了', '今天资产变化'],
        ['how did i do today', 'what changed today', 'am i up or down today', 'todays change', 'how much did my balance move today', 'daily change'],
        ['今日の増減', '今日は上がった下がった', '今日の値動きはどう', '昨日からどれだけ変わった', '今日の資産の変化', '今日はプラスですか'],
      ),
      P(['今日涨跌', '今天涨跌', '今日变动', '当日', '日内', '比昨天', '昨天', '涨了还是跌'], ['up or down', 'daily change', 'since yesterday', 'yesterday', 'todays change', 'changed today'], ['今日の増減', '今日の値動き', '昨日から', '前日比', '日次']),
    ),
    anchor(
      'allocation',
      L('资产配比', 'Allocation', '資産配分'),
      P(
        ['资产都配在哪了', '各类资产占多少比例', '资产配置比例是怎样的', '钱分别放在哪些类别', '股票债券各占几成', '资产分布情况'],
        ['how is my money allocated', 'what is my asset allocation', 'breakdown of my assets', 'how are my assets split', 'what percentage is in stocks', 'show asset mix'],
        ['資産配分を見せて', '資産の内訳は', '株と債券の比率', '配分比率はどうなってる', 'お金はどこに振り分けられてる', '資産ポートフォリオの割合'],
      ),
      P(['资产配置', '配置比例', '占比', '比例', '分布', '几成', '各占'], ['allocation', 'allocated', 'breakdown', 'split', 'mix', 'percentage', 'proportion', 'pie'], ['資産配分', '内訳', '配分', '比率', '割合', '構成比']),
    ),
  ],
  capsules: [
    cap('overview', '我现在有多少钱？', 'How much money do I have now?', '今いくら持ってる？', 'total-assets'),
    cap('overview', '今天账户涨了还是跌了？', 'Am I up or down today?', '今日はプラス？マイナス？', 'today-change'),
    cap('overview', '我的钱都配在哪些地方？', 'How is my money allocated?', '資産の配分を見せて', 'allocation'),
    cap('overview', '给我看看整体情况', 'Give me the big picture', '全体の状況を教えて'),
  ],
  followUps: [
    cap('holdings', '具体都持有什么？', 'What exactly do I hold?', '具体的に何を持ってる？'),
    cap('risk', '这样配置有风险吗？', 'Is this allocation risky?', 'この配分は危なくない？'),
  ],
};

// ---------------------------------------------------------------------------
// 2. cashflow
// ---------------------------------------------------------------------------
const cashflow: Destination = {
  id: 'cashflow',
  icon: '💸',
  title: L('收支流水', 'Cash flow', '収支'),
  summary: L('本月花了多少、花在哪、最近有哪些进出', 'Monthly spending, top categories and recent activity', '今月の支出・カテゴリ別・直近の出入金'),
  anchors: ['month-spend', 'top-category', 'recent-tx'],
  phrases: P(
    ['收支流水', '我的收入和支出', '账单明细', '最近的收支情况', '钱的进出', '每月收支', '流水账', '收入支出明细'],
    ['cash flow', 'income and expenses', 'where does my money go', 'my spending', 'money in and out', 'expense report', 'monthly budget', 'show my bills'],
    ['収支', '収支の流れ', '収入と支出', 'お金の出入り', '家計簿', '支出の明細', '月々の支出', '使ったお金'],
  ),
  keywords: {
    zh: K(['收支', '流水', '支出', '开销', '花销', '花费', '消费', '账单', '花钱', '剁手', '收入', '工资', '进账'], ['花了', '花在', '钱花', '花太多', '花多了', '超支', '月光', '预算', '记账', '入账', '出账', '进出']),
    en: K(['cash flow', 'cashflow', 'spending', 'spend', 'expense', 'income', 'bills', 'bill', 'statement', 'salary', 'spent'], ['money out', 'budget', 'paid', 'payment', 'cost', 'pay']),
    ja: K(['収支', '支出', '出費', '収入', '家計簿', '家計', '浪費', '使った', '使いすぎ'], ['費用', '支払い', '生活費', '食費', '買い物', '給料', '予算']),
  },
  anchorIntents: [
    anchor(
      'month-spend',
      L('本月支出', 'Spending this month', '今月の支出'),
      P(
        ['这个月花了多少钱', '本月总共开销多少', '上个月花了多少', '这月支出多少', '月度花销是多少', '这个月剁手花了多少'],
        ['how much did i spend this month', 'monthly spending total', 'what did i spend last month', 'total expenses this month', 'how much have i spent so far', 'spending this month'],
        ['今月いくら使った', '今月の支出はいくら', '先月の出費は', '今月の合計支出', '月の使った金額', '今月の出費総額'],
      ),
      P(['本月', '这个月', '上个月', '月度', '月支出', '当月', '这月'], ['this month', 'last month', 'monthly', 'month'], ['今月', '先月', '月間', '月々', '月の']),
    ),
    anchor(
      'top-category',
      L('最大支出类别', 'Top category', '最大の支出カテゴリ'),
      P(
        ['钱主要花在哪', '哪一类花得最多', '花销最大的是什么', '最大的开销类别', '吃饭购物哪个花得多', '钱都花在哪儿了'],
        ['what do i spend the most on', 'biggest expense category', 'where does most of my money go', 'top spending category', 'which category costs me the most'],
        ['何にいちばんお金を使ってる', '一番多い支出カテゴリ', '出費が最大の項目は', 'どの分野にお金がかかってる', '最も使っているカテゴリ', '支出の内訳トップ'],
      ),
      P(['类别', '最大开销', '最大的开销', '开销最大', '花销最大', '花得最多', '分类', '大头', '哪类', '哪一类', '主要花在'], ['category', 'categories', 'biggest expense', 'most on', 'top spending'], ['カテゴリ', 'カテゴリー', '一番多い', '最も多い', '項目', '使途']),
    ),
    anchor(
      'recent-tx',
      L('最近流水', 'Recent activity', '最近の出入金'),
      P(
        ['最近有哪些收支', '最近几笔账', '最近一笔花销是什么', '最新的流水', '刚刚花了什么', '最近的消费记录'],
        ['recent transactions', 'what did i just spend on', 'latest payments', 'last few transactions', 'show recent activity', 'most recent purchases'],
        ['最近の取引明細', '直近の支出', '最新の出入金', '最近何に使った', '最近の支払い履歴', '直近の明細'],
      ),
      P(['最近几笔', '最新流水', '最近的账', '刚刚', '明细', '最近消费'], ['recent transaction', 'latest payment', 'recent activity', 'just spent'], ['直近', '明細', '最近の支払い', '出入金']),
    ),
  ],
  capsules: [
    cap('cashflow', '上个月钱都花在哪了？', 'Where did my money go last month?', '先月、お金は何に使った？', 'top-category'),
    cap('cashflow', '这个月已经花了多少？', 'How much have I spent this month?', '今月いくら使った？', 'month-spend'),
    cap('cashflow', '最近有哪些进出账？', 'Show my recent transactions', '最近の出入金を見せて', 'recent-tx'),
    cap('cashflow', '我的收入和支出情况', 'My income and expenses', '収入と支出の状況'),
  ],
  followUps: [
    cap('overview', '那我现在一共有多少钱？', 'So how much do I have now?', 'で、今いくらあるの？', 'total-assets'),
    cap('plan', '每月自动存一点？', 'Set up a monthly auto-invest?', '毎月自動で積み立てたい'),
  ],
};

// ---------------------------------------------------------------------------
// 3. holdings
// ---------------------------------------------------------------------------
const holdings: Destination = {
  id: 'holdings',
  icon: '💼',
  title: L('持仓配置', 'Holdings', '保有資産'),
  summary: L('持有的股票、基金与最大仓位', 'Stocks, funds and your biggest position', '保有する株式・ファンドと最大の銘柄'),
  anchors: ['holdings-list', 'top-holding'],
  phrases: P(
    ['持仓配置', '我的钱都买了什么', '我持有哪些股票', '我有哪些股票', '我有什么基金', '看看我的持仓', '我买了哪些基金', '我手里有什么', '仓位怎么样', '持有的资产明细'],
    ['my holdings', 'what do i own', 'what am i invested in', 'show my positions', 'which stocks do i hold', 'which positions do i have', 'whats in my portfolio', 'list my funds'],
    ['保有資産', '持ち株を見せて', '何を持ってる', '保有銘柄の一覧', 'ポジションを確認', '私のポートフォリオ', 'どの株を持ってる', '保有している投資信託'],
  ),
  keywords: {
    zh: K(['持仓', '持有', '仓位', '持股', '重仓', '手里的', '持仓配置'], ['股票', '基金', '个股', '标的', '配置', '组合', '投资', '债券', '仓', '买的', '买了什么', '买了哪些']),
    en: K(['holdings', 'holding', 'positions', 'position', 'own', 'securities'], ['stocks', 'stock', 'funds', 'fund', 'etf', 'etfs', 'shares', 'portfolio', 'invested', 'invest', 'bond', 'equity', 'investments']),
    ja: K(['保有資産', '保有', '持ち株', '保有銘柄', '銘柄', 'ポジション', '投資信託'], ['株', 'ファンド', 'ポートフォリオ', '持って', '投資', '債券', '組み入れ', 'etf']),
  },
  anchorIntents: [
    anchor(
      'holdings-list',
      L('持仓清单', 'Holdings list', '保有リスト'),
      P(
        ['我持有哪些资产', '列出所有持仓', '持仓列表', '手里都有哪些股票基金', '全部持仓明细', '我买了哪些东西'],
        ['list all my holdings', 'what stocks do i own', 'show every position', 'full list of what i hold', 'which funds do i have'],
        ['保有銘柄の一覧', '持っている株を全部', '全保有資産のリスト', 'どんなファンドを持ってる', '保有リスト'],
      ),
      P(['持仓列表', '持仓清单', '全部持仓', '列表', '清单', '明细', '有哪些'], ['list', 'all holdings', 'every position', 'full list'], ['一覧', 'リスト', '全部', '銘柄一覧']),
    ),
    anchor(
      'top-holding',
      L('最大持仓', 'Top holding', '最大の保有銘柄'),
      P(
        ['我最大的持仓是什么', '哪只仓位最重', '重仓股是哪个', '买得最多的是什么', '占比最高的资产是哪个', '最大一笔持仓'],
        ['whats my biggest holding', 'largest position', 'which stock do i hold the most of', 'top holding', 'my heaviest position'],
        ['一番多く持ってる銘柄', '最大の保有銘柄は', '最も比重の大きい資産', '上位の保有資産', '一番比率が高い銘柄'],
      ),
      P(['最大持仓', '最重', '重仓', '最大的持仓', '买得最多', '第一大'], ['biggest holding', 'largest position', 'top holding', 'heaviest', 'most of'], ['最大', '一番多く', '上位', '比重', '筆頭']),
    ),
  ],
  capsules: [
    cap('holdings', '我的钱都买了什么？', 'What is my money invested in?', 'お金は何に投資してる？', 'holdings-list'),
    cap('holdings', '我最大的一笔持仓是哪个？', 'What is my biggest holding?', '一番大きな保有銘柄は？', 'top-holding'),
    cap('holdings', '我手里有哪些基金？', 'Which funds do I hold?', 'どのファンドを持ってる？', 'holdings-list'),
    cap('holdings', '看看我的持仓配置', 'Show my holdings', '保有資産を見せて'),
  ],
  followUps: [
    cap('risk', '这些持仓集中吗？', 'Is this too concentrated?', 'この保有は偏ってない？', 'concentration'),
    cap('returns', '它们赚钱了吗？', 'Are they making money?', 'これらは儲かってる？'),
  ],
};

// ---------------------------------------------------------------------------
// 4. returns
// ---------------------------------------------------------------------------
const returns: Destination = {
  id: 'returns',
  icon: '📈',
  title: L('收益分析', 'Returns', '運用成績'),
  summary: L('今年赚了多少、收益走势、是否跑赢大盘', 'Year-to-date gains, the trend and the benchmark', '年初来の損益・推移・ベンチマーク比較'),
  anchors: ['return-ytd', 'return-chart', 'benchmark'],
  phrases: P(
    ['收益分析', '我赚了多少钱', '最近赚了还是亏了', '看看我的投资收益', '收益率是多少', '盈亏情况怎么样', '回报怎么样', '这些投资赚钱吗'],
    ['returns', 'how much did i make', 'am i making money', 'my investment performance', 'profit and loss', 'how are my investments doing', 'show my gains', 'did i lose money'],
    ['運用成績', 'いくら儲かった', '利益はどのくらい', '損益を見せて', '投資のパフォーマンス', '儲かってる', '損してる', 'リターンを確認'],
  ),
  keywords: {
    zh: K(['收益', '收益率', '回报', '盈利', '盈亏', '赚', '亏', '利润', '浮盈', '浮亏', '业绩', '绩效', '涨幅', '回报率', '赚钱', '亏钱', '亏损', '赚了'], ['表现', '投资表现']),
    en: K(['returns', 'return', 'profit', 'loss', 'gain', 'earnings', 'earn', 'made money', 'performance', 'roi', 'p&l', 'pnl', 'yield', 'profitable'], ['make money', 'winning', 'losing']),
    ja: K(['運用成績', '収益', '儲', '損益', '利益', '損失', 'リターン', 'パフォーマンス', '成績', '含み益', '含み損', '利回り'], ['増えた', '減った', '損', '得']),
  },
  anchorIntents: [
    anchor(
      'return-ytd',
      L('年初至今收益', 'Return YTD', '年初来リターン'),
      P(
        ['今年赚了多少', '年初到现在的收益', '今年以来收益率', '今年一共盈利多少', '今年亏了没有', '年内收益怎么样'],
        ['how much have i made this year', 'year to date return', 'ytd performance', 'my returns this year', 'profit since january', 'how am i doing this year'],
        ['今年いくら儲かった', '年初来のリターン', '今年の運用成績', '今年の利益はどのくらい', '年初からの収益率', '今年のプラマイ'],
      ),
      P(['今年', '年初', '年内', '年初至今', '今年以来'], ['ytd', 'this year', 'year to date', 'since january', 'so far this year'], ['今年', '年初来', '年初から', '年間']),
    ),
    anchor(
      'return-chart',
      L('收益走势', 'Return chart', '収益推移'),
      P(
        ['收益曲线', '收益走势图', '看看收益的变化趋势', '这半年收益怎么变化的', '收益随时间的变化', '净值曲线'],
        ['returns chart', 'performance over time', 'show me the return trend', 'how has my performance changed', 'growth curve', 'performance graph'],
        ['収益の推移', '運用成績のグラフ', '収益チャート', 'リターンの推移を見たい', '時系列の成績', '資産推移のグラフ'],
      ),
      P(['曲线', '走势', '趋势', '图表', '变化趋势', '折线', '净值'], ['chart', 'graph', 'trend', 'over time', 'curve'], ['グラフ', 'チャート', '推移', '折れ線', '時系列']),
    ),
    anchor(
      'benchmark',
      L('基准对比', 'Benchmark', 'ベンチマーク比較'),
      P(
        ['跑赢大盘了吗', '和沪深300比怎么样', '相比大盘表现如何', '我比指数强还是弱', '与基准对比', '有没有跑赢市场'],
        ['did i beat the market', 'compare with benchmark', 'vs s&p 500', 'how do i compare to the index', 'am i outperforming', 'benchmark comparison'],
        ['市場に勝てている', 'ベンチマークと比べて', '日経平均と比較', '指数に対する成績', '市場平均との差', 'インデックスに勝ってる'],
      ),
      P(['大盘', '基准', '跑赢', '跑输', '指数', '沪深300', '对比'], ['benchmark', 'beat the market', 'outperform', 'index', 's&p 500', 'nasdaq'], ['ベンチマーク', '市場', '日経平均', '指数', '勝て', 'インデックス', '比較']),
    ),
  ],
  capsules: [
    cap('returns', '今年一共赚了多少？', 'How much have I made this year?', '今年いくら儲かった？', 'return-ytd'),
    cap('returns', '我的收益走势怎么样？', 'How is my return trending?', '収益の推移はどう？', 'return-chart'),
    cap('returns', '有没有跑赢大盘？', 'Did I beat the market?', '市場に勝ててる？', 'benchmark'),
    cap('returns', '看看我的投资收益', 'Show my investment returns', '運用成績を見せて'),
  ],
  followUps: [
    cap('risk', '收益背后风险大吗？', 'How risky is that return?', 'そのリターン、リスクは？'),
    cap('trades', '最近买卖了什么？', 'What did I trade lately?', '最近の売買は？'),
  ],
};

// ---------------------------------------------------------------------------
// 5. risk
// ---------------------------------------------------------------------------
const risk: Destination = {
  id: 'risk',
  icon: '🚨',
  title: L('风险检查', 'Risk check', 'リスク診断'),
  summary: L('集中度、波动与最大回撤的体检', 'Concentration, volatility and drawdown health check', '集中度・変動・最大ドローダウンの診断'),
  anchors: ['concentration', 'volatility', 'drawdown'],
  phrases: P(
    ['风险检查', '我的投资风险高吗', '帮我做个风险体检', '有没有什么风险', '风险大不大', '安不安全', '会不会亏很多', '风险评估'],
    ['risk check', 'how risky am i', 'is my portfolio safe', 'any risks i should know about', 'risk assessment', 'how much risk am i taking', 'am i exposed to risk', 'safety check'],
    ['リスク診断', '私の投資は危ない', 'リスクはどのくらい', 'リスクをチェック', '安全性を確認', '危険度を見たい', 'リスク評価', '大丈夫か心配'],
  ),
  keywords: {
    zh: K(['风险', '风控', '危险', '安全吗', '体检', '隐患', '爆雷', '暴雷', '集中', '分散', '波动', '回撤'], ['稳不稳', '稳健', '担心', '安全', '保守', '激进', '承受']),
    en: K(['risk', 'risks', 'risky', 'danger', 'dangerous', 'exposure', 'exposed', 'overexposed', 'overweight', 'safe', 'safety', 'volatile', 'volatility', 'drawdown', 'diversified', 'concentrated', 'concentration'], ['worry', 'worried', 'stable', 'secure']),
    ja: K(['リスク', '危険', '危ない', '安全', '不安', 'ボラティリティ', 'ドローダウン', '分散投資'], ['心配', '大丈夫', '安定']),
  },
  anchorIntents: [
    anchor(
      'concentration',
      L('集中度', 'Concentration', '集中度'),
      P(
        ['是不是太集中在科技股', '仓位太集中了吗', '会不会都押在一只股票上', '单一资产占比是不是太高', '分散得够不够', '鸡蛋是不是放在一个篮子里'],
        ['am i too concentrated in tech', 'is my portfolio diversified', 'too much in one stock', 'putting all eggs in one basket', 'concentration risk', 'overexposed to one sector'],
        ['一つの銘柄に偏りすぎ', '分散できてる', '集中投資になってない', 'テック株に偏ってない', '特定のセクターに集中', '分散投資は十分'],
      ),
      P(['集中', '分散', '押注', '偏重', '单一', '一个篮子', '过于集中'], ['concentration', 'concentrated', 'diversified', 'diversification', 'diversify', 'eggs', 'basket', 'overweight', 'too much in'], ['集中', '分散', '偏り', '偏って', '偏重']),
    ),
    anchor(
      'volatility',
      L('波动', 'Volatility', '変動'),
      P(
        ['我的资产波动大吗', '起伏大不大', '波动率是多少', '价格会不会大起大落', '会不会剧烈波动', '稳不稳定'],
        ['how volatile is my portfolio', 'how much do my assets fluctuate', 'is it a bumpy ride', 'volatility level', 'price swings', 'how stable are my investments'],
        ['値動きは激しい', 'ボラティリティはどのくらい', '価格変動が大きい', '資産は安定してる', 'ブレ幅を知りたい', '変動リスク'],
      ),
      P(['波动', '起伏', '大起大落', '震荡', '颠簸'], ['volatile', 'volatility', 'fluctuate', 'swings', 'bumpy', 'stable'], ['ボラティリティ', 'ボラ', '値動き', '変動', 'ブレ']),
    ),
    anchor(
      'drawdown',
      L('最大回撤', 'Max drawdown', '最大ドローダウン'),
      P(
        ['最大回撤是多少', '最糟糕的时候亏了多少', '从高点跌了多少', '历史最大亏损', '回撤有多深', '最惨的一次跌幅'],
        ['whats my max drawdown', 'worst loss so far', 'how far did it drop from the peak', 'biggest decline', 'how bad can it get', 'peak to trough'],
        ['最大ドローダウン', '最悪の時にどれだけ減った', '高値からどれだけ下がった', '過去最大の下落', '一番ひどい下げ幅', 'ピークからの下落率'],
      ),
      P(['回撤', '最大回撤', '高点', '最糟', '最惨', '跌幅'], ['drawdown', 'peak', 'worst', 'decline', 'drop from'], ['ドローダウン', '下落', '高値から', '最悪', '下げ幅']),
    ),
  ],
  capsules: [
    cap('risk', '是不是太集中在科技股了？', 'Am I too concentrated in tech?', 'テック株に偏りすぎ？', 'concentration'),
    cap('risk', '我的资产波动大吗？', 'How volatile are my assets?', '資産の値動きは激しい？', 'volatility'),
    cap('risk', '最糟的时候亏过多少？', 'What was my worst drawdown?', '最悪の時どれだけ減った？', 'drawdown'),
    cap('risk', '帮我做个风险体检', 'Run a risk check for me', 'リスク診断をして'),
  ],
  followUps: [
    cap('holdings', '那具体是哪些持仓？', 'Which holdings drive that?', 'どの銘柄が原因？', 'top-holding'),
    cap('plan', '定投能分散风险吗？', 'Can auto-invest spread the risk?', '積立でリスクは分散できる？'),
  ],
};

// ---------------------------------------------------------------------------
// 6. plan
// ---------------------------------------------------------------------------
const plan: Destination = {
  id: 'plan',
  icon: '🔁',
  title: L('定投计划', 'Auto-invest', '積立プラン'),
  summary: L('下次扣款日、每月金额与所有定投计划', 'Next run, monthly amount and all recurring plans', '次回の引き落とし・毎月の金額・積立プラン一覧'),
  anchors: ['next-run', 'monthly-amount', 'plan-list'],
  phrases: P(
    ['定投计划', '我的定投', '自动投资设置', '每月自动买入', '定期定额', '我的扣款计划', '定投怎么设置', '看看自动投资'],
    ['auto-invest', 'my auto invest plan', 'recurring investment', 'dollar cost averaging', 'automatic purchases', 'monthly investing plan', 'scheduled investments', 'savings plan'],
    ['積立プラン', '積立設定', '毎月の積立', '自動積立', 'つみたて投資', '積立投資の状況', '定期購入', 'ドルコスト平均法'],
  ),
  keywords: {
    zh: K(['定投', '定期定额', '自动投资', '自动买入', '扣款', '自动扣款', '基金定投', '每月投', '存钱计划', '储蓄计划', '扣钱', '定投扣', '扣多少'], ['每月', '定期', '计划', '自动', '月投']),
    en: K(['auto invest', 'autoinvest', 'recurring', 'dca', 'dollar cost averaging', 'scheduled', 'plan', 'direct debit'], ['automatic', 'monthly', 'regularly', 'schedule', 'savings']),
    ja: K(['積立', 'つみたて', '定期積立', '自動積立', '積み立て', '引き落とし', 'dca'], ['毎月', '定期', '自動', 'プラン', '計画']),
  },
  anchorIntents: [
    anchor(
      'next-run',
      L('下次扣款', 'Next run', '次回の引き落とし'),
      P(
        ['下次扣款什么时候', '下一次定投哪天', '什么时候自动买入', '下次什么时候扣钱', '下次执行日期', '几号扣款'],
        ['when is the next purchase', 'next auto-invest date', 'when will the next investment run', 'next scheduled buy', 'when does my next payment go out', 'next debit date'],
        ['次の引き落としはいつ', '次回の積立日', '次はいつ買い付けされる', '次の実行日', '次回の購入日はいつ', '次の積立はいつ'],
      ),
      P(['下次', '下一次', '下期', '下个月', '几号扣', '扣款日', '执行日', '什么时候扣', '何时扣', '哪天扣', '什么时候执行'], ['next', 'next run', 'upcoming', 'next date'], ['次回', '次の', '次は', '実行日', '引き落とし日']),
    ),
    anchor(
      'monthly-amount',
      L('每月金额', 'Monthly amount', '毎月の金額'),
      P(
        ['每个月投多少钱', '定投金额是多少', '每期扣多少', '每月投入多少', '一个月扣我多少钱', '每次买多少'],
        ['how much do i invest each month', 'monthly contribution', 'amount per month', 'how much gets invested every time', 'monthly amount', 'how much is deducted'],
        ['毎月いくら積み立ててる', '毎月の積立金額', '一回あたりの購入額', '月にいくら投資', '毎月の引き落とし額', '積立額はいくら'],
      ),
      P(['每月金额', '每期', '每月投', '金额', '每次'], ['per month', 'each month', 'monthly amount', 'contribution', 'every month'], ['毎月', '積立額', '金額', '月額', '一回あたり']),
    ),
    anchor(
      'plan-list',
      L('计划列表', 'Plan list', 'プラン一覧'),
      P(
        ['我有几个定投计划', '所有的定投', '全部自动投资项目', '定投清单', '定投了哪些基金', '有哪些计划在跑'],
        ['list of my auto-invest plans', 'which plans are active', 'all my recurring investments', 'how many plans do i have', 'my scheduled investments', 'plans overview'],
        ['積立プランの一覧', '有効なプランはどれ', '積立の銘柄一覧', '設定中の積立', 'いくつ積立してる', '全部の積立'],
      ),
      P(['计划列表', '定投清单', '几个计划', '所有定投', '有哪些计划'], ['plans', 'all plans', 'active plans', 'how many plans'], ['プラン一覧', '積立一覧', '有効', 'いくつ']),
    ),
  ],
  capsules: [
    cap('plan', '下次扣款是什么时候？', 'When is the next auto-invest run?', '次の引き落としはいつ？', 'next-run'),
    cap('plan', '我每个月定投多少钱？', 'How much do I invest each month?', '毎月いくら積み立ててる？', 'monthly-amount'),
    cap('plan', '我有哪些定投计划？', 'Which plans do I have?', 'どんな積立プランがある？', 'plan-list'),
    cap('plan', '看看我的定投', 'Show my auto-invest', '積立の状況を見せて'),
  ],
  followUps: [
    cap('trades', '上次扣款买了什么？', 'What did the last run buy?', '前回は何が買われた？', 'last-buy'),
    cap('cashflow', '每月扣款后还剩多少？', 'What is left after the debit?', '引き落とし後はいくら残る？'),
  ],
};

// ---------------------------------------------------------------------------
// 7. trades
// ---------------------------------------------------------------------------
const trades: Destination = {
  id: 'trades',
  icon: '🧾',
  title: L('交易记录', 'Trades', '取引履歴'),
  summary: L('最近一次买入与完整的买卖明细', 'Your last buy and the full order history', '直近の買付と売買の全履歴'),
  anchors: ['last-buy', 'trade-list'],
  phrases: P(
    ['交易记录', '我买卖过什么', '最近的买卖', '看看我的成交记录', '我的下单历史', '买入卖出明细', '历史交易', '之前都做了哪些交易'],
    ['trades', 'trade history', 'my orders', 'order history', 'what did i buy and sell', 'buy and sell records', 'past trades', 'trading activity'],
    ['取引履歴', '売買履歴', '注文履歴', '買った売った記録', '過去の取引', '約定履歴', '売買の明細', 'これまでの取引'],
  ),
  keywords: {
    zh: K(['交易', '买入', '卖出', '成交', '下单', '买卖', '委托', '买过', '卖过', '抛了', '加仓', '减仓', '建仓', '清仓', '割肉', '最近买', '最近卖', '下过', '哪些单'], ['买了', '卖了', '操作', '历史']),
    en: K(['trade', 'trades', 'trading', 'buy', 'bought', 'sell', 'sold', 'order', 'orders', 'executed'], ['history', 'activity']),
    ja: K(['取引', '売買', '約定', '注文', '買った', '売った', '買い', '売り', '購入', '売却'], ['履歴', '操作']),
  },
  anchorIntents: [
    anchor(
      'last-buy',
      L('最近买入', 'Last buy', '直近の買付'),
      P(
        ['上次买入是什么时候', '最近一次买了什么', '上一笔买单', '我最后一次买入的是啥', '最近买过什么', '上次下单买的是什么'],
        ['when was my last purchase', 'what did i buy last', 'most recent buy order', 'latest buy', 'last time i bought something', 'my last buy'],
        ['最後に買ったのはいつ', '直近の買い注文', '前回の購入は何', '最新の買付', '最後の買い取引', '直前に何を買った'],
      ),
      P(['上次', '最近一次', '上一笔', '最后一次', '最近买'], ['last buy', 'last time', 'most recent', 'latest', 'last purchase'], ['最後', '前回', '直近', '最新', '直前']),
    ),
    anchor(
      'trade-list',
      L('成交列表', 'Trade list', '約定一覧'),
      P(
        ['全部交易列表', '所有买卖记录', '把成交明细列出来', '历史成交一览', '完整的交易清单', '买卖流水'],
        ['list all trades', 'full trade list', 'every order ive placed', 'all my buys and sells', 'trade log'],
        ['取引一覧', '全ての売買記録', '約定の一覧', '過去の注文をすべて', '取引リスト', '売買の全履歴'],
      ),
      P(['交易列表', '成交列表', '全部交易', '所有交易', '交易清单'], ['trade list', 'trade log', 'all trades', 'every order'], ['取引一覧', '売買一覧', '全履歴', 'すべての取引']),
    ),
  ],
  capsules: [
    cap('trades', '上次买入是什么时候？', 'When was my last buy?', '最後に買ったのはいつ？', 'last-buy'),
    cap('trades', '我买卖过哪些东西？', 'What have I bought and sold?', 'これまで何を売買した？', 'trade-list'),
    cap('trades', '给我看看成交记录', 'Show my trade history', '約定履歴を見せて'),
    cap('trades', '最近一次下单买了什么？', 'What did my latest order buy?', '直近の注文で何を買った？', 'last-buy'),
  ],
  followUps: [
    cap('holdings', '买完现在持有什么？', 'What do I hold now?', '今は何を持ってる？'),
    cap('plan', '这是定投买的吗？', 'Was that an auto-invest buy?', 'これは積立の買付？', 'plan-list'),
  ],
};

export const destinations: Destination[] = [overview, cashflow, holdings, returns, risk, plan, trades];

// ---------------------------------------------------------------------------
// System intents. Keywords stay specific on purpose: generic words such as
// "help" / "guide" / "帮助" live in phrases (exact-match only) so that
// "help me see my returns" still goes to Returns.
// ---------------------------------------------------------------------------
export const systemIntents: SystemIntent[] = [
  {
    id: 'sys:home',
    label: L('首页', 'Home', 'ホーム'),
    phrases: P(
      ['回首页', '返回首页', '回到主页', '回主页', '回到最开始', '回家', '回到首页去', '返回'],
      ['go home', 'back to home', 'home page', 'go to the start', 'go to the beginning', 'take me home', 'go back to the main screen', 'home', 'go back', 'back'],
      ['ホームに戻る', 'トップに戻る', '最初に戻って', 'ホーム画面へ', 'トップページへ', '戻る', 'ホーム'],
    ),
    keywords: P(['首页', '主页', '回家'], ['homepage', 'home', 'main screen', 'go home'], ['ホーム', 'トップページ', '最初に戻']),
  },
  {
    id: 'sys:wheel',
    label: L('轮盘', 'Wheel', 'ホイール'),
    phrases: P(
      ['打开轮盘', '轮盘', '转盘', '显示导航轮盘', '唤出轮盘', '我想用轮盘选', '轮盘菜单'],
      ['open the wheel', 'show the wheel', 'radial menu', 'open the dial', 'wheel please', 'navigation wheel', 'wheel'],
      ['ホイールを開いて', 'ホイールを開く', '円形メニュー', 'ダイヤルを出して', 'ナビホイール', 'ホイール', 'ホイールメニュー'],
    ),
    keywords: P(['轮盘', '转盘', '圆盘'], ['wheel', 'radial menu', 'dial'], ['ホイール', '円形メニュー', 'ダイヤル']),
  },
  {
    id: 'sys:tutorial',
    label: L('教程', 'Tutorial', 'チュートリアル'),
    phrases: P(
      ['教程', '打开教程', '新手引导', '怎么用', '使用说明', '教我怎么用', '帮助', '带我了解一下', '你能做什么', '你会什么', '这个怎么玩'],
      ['tutorial', 'show me the tutorial', 'how do i use this', 'how does this work', 'help me get started', 'user guide', 'onboarding', 'help', 'what can you do', 'how to use'],
      ['チュートリアル', '使い方を教えて', 'ヘルプ', '使い方ガイド', 'はじめてガイド', '操作説明', '使い方', '何ができる', 'できること'],
    ),
    keywords: P(['教程', '新手引导', '使用说明', '教学', '新手教程'], ['tutorial', 'walkthrough', 'onboarding', 'getting started', 'user guide'], ['チュートリアル', '使い方', '操作説明', '入門ガイド']),
  },
];
