import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSignal, hasContinuousBars, ema, atr } from '../lib/strategy.js';
import { spreadPct, sweepBook, roundDownToIncrement } from '../lib/execution.js';
import { CONFIG } from '../lib/config.js';

function risingBars(n = 140) {
  const out = [];
  const tf = CONFIG.timeframeMinutes * 60;
  for (let i = 0; i < n; i++) {
    const close = 1000000 * Math.pow(1.003, i);
    out.push({ time: 1700000000 + i * tf, open: close * 0.999, high: close * 1.001, low: close * 0.998, close, volume: 1000 });
  }
  const last = out.at(-1);
  last.close = Math.max(...out.slice(-61,-1).map(x=>x.high)) * 1.01;
  last.open = last.close * 0.999;
  last.high = last.close * 1.001;
  last.low = last.close * 0.998;
  return out;
}

test('EMA returns a finite series and follows a rising series', () => {
  const v = ema([1,2,3,4], 2);
  assert.equal(v.length,4);
  assert.ok(v[3] > v[0]);
});

test('ATR is positive for valid OHLC bars', () => {
  assert.ok(atr(risingBars(),14) > 0);
});

test('strategy uses closed, continuous candles and identifies a breakout', () => {
  const bars = risingBars();
  assert.equal(hasContinuousBars(bars,73,CONFIG.timeframeMinutes*60),true);
  const signal = evaluateSignal(bars);
  assert.equal(signal.valid,true);
  assert.equal(signal.entry,true);
});

test('strategy rejects a missing candle in the indicator window', () => {
  const bars = risingBars();
  bars[bars.length-2].time += 60;
  assert.equal(evaluateSignal(bars).reason,'MISSING_CANDLE_IN_INDICATOR_WINDOW');
});

test('spread is computed from best bid and ask', () => {
  assert.ok(Math.abs(spreadPct([[99,2]],[[101,2]]) - 2) < 1e-9);
});

test('sweep consumes multiple book levels and computes weighted average', () => {
  const r = sweepBook([[100,1],[101,2]],2);
  assert.equal(r.ok,true);
  assert.equal(r.quantity,2);
  assert.equal(r.notional,201);
  assert.equal(r.averagePrice,100.5);
});

test('sweep rejects insufficient visible depth', () => {
  assert.equal(sweepBook([[100,1]],2).ok,false);
});

test('quantity rounds down to exchange increment', () => {
  assert.equal(roundDownToIncrement(1.239,0.01),1.23);
});
