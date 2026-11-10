export function spreadPct(bids, asks) {
  if (!bids?.length || !asks?.length) return NaN;
  const bid = Number(bids[0][0]);
  const ask = Number(asks[0][0]);
  if (!(bid > 0 && ask > 0 && ask >= bid)) return NaN;
  return ((ask - bid) / ((ask + bid) / 2)) * 100;
}

/** Consume actual depth levels. Buy consumes asks; sell consumes bids. No mid/close fills. */
export function sweepBook(levels, quantity) {
  let remaining = Number(quantity);
  if (!(remaining > 0) || !Array.isArray(levels) || !levels.length) return { ok: false, reason: 'EMPTY_BOOK_OR_INVALID_QTY' };
  let notional = 0;
  let filled = 0;
  for (const level of levels) {
    const price = Number(level[0]);
    const available = Number(level[1]);
    if (!(price > 0 && available > 0)) continue;
    const take = Math.min(remaining, available);
    filled += take;
    notional += take * price;
    remaining -= take;
    if (remaining <= Math.max(1e-12, quantity * 1e-10)) break;
  }
  if (remaining > Math.max(1e-12, quantity * 1e-10)) return { ok: false, reason: 'INSUFFICIENT_VISIBLE_DEPTH', requested: quantity, filled };
  return { ok: true, quantity: filled, notional, averagePrice: notional / filled, bestPrice: Number(levels[0][0]), slippagePct: Math.abs((notional / filled) / Number(levels[0][0]) - 1) * 100 };
}

export function roundDownToIncrement(value, increment) {
  const v = Number(value), step = Number(increment);
  if (!(v > 0 && step > 0)) return 0;
  const decimals = Math.min(12, (String(step).split('.')[1] || '').length);
  return Number((Math.floor((v + step * 1e-10) / step) * step).toFixed(decimals));
}

export function estimateSweepSlippage(levels, quantity) {
  const result = sweepBook(levels, quantity);
  return result.ok ? result.slippagePct : null;
}
