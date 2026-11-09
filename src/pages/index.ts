import type { DestId } from '../types';
import { renderOverview } from './overview';
import { renderCashflow } from './cashflow';
import { renderHoldings } from './holdings';
import { renderReturns } from './returns';
import { renderRisk } from './risk';
import { renderPlan } from './plan';
import { renderTrades } from './trades';

export const renderers: Record<DestId, () => HTMLElement> = {
  overview: renderOverview,
  cashflow: renderCashflow,
  holdings: renderHoldings,
  returns: renderReturns,
  risk: renderRisk,
  plan: renderPlan,
  trades: renderTrades,
};

export function renderPage(id: DestId): HTMLElement {
  return renderers[id]();
}
