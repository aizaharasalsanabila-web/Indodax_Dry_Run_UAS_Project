import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TF_SECONDS } from '../lib/config.js';

const forwardFile = path.join(ROOT, 'data/forward_logs.json');
const replayFile = path.join(ROOT, 'results/backtest_forward_window.json');
if (!fs.existsSync(forwardFile) || !fs.existsSync(replayFile)) throw new Error('Need data/forward_logs.json and results/backtest_forward_window.json');
const forward = JSON.parse(fs.readFileSync(forwardFile,'utf8'));
const replay = JSON.parse(fs.readFileSync(replayFile,'utf8'));
const summaries = (forward.logs || []).filter(x=>x.type==='tick_summary').sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
const forwardDecisions = new Map();
for (const s of summaries) for (const [symbol,d] of Object.entries(s.signalDecisions || {})) {
  if (!d.candleTime) continue;
  const key = `${symbol}:${d.candleTime}`;
  const prior = forwardDecisions.get(key);
  if (!prior || (!prior.candleProcessedOnTime && d.candleProcessedOnTime)) forwardDecisions.set(key,{...d,timestamp:s.timestamp});
}
const replayDecisions = new Map((replay.signalDecisions || []).map(d=>[`${d.symbol}:${d.candleTime}`,d]));
const keys = new Set([...forwardDecisions.keys(),...replayDecisions.keys()]);
const mismatches = [];
let compared = 0;
for (const key of keys) {
  const f = forwardDecisions.get(key), b = replayDecisions.get(key);
  if (!f || !b) { mismatches.push({ key, type: !f ? 'MISSING_FORWARD_DECISION' : 'MISSING_BACKTEST_DECISION' }); continue; }
  if (f.duplicate) continue;
  compared++;
  if (Boolean(f.valid)!==Boolean(b.valid) || Boolean(f.entry)!==Boolean(b.entry) || Boolean(f.exit)!==Boolean(b.exit)) mismatches.push({ key, forward:{valid:f.valid,entry:f.entry,exit:f.exit,reason:f.reason}, backtest:{valid:b.valid,entry:b.entry,exit:b.exit,reason:b.reason} });
}
const signalMismatches = mismatches.filter(x=>!x.type);
const missingDecisions = mismatches.filter(x=>x.type);
const orderLogs = (forward.logs || []).filter(x=>x.type==='simulated_order').sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
const apiErrorCount = (forward.logs || []).filter(x=>x.type==='api_error' || x.type==='tick_error').length;
const killSwitchCount = (forward.logs || []).filter(x=>x.type==='manual_kill_switch').length;
const openBuys = new Map();
const closedTrades = [];
let forwardFees = 0, forwardSpreadSlippage = 0;
function orderCosts(o) {
  const qty = Number(o.quantity || 0);
  const bid = Number(o.bestBid || 0), ask = Number(o.bestAsk || 0), fill = Number(o.averageFillPrice || 0);
  const spread = bid > 0 && ask >= bid ? qty * (ask - bid) / 2 : 0;
  const slip = o.side === 'buy' ? qty * Math.max(0, fill - ask) : qty * Math.max(0, bid - fill);
  return { spread, slip, fee: Number(o.feeIDR || 0) };
}
for (const o of orderLogs) {
  const c = orderCosts(o);
  forwardFees += c.fee;
  forwardSpreadSlippage += c.spread + c.slip;
  if (o.side === 'buy') openBuys.set(o.symbol,o);
  if (o.side === 'sell') {
    const buy = openBuys.get(o.symbol);
    if (!buy) continue;
    const bc = orderCosts(buy);
    const totalCost = bc.fee + c.fee + bc.spread + c.spread + bc.slip + c.slip;
    const net = Number(o.realizedPnlIDR || 0);
    closedTrades.push({ symbol:o.symbol, netPnlIDR:net, estimatedTotalCostIDR:totalCost, estimatedGrossPnlIDR:net+totalCost });
    openBuys.delete(o.symbol);
  }
}
const wins = closedTrades.filter(t=>t.netPnlIDR>0);
const losses = closedTrades.filter(t=>t.netPnlIDR<0);
const netWins = wins.reduce((s,t)=>s+t.netPnlIDR,0);
const netLosses = Math.abs(losses.reduce((s,t)=>s+t.netPnlIDR,0));
const grossProfit = closedTrades.reduce((s,t)=>s+Math.max(0,t.estimatedGrossPnlIDR),0);
const equityLogs = summaries.filter(x=>Number.isFinite(x.equityIDR));
const initial = forward.state?.initialCapitalIDR ?? null;
const final = equityLogs.at(-1)?.equityIDR ?? null;
let peak = initial ?? -Infinity, maxDd = 0;
for (const s of equityLogs) { peak = Math.max(peak,s.equityIDR); if (peak>0) maxDd = Math.max(maxDd,1-s.equityIDR/peak); }
const start = Date.parse(forward.state?.startedAt || summaries[0]?.timestamp || new Date().toISOString());
const end = Date.parse(summaries.at(-1)?.timestamp || new Date().toISOString());
const elapsedBars = Math.max(1, Math.floor((end-start)/(TF_SECONDS*1000))+1);
const expected = elapsedBars * (replay.universe || []).length;
const processed = new Set();
for (const [key,d] of forwardDecisions) if (d.candleProcessedOnTime) processed.add(key);
const forwardCandleTimes = [...forwardDecisions.values()].map(d=>Number(d.candleTime)).filter(Number.isFinite).sort((a,b)=>a-b);
const forwardCandleStart = forwardCandleTimes.length ? forwardCandleTimes[0] : null;
const forwardCandleEnd = forwardCandleTimes.length ? forwardCandleTimes.at(-1) : null;
const replayWindowMatchesForward = forwardCandleStart != null && Math.floor(Date.parse(replay.backtestStartUtc)/1000) === forwardCandleStart && Math.floor(Date.parse(replay.backtestEndUtc)/1000) === forwardCandleEnd;
const forwardReturnPct = initial>0 && final!=null ? (final/initial-1)*100 : null;
const forwardMetrics = {
  initialCapitalIDR: initial, finalEquityIDR: final, totalReturnPct: forwardReturnPct,
  maxDrawdownPct: maxDd*100, closedTrades: closedTrades.length,
  winRatePct: closedTrades.length ? wins.length/closedTrades.length*100 : null,
  profitFactor: netLosses>0 ? netWins/netLosses : (netWins>0 ? null : 0),
  averageWinNetIDR: wins.length ? netWins/wins.length : null,
  averageLossNetIDR: losses.length ? losses.reduce((s,t)=>s+t.netPnlIDR,0)/losses.length : null,
  feesIDR: forwardFees, estimatedSpreadSlippageIDR: forwardSpreadSlippage,
  estimatedCostsShareOfGrossProfitPct: grossProfit>0 ? (forwardFees+forwardSpreadSlippage)/grossProfit*100 : null
};
const result = {
  generatedAt: new Date().toISOString(),
  forwardTestActualStart: forward.state?.startedAt || summaries[0]?.timestamp || null,
  forwardTestLastCall: summaries.at(-1)?.timestamp || null,
  forwardCandleWindow: { startUtc: forwardCandleStart == null ? null : new Date(forwardCandleStart*1000).toISOString(), endUtc: forwardCandleEnd == null ? null : new Date(forwardCandleEnd*1000).toISOString() },
  replayWindowMatchesForward,
  elapsedHours: Math.max(0,(end-start)/3600000),
  forwardMetrics,
  signalDecisionPairsCompared: compared,
  signalMismatchCount: signalMismatches.length,
  signalMatchPct: compared ? (compared-signalMismatches.length)/compared*100 : null,
  missingDecisionCount: missingDecisions.length,
  signalDecisionCoveragePct: replayDecisions.size ? compared/replayDecisions.size*100 : null,
  actualTickCalls: summaries.length,
  approximateExpectedTickCalls: elapsedBars,
  uniqueValidForwardPairCandles: processed.size,
  approximateExpectedPairCandles: expected,
  approximateUptimePct: expected ? processed.size/expected*100 : null,
  apiErrorCount,
  killSwitchEvents: killSwitchCount,
  backtestWindowMetrics: replay.metrics,
  returnGapPctPoints: replay.metrics?.totalReturnPct != null && forwardReturnPct != null ? forwardReturnPct - replay.metrics.totalReturnPct : null,
  maxDrawdownGapPctPoints: replay.metrics?.maxDrawdownPct != null ? forwardMetrics.maxDrawdownPct - replay.metrics.maxDrawdownPct : null,
  closedTradeCountGap: replay.metrics?.trades != null ? forwardMetrics.closedTrades - replay.metrics.trades : null,
  mismatches: mismatches.slice(0,500),
  warnings: ['Forward period is shorter than the required 10 full days if actual start is after 2026-11-04 12:00 WIB.', 'Spread/slippage cost for forward orders is estimated from the recorded best bid/ask and sweep fill; it is not a historical order-book replay.', 'Signal comparison is meaningful only when replayWindowMatchesForward is true and the same frozen configuration is used.', 'Uptime denominator is an approximation based on 4h intervals × fixed universe; inspect scheduler logs and candle timestamps before submission.']
};
const out = path.join(ROOT,'results/forward_comparison.json');
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
