import { getInstrumentSpec } from '../api/client.js';

function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 8;
  const text = step.toString();
  if (text.includes('e-')) return Number(text.split('e-')[1] ?? 8);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

export function roundQtyToStep(
  qty: number,
  step: number,
  mode: 'floor' | 'ceil' = 'floor'
): number {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 0.001;
  const scaled = qty / safeStep;
  const rounded = mode === 'ceil'
    ? Math.ceil(scaled - Number.EPSILON)
    : Math.floor(scaled + Number.EPSILON);
  return Number((Math.max(rounded, 0) * safeStep).toFixed(decimalsForStep(safeStep)));
}

export function computeQtyPerLevelForPair(
  investmentUsdt: number,
  leverage: number,
  numGrids: number,
  midPrice: number,
  pair: string,
  minNotionalPrice: number = midPrice * 0.8
): number {
  const orderAlloc = 0.75;
  const effCap = investmentUsdt * leverage * orderAlloc;
  const specs = getInstrumentSpec(pair);
  const minSize = specs.min_size > 0 ? specs.min_size : 0.001;
  const minNotional = specs.min_notional > 0 ? specs.min_notional : 5;
  const safeGrids = Math.max(1, numGrids);
  const safePrice = Math.max(0.00000001, midPrice);
  const minPrice = Math.max(0.00000001, minNotionalPrice);

  const rawQty = effCap / safeGrids / safePrice;
  const budgetQty = roundQtyToStep(rawQty, minSize, 'floor');
  const minQtyForNotional = roundQtyToStep(minNotional / minPrice, minSize, 'ceil');

  return Math.max(minSize, minQtyForNotional, budgetQty);
}
