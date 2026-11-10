import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG, ROOT, TF_SECONDS, FEE_BUY, FEE_SELL } from '../lib/config.js';
import { evaluateSignal, median } from '../lib/strategy.js';
import { roundDownToIncrement } from '../lib/execution.js';

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  return lines.slice(1).map(line => {
    const [time, open, high, low, close, volume] = line.split(',').map(Number);
    return { time, open, high, low, close, volume };
  }).filter(b => [b.time,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)).sort((a,b)=>a.time-b.time);
}
function readJsonl(file) { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(x => JSON.parse(x)); }
function medianBySymbol(snapshots, symbol, key) {
  return median(snapshots.filter(s => s.symbol === symbol && Number.isFinite(Number(s[key]))).map(s => Number(s[key])));
}
function roundPrice(price, tick, side) {
  if (!(tick > 0)) return price;
  return side === 'buy' ? Math.ceil(price / tick - 1e-10) * tick : Math.floor(price / tick + 1e-10) * tick;
}
function calcDrawdown(curve) {
  let peak = -Infinity, max = 0;
  for (const point of curve) { peak = Math.max(peak, point.equityIDR); if (peak > 0) max = Math.max(max, 1 - point.equityIDR / peak); }
  return max * 100;
}
function parseArg(name) { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; }

const universeFile = path.join(ROOT, 'config/universe.json');
const snapshotFile = path.join(ROOT, 'data/snapshots.jsonl');
if (!fs.existsSync(universeFile)) throw new Error('Run npm run universe:check first');
if (!fs.existsSync(snapshotFile)) throw new Error('No real order-book snapshots. Run npm run preflight and collect real snapshots; measured-cost backtest will not invent spread/slippage.');
const universe = JSON.parse(fs.readFileSync(universeFile, 'utf8'));
if (universe.status !== 'VERIFIED' || universe.symbols.length < 3 || universe.symbols.length > 10) throw new Error('Universe is not verified (must contain 3-10 pairs)');
const snapshots = readJsonl(snapshotFile);
const requestedStart = parseArg('from');
const requestedEnd = parseArg('to');
const startSec = requestedStart ? Math.floor(Date.parse(requestedStart) / 1000) : Math.floor(Date.parse(CONFIG.backtestStartUtc) / 1000);
const endSec = requestedEnd ? Math.floor(Date.parse(requestedEnd) / 1000) : Infinity;
if (!Number.isFinite(startSec) || (requestedEnd && !Number.isFinite(endSec))) throw new Error('Invalid --from or --to date; use ISO date/time.');

const cost = {};
const series = {};
for (const symbol of universe.symbols) {
  const file = path.join(ROOT, 'data/history_4h', `${symbol}.csv`);
  if (!fs.existsSync(file)) throw new Error(`Missing historical data for ${symbol}`);
  const bars = readCsv(file);
  const first = bars.find(b => b.time >= startSec);
  const last = bars.filter(b => b.time <= endSec).at(-1);
  if (!first || !last) throw new Error(`${symbol}: requested date window not present in history file`);
  if (!requestedStart && last.time - first.time < 3 * 365 * 86400) throw new Error(`${symbol}: historical range is less than 3 years`);
  const spread = medianBySymbol(snapshots, symbol, 'spreadPct');
  const buySlip = medianBySymbol(snapshots, symbol, 'buySweepSlippagePct');
  const sellSlip = medianBySymbol(snapshots, symbol, 'sellSweepSlippagePct');
  const sampleCount = snapshots.filter(s => s.symbol === symbol && Number.isFinite(Number(s.spreadPct))).length;
  if (![spread,buySlip,sellSlip].every(Number.isFinite)) throw new Error(`${symbol}: measured spread/slippage missing; cannot claim measured execution costs.`);
  const sample = snapshots.find(s => s.symbol === symbol);
  const apiFeeRate = Number(sample?.pairFeeTakerPct || 0) / 100;
  cost[symbol] = {
    spreadPct: spread, buySlippagePct: buySlip, sellSlippagePct: sellSlip,
    buyFeeRate: Math.max(FEE_BUY, apiFeeRate), sellFeeRate: Math.max(FEE_SELL, apiFeeRate),
    minOrderIDR: Math.max(CONFIG.execution.minimumOrderIDR, Number(sample?.pairMinBaseCurrencyIDR || 0)),
    quantityIncrement: Number(sample?.quantityIncrement || 0.00000001),
    priceIncrement: Number(sample?.priceIncrement || 0),
    snapshotCount: sampleCount, snapshotNotionalIDR: sample?.referenceNotionalIDR || null
  };
  // Keep pre-window warm-up bars so the same signal function has its indicators ready.
  series[symbol] = bars.filter(b => b.time <= endSec && b.time >= startSec - 800 * TF_SECONDS);
}

const eventsByTime = new Map();
const timeMaps = {};
const signalDecisions = [];
for (const [symbol, bars] of Object.entries(series)) {
  timeMaps[symbol] = new Map(bars.map(b => [b.time, b]));
  for (let i = 0; i < bars.length - 1; i++) {
    const bar = bars[i];
    if (bar.time < startSec - 800 * TF_SECONDS || bar.time >= endSec) continue;
    const signal = evaluateSignal(bars.slice(0, i + 1));
    if (bar.time >= startSec) signalDecisions.push({ symbol, candleTime: bar.time, valid: Boolean(signal.valid), entry: Boolean(signal.entry), exit: Boolean(signal.exit), reason: signal.reason || (signal.valid ? 'OK' : 'INVALID'), roc: Number.isFinite(signal.roc) ? signal.roc : null });
    if (!signal.valid || bar.time < startSec) continue;
    const executionBar = bars[i + 1];
    if (executionBar.time - bar.time !== TF_SECONDS || executionBar.time > endSec) continue;
    const event = { symbol, signal, signalBar: bar, executionBar };
    if (!eventsByTime.has(executionBar.time)) eventsByTime.set(executionBar.time, []);
    eventsByTime.get(executionBar.time).push(event);
  }
}

const allTimes = [...new Set(Object.values(timeMaps).flatMap(m => [...m.keys()].filter(t => t >= startSec && t <= endSec)))].sort((a,b)=>a-b);
let cash = CONFIG.initialCapitalIDR;
const positions = {};
const cooldownUntil = {};
const trades = [];
const curve = [];
const latestClose = {};
let dailyDateWIB = null, dailyStartEquity = null, dailyLossLocked = false;
let cumulativeFees = 0, cumulativeSpreadSlippage = 0;

function markedEquity() {
  const marked = Object.entries(positions).reduce((sum,[sym,p]) => {
    const c = cost[sym];
    const px = latestClose[sym] || p.entryPrice;
    return sum + p.quantity * px * (1 - (c.spreadPct / 2) / 100); // mark open positions on bid-side proxy
  }, 0);
  return cash + marked;
}

for (const time of allTimes) {
  const currentBars = [];
  for (const [symbol, map] of Object.entries(timeMaps)) {
    const bar = map.get(time);
    if (bar) { latestClose[symbol] = bar.open; currentBars.push({ symbol, bar }); }
  }
  const events = eventsByTime.get(time) || [];
  // Exits are processed before entries.
  for (const ev of events) {
    const pos = positions[ev.symbol];
    if (!pos) continue;
    const stopTouched = ev.signalBar.low <= pos.stopPrice;
    if (!stopTouched && !ev.signal.exit) continue;
    const c = cost[ev.symbol];
    const rawExit = ev.executionBar.open;
    const frictionPct = c.spreadPct / 2 + c.sellSlippagePct;
    const fill = roundPrice(rawExit * (1 - frictionPct / 100), c.priceIncrement, 'sell');
    const grossNotional = pos.quantity * fill;
    const exitFee = grossNotional * c.sellFeeRate;
    const exitFriction = pos.quantity * Math.max(0, rawExit - fill);
    cash += grossNotional - exitFee;
    const grossPnl = pos.quantity * (rawExit - pos.rawEntryPrice);
    const totalCosts = pos.entryFee + exitFee + pos.entryFriction + exitFriction;
    const netPnl = grossPnl - totalCosts;
    trades.push({ symbol: ev.symbol, entryTime: pos.entryTime, exitTime: time, quantity: pos.quantity, rawEntryPrice: pos.rawEntryPrice, entryFillPrice: pos.entryPrice, rawExitPrice: rawExit, exitFillPrice: fill, grossPnlIDR: grossPnl, entryFeeIDR: pos.entryFee, exitFeeIDR: exitFee, spreadSlippageIDR: pos.entryFriction + exitFriction, netPnlIDR: netPnl, exitReason: stopTouched ? 'ATR_STOP_TOUCHED_ON_CLOSED_BAR' : 'TWO_CLOSES_BELOW_EMA30' });
    cumulativeFees += exitFee;
    cumulativeSpreadSlippage += exitFriction;
    delete positions[ev.symbol];
    cooldownUntil[ev.symbol] = ev.signalBar.time + (CONFIG.entry.cooldownBarsAfterExit + 1) * TF_SECONDS;
  }

  // First call after 00:00 WIB becomes daily equity baseline; daily loss blocks entries only.
  const dateWIB = new Date((time + 7 * 3600) * 1000).toISOString().slice(0, 10);
  let equity = markedEquity();
  if (dailyDateWIB !== dateWIB) { dailyDateWIB = dateWIB; dailyStartEquity = equity; dailyLossLocked = false; }
  if (dailyStartEquity > 0 && equity <= dailyStartEquity * (1 - CONFIG.risk.dailyLossLimitPct)) dailyLossLocked = true;

  if (!dailyLossLocked) {
    for (const ev of [...events].sort((a,b)=>b.signal.roc-a.signal.roc)) {
      if (positions[ev.symbol] || !ev.signal.entry || ev.signal.exit || ev.signalBar.time < Number(cooldownUntil[ev.symbol] || 0)) continue;
      if (Object.keys(positions).length >= CONFIG.risk.maxOpenPositions) break;
      const c = cost[ev.symbol];
      const rawEntry = ev.executionBar.open;
      const frictionPct = c.spreadPct / 2 + c.buySlippagePct;
      const fill = roundPrice(rawEntry * (1 + frictionPct / 100), c.priceIncrement, 'buy');
      equity = markedEquity();
      const exposure = Object.entries(positions).reduce((sum,[sym,p]) => sum + p.quantity * (latestClose[sym] || p.entryPrice), 0);
      const stopDistance = ev.signal.atr * CONFIG.exit.stopAtrMultiple;
      const qtyRisk = equity * CONFIG.risk.riskPerTradePct / stopDistance;
      const qtyPosition = equity * CONFIG.risk.maxPositionPctEquity / fill;
      const qtyGross = Math.max(0, equity * CONFIG.risk.maxGrossExposurePctEquity - exposure) / fill;
      const qtyCash = cash / (fill * (1 + c.buyFeeRate));
      const qty = roundDownToIncrement(Math.min(qtyRisk, qtyPosition, qtyGross, qtyCash), c.quantityIncrement);
      if (!(qty > 0) || qty * fill < c.minOrderIDR) continue;
      const notional = qty * fill;
      const entryFee = notional * c.buyFeeRate;
      if (notional + entryFee > cash) continue;
      const entryFriction = qty * Math.max(0, fill - rawEntry);
      cash -= notional + entryFee;
      positions[ev.symbol] = { quantity: qty, rawEntryPrice: rawEntry, entryPrice: fill, entryNotional: notional, entryFee, entryFriction, entryTime: time, stopPrice: fill - stopDistance };
      cumulativeFees += entryFee;
      cumulativeSpreadSlippage += entryFriction;
    }
  }
  for (const item of currentBars) latestClose[item.symbol] = item.bar.close;
  equity = markedEquity();
  curve.push({ time, timestamp: new Date(time * 1000).toISOString(), dateWIB, equityIDR: equity, cashIDR: cash, openPositions: Object.keys(positions).length, dailyLossLocked });
}

const finalEquity = curve.at(-1)?.equityIDR ?? CONFIG.initialCapitalIDR;
const years = Math.max(1 / 365.25, ((curve.at(-1)?.time || startSec) - startSec) / 86400 / 365.25);
const wins = trades.filter(t => t.netPnlIDR > 0);
const losses = trades.filter(t => t.netPnlIDR < 0);
const grossWins = trades.reduce((s,t)=>s+Math.max(0,t.grossPnlIDR),0);
const grossLosses = trades.reduce((s,t)=>s+Math.max(0,-t.grossPnlIDR),0);
const netWins = trades.reduce((s,t)=>s+Math.max(0,t.netPnlIDR),0);
const netLosses = trades.reduce((s,t)=>s+Math.max(0,-t.netPnlIDR),0);
let benchmark = null;
if (series.BTCIDR?.length) {
  const btc = series.BTCIDR.filter(b => b.time >= startSec && b.time <= endSec);
  if (btc.length >= 2) {
    const c = cost.BTCIDR;
    const rawEntry = btc[0].open;
    const buyFriction = c.spreadPct / 2 + c.buySlippagePct;
    const buyPrice = roundPrice(rawEntry * (1 + buyFriction / 100), c.priceIncrement, 'buy');
    const buyQty = roundDownToIncrement(CONFIG.initialCapitalIDR / (buyPrice * (1 + c.buyFeeRate)), c.quantityIncrement);
    const buyFee = buyQty * buyPrice * c.buyFeeRate;
    const rawExit = btc.at(-1).close;
    const sellFriction = c.spreadPct / 2 + c.sellSlippagePct;
    const sellPrice = roundPrice(rawExit * (1 - sellFriction / 100), c.priceIncrement, 'sell');
    const sellFee = buyQty * sellPrice * c.sellFeeRate;
    const endValue = CONFIG.initialCapitalIDR - buyQty * buyPrice - buyFee + buyQty * sellPrice - sellFee;
    benchmark = { symbol: 'BTCIDR', startUtc: new Date(btc[0].time*1000).toISOString(), endUtc: new Date(btc.at(-1).time*1000).toISOString(), quantity: buyQty, buyPrice, sellPrice, buyFeeIDR: buyFee, sellFeeIDR: sellFee, endEquityIDR: endValue, returnPct: (endValue / CONFIG.initialCapitalIDR - 1) * 100 };
  }
}
const metrics = {
  initialCapitalIDR: CONFIG.initialCapitalIDR, finalEquityIDR: finalEquity,
  totalReturnPct: (finalEquity / CONFIG.initialCapitalIDR - 1) * 100,
  cagrPct: (Math.pow(finalEquity / CONFIG.initialCapitalIDR, 1 / years) - 1) * 100,
  maxDrawdownPct: calcDrawdown(curve), trades: trades.length,
  winRatePct: trades.length ? wins.length / trades.length * 100 : null,
  profitFactor: netLosses > 0 ? netWins / netLosses : (netWins > 0 ? null : 0),
  averageWinNetIDR: wins.length ? wins.reduce((s,t)=>s+t.netPnlIDR,0)/wins.length : null,
  averageLossNetIDR: losses.length ? losses.reduce((s,t)=>s+t.netPnlIDR,0)/losses.length : null,
  grossProfitIDR: grossWins, grossLossIDR: grossLosses,
  feesIDR: cumulativeFees, spreadSlippageIDR: cumulativeSpreadSlippage,
  costsShareOfGrossProfitPct: grossWins > 0 ? (cumulativeFees + cumulativeSpreadSlippage) / grossWins * 100 : null,
  openPositionsAtEnd: Object.keys(positions).length,
  benchmarkBTCBuyHoldReturnPct: benchmark?.returnPct ?? null
};
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const output = {
  generatedAt: new Date().toISOString(), mode: requestedStart ? 'SAME_WINDOW_REPLAY' : 'HISTORICAL_BACKTEST',
  sourceHashes: { strategyConfigSha256: sha(path.join(ROOT,'config/strategy.json')), universeSha256: sha(universeFile), signalEngineSha256: sha(path.join(ROOT,'lib/strategy.js')), executionEngineSha256: sha(path.join(ROOT,'lib/execution.js')), snapshotDataSha256: sha(snapshotFile), historyDataSha256: Object.fromEntries(universe.symbols.map(symbol=>[symbol,sha(path.join(ROOT,'data/history_4h',`${symbol}.csv`))])) },
  timeframe: CONFIG.timeframeLabel, backtestStartUtc: new Date(startSec * 1000).toISOString(),
  backtestEndUtc: new Date((curve.at(-1)?.time || startSec) * 1000).toISOString(),
  strategy: CONFIG.strategyName, universe: universe.symbols, universeMeasurements: universe.measurements,
  costSource: 'MEDIAN_REAL_ORDERBOOK_SNAPSHOTS', snapshotCostModel: cost,
  warnings: [universe.survivorshipBias, 'Order-book snapshots collected after the originally scheduled 4-November freeze are late samples and cannot prove pre-freeze spread/slippage.', 'Historical fills use next 4h open adjusted by median measured half-spread and sweep slippage; forward fills consume live order-book levels.'],
  metrics, benchmark, trades, signalDecisions, equityCurve: curve
};
const filename = requestedStart ? 'backtest_forward_window.json' : 'backtest.json';
const out = path.join(ROOT, 'results', filename);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ output: path.relative(ROOT,out), metrics, costSource: output.costSource, snapshotsPerPair: Object.fromEntries(Object.entries(cost).map(([s,v])=>[s,v.snapshotCount])) }, null, 2));
