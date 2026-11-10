import { CONFIG } from './config.js';

export function ema(values, period) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const alpha = 2 / (period + 1);
  const out = new Array(values.length);
  out[0] = Number(values[0]);
  for (let i = 1; i < values.length; i++) out[i] = alpha * Number(values[i]) + (1 - alpha) * out[i - 1];
  return out;
}

export function atr(bars, period = CONFIG.exit.atrPeriod) {
  if (bars.length < period + 1) return NaN;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const p = bars[i - 1].close;
    trs.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - p), Math.abs(bars[i].low - p)));
  }
  let value = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) value = ((period - 1) * value + trs[i]) / period;
  return value;
}

export function median(values) {
  if (!values.length) return NaN;
  const a = [...values].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function hasContinuousBars(bars, count, timeframeSeconds = 14400) {
  if (bars.length < count) return false;
  const w = bars.slice(-count);
  for (let i = 1; i < w.length; i++) {
    if (w[i].time - w[i - 1].time !== timeframeSeconds) return false;
  }
  return true;
}

/**
 * The one canonical signal function used by both historical backtest and live bot.
 * Input bars must be sorted ascending and contain CLOSED candles only.
 */
export function evaluateSignal(inputBars, cfg = CONFIG) {
  const e = cfg.entry;
  const x = cfg.exit;
  let bars = inputBars.length > cfg.maxSignalHistoryBars ? inputBars.slice(-cfg.maxSignalHistoryBars) : inputBars;
  const minBars = Math.max(e.breakoutLookbackBars + 1, e.emaSlow + e.emaSlopeLookbackBars + 1, e.rocLookbackBars + 1, e.medianTurnoverLookbackBars, x.emaExitPeriod + 2, x.atrPeriod + 1);
  if (bars.length < minBars) return { valid: false, reason: 'INSUFFICIENT_BARS', candleTime: bars.at(-1)?.time ?? null };
  let suffixStart = bars.length - 1;
const timeframeSeconds = cfg.timeframeMinutes * 60;

while (
  suffixStart > 0 &&
  bars[suffixStart].time - bars[suffixStart - 1].time === timeframeSeconds
) {
  suffixStart -= 1;
}

bars = bars.slice(suffixStart);

if (bars.length < minBars) {
  return {
    valid: false,
    reason: 'MISSING_CANDLE_IN_INDICATOR_WINDOW',
    candleTime: bars.at(-1)?.time ?? null
  };
}
  if (bars.some(b => ![b.open,b.high,b.low,b.close,b.volume].every(v => Number.isFinite(v) && v > 0) || b.high < b.low || b.high < Math.max(b.open,b.close) || b.low > Math.min(b.open,b.close))) return { valid: false, reason: 'ZERO_OR_INVALID_OHLCV_IN_INDICATOR_WINDOW', candleTime: bars.at(-1)?.time ?? null };
  const last = bars.length - 1;
  const closes = bars.map(b => b.close);
  const fast = ema(closes, e.emaFast);
  const slow = ema(closes, e.emaSlow);
  const exitEma = ema(closes, x.emaExitPeriod);
  const current = bars[last];
  const priorHighs = bars.slice(last - e.breakoutLookbackBars, last).map(b => b.high);
  const breakoutHigh = Math.max(...priorHighs);
  const roc = current.close / bars[last - e.rocLookbackBars].close - 1;
  const turnoverMedian = median(bars.slice(last - e.medianTurnoverLookbackBars + 1, last + 1).map(b => b.close * b.volume));
  const currentAtr = atr(bars, x.atrPeriod);
  const belowNow = current.close < exitEma[last];
  const belowPrevious = bars[last - 1].close < exitEma[last - 1];
  const exitByTrend = belowNow && belowPrevious;
  const entry = current.close > breakoutHigh * (1 + e.breakoutBufferPct / 100)
    && fast[last] > slow[last]
    && slow[last] > slow[last - e.emaSlopeLookbackBars]
    && roc > 0
    && turnoverMedian >= e.minimumMedianTurnoverIDR;
  return {
    valid: Number.isFinite(currentAtr) && currentAtr > 0 && Number.isFinite(turnoverMedian),
    reason: 'OK',
    candleTime: current.time,
    close: current.close,
    breakoutHigh,
    emaFast: fast[last],
    emaSlow: slow[last],
    emaSlowSlope: slow[last] - slow[last - e.emaSlopeLookbackBars],
    roc,
    medianTurnoverIDR: turnoverMedian,
    atr: currentAtr,
    entry,
    exit: exitByTrend,
    stopHit: false,
    belowExitEma: belowNow
  };
}

export function stopWasTouched(bars, stopPrice) {
  const last = bars.at(-1);
  return Boolean(last && Number.isFinite(stopPrice) && last.low <= stopPrice);
}
