import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ROOT } from '../lib/config.js';
import { getServerTime, getPairs, getDepth, getPriceIncrements, normalizePair } from '../lib/indodax.js';
import { spreadPct, estimateSweepSlippage } from '../lib/execution.js';

const serverTime = await getServerTime();
const [rawPairs, increments] = await Promise.all([getPairs(), getPriceIncrements()]);
const pairMap = new Map(rawPairs.map(normalizePair).map(p => [p.symbol, p]));
const symbols = CONFIG.universeCandidates;
const snapshots = [];
for (const symbol of symbols) {
  const pair = pairMap.get(symbol);
  if (!pair) throw new Error(`${symbol} not present in current /api/pairs`);
  if (Number(pair.is_maintenance) || Number(pair.is_market_suspended)) throw new Error(`${symbol} is in maintenance/suspended state`);
  const depth = await getDepth(pair.id);
  const bids = depth.buy || [], asks = depth.sell || [];
  const spread = spreadPct(bids, asks);
  if (!bids.length || !asks.length || !Number.isFinite(spread) || spread > CONFIG.execution.maxSpreadPct) throw new Error(`${symbol} invalid depth/spread=${spread}`);
  const bestAsk = Number(asks[0][0]);
  const qty = CONFIG.execution.snapshotReferenceNotionalIDR / bestAsk;
  const snapshot = {
    type: 'orderbook_snapshot', symbol, timestamp: new Date(serverTime * 1000).toISOString(), serverTime,
    bestBid: Number(bids[0][0]), bestAsk, spreadPct: spread,
    referenceNotionalIDR: CONFIG.execution.snapshotReferenceNotionalIDR,
    pairFeeTakerPct: Number(pair.trade_fee_percent_taker ?? 0),
    pairMinBaseCurrencyIDR: Number(pair.trade_min_base_currency ?? 0),
    quantityIncrement: Number(pair.quantity_increment ?? 0.00000001),
    priceIncrement: Number(increments[String(pair.ticker_id || pair.id).toLowerCase()] ?? 0),
    buySweepSlippagePct: estimateSweepSlippage(asks, qty),
    sellSweepSlippagePct: estimateSweepSlippage(bids, qty), bids, asks,
    source: 'preflight_public_api'
  };
  snapshots.push(snapshot);
  console.log(`${symbol}: spread=${spread.toFixed(4)}%, buyImpact=${snapshot.buySweepSlippagePct}, sellImpact=${snapshot.sellSweepSlippagePct}`);
}
const file = path.join(ROOT, 'data/snapshots.jsonl');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.appendFileSync(file, snapshots.map(x => JSON.stringify(x)).join('\n') + '\n');
console.log(`Saved ${snapshots.length} real public order-book snapshots to ${path.relative(ROOT, file)}.`);
