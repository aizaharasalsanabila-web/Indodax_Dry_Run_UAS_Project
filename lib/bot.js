import crypto from 'node:crypto';
import { CONFIG, PAIRS, TF_SECONDS, FEE_BUY, FEE_SELL } from './config.js';
import { getServerTime, getPairs, getPriceIncrements, getDepth, getHistory, normalizePair } from './indodax.js';
import { evaluateSignal, stopWasTouched } from './strategy.js';
import { spreadPct, sweepBook, roundDownToIncrement, estimateSweepSlippage } from './execution.js';
import { redisCommand, getJson, setJson, appendLog, appendSnapshot } from './redis.js';

const STATE_KEY = 'indodax:state:v1';
const LOCK_KEY = 'indodax:tick_lock';
const KILL_KEY = 'indodax:kill_switch';
const WIB_OFFSET_SECONDS = 7 * 3600;
const iso = seconds => new Date(seconds * 1000).toISOString();
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;

function defaultState() {
  return {
    version: 1,
    initialCapitalIDR: CONFIG.initialCapitalIDR,
    cashIDR: CONFIG.initialCapitalIDR,
    positions: {},
    processedBars: {},
    cooldownUntil: {},
    dailyDateWIB: null,
    dailyStartEquityIDR: null,
    dailyLossLocked: false,
    callCount: 0,
    startedAt: null,
    lastRunAt: null,
    lastServerTime: null,
    errors: 0,
    apiErrors: 0,
    simulatedOrders: 0
  };
}

function dayKeyWib(serverTime) {
  return new Date((serverTime + WIB_OFFSET_SECONDS) * 1000).toISOString().slice(0, 10);
}

function calcEquity(state, books) {
  let marked = 0;
  for (const [symbol, pos] of Object.entries(state.positions)) {
    const book = books[symbol];
    const bid = Number(book?.buy?.[0]?.[0]);
    marked += pos.quantity * (bid > 0 ? bid : pos.lastMarkPrice || pos.entryPrice);
  }
  return state.cashIDR + marked;
}

function feeFor(pair, side) {
  const apiPct = Number(pair.trade_fee_percent_taker);
  const apiRate = Number.isFinite(apiPct) ? apiPct / 100 : 0;
  return Math.max(apiRate, side === 'buy' ? FEE_BUY : FEE_SELL);
}

function makeSnapshot(symbol, serverTime, book, pair, increments) {
  const bids = Array.isArray(book?.buy) ? book.buy : [];
  const asks = Array.isArray(book?.sell) ? book.sell : [];
  const spread = spreadPct(bids, asks);
  const bestAsk = Number(asks[0]?.[0]);
  const bestBid = Number(bids[0]?.[0]);
  const refQty = bestAsk > 0 ? CONFIG.execution.snapshotReferenceNotionalIDR / bestAsk : 0;
  return {
    type: 'orderbook_snapshot', symbol, timestamp: iso(serverTime), serverTime,
    bestBid: bestBid || null, bestAsk: bestAsk || null, spreadPct: Number.isFinite(spread) ? spread : null,
    referenceNotionalIDR: CONFIG.execution.snapshotReferenceNotionalIDR,
    pairFeeTakerPct: Number(pair?.trade_fee_percent_taker ?? 0),
    pairMinBaseCurrencyIDR: Number(pair?.trade_min_base_currency ?? 0),
    quantityIncrement: Number(pair?.quantity_increment ?? 0.00000001),
    priceIncrement: Number(increments?.[String(pair?.ticker_id || pair?.id).toLowerCase()] ?? 0),
    buySweepSlippagePct: refQty > 0 ? estimateSweepSlippage(asks, refQty) : null,
    sellSweepSlippagePct: refQty > 0 ? estimateSweepSlippage(bids, refQty) : null,
    bids, asks
  };
}

async function logEvent(event) {
  await appendLog({ timestamp: new Date().toISOString(), ...event });
}

export async function runTick(requestSource = 'manual') {
  const nowWall = new Date().toISOString();
  const lock = crypto.randomUUID();
  const lockResult = await redisCommand('SET', LOCK_KEY, lock, 'NX', 'EX', 180);
  if (lockResult !== 'OK') return { status: 'SKIPPED', reason: 'ANOTHER_TICK_HOLDS_LOCK' };

  try {
    const killEnv = String(process.env.KILL_SWITCH || '').toLowerCase() === 'true';
    const killRedis = await redisCommand('GET', KILL_KEY);
    if (killEnv || killRedis === '1') {
      await logEvent({ type: 'kill_switch_active', source: requestSource, envFlag: killEnv, redisFlag: killRedis === '1' });
      return { status: 'STOPPED', reason: 'KILL_SWITCH_ACTIVE' };
    }

    const serverTime = await getServerTime();
    const [rawPairs, increments] = await Promise.all([getPairs(), getPriceIncrements()]);
    const pairMap = new Map(rawPairs.map(normalizePair).map(p => [p.symbol, p]));
    const state = await getJson(STATE_KEY, defaultState());
    if (!state.startedAt) state.startedAt = iso(serverTime);
    state.callCount += 1;
    state.lastRunAt = nowWall;
    state.lastServerTime = serverTime;

    const activePairs = PAIRS.map(symbol => pairMap.get(symbol)).filter(p => p && !Number(p.is_maintenance) && !Number(p.is_market_suspended));
    if (activePairs.length < 3) throw new Error(`UNIVERSE_INVALID_ACTIVE_PAIRS_${activePairs.length}_OF_${PAIRS.length}`);

    const market = {};
    const signals = {};
    const errors = [];
    for (const pair of activePairs) {
      try {
        const [bars, depth] = await Promise.all([
          getHistory(pair.symbol, CONFIG.timeframeMinutes, serverTime - 700 * TF_SECONDS, serverTime),
          getDepth(pair.id)
        ]);
        market[pair.symbol] = { pair, bars, depth };
        const snapshot = makeSnapshot(pair.symbol, serverTime, depth, pair, increments);
        await appendSnapshot(snapshot);
        const last = bars.at(-1);
        const age = last ? serverTime - (last.time + TF_SECONDS) : Infinity;
        const bookValid = depth?.buy?.length > 0 && depth?.sell?.length > 0;
        const spread = snapshot.spreadPct;
        const candleValid = Boolean(last)
          && age <= 2 * TF_SECONDS
          && [last.open,last.high,last.low,last.close,last.volume].every(v => Number.isFinite(v) && v > 0);
        const spreadValid = Number.isFinite(spread) && spread <= CONFIG.execution.maxSpreadPct;
        const signal = candleValid ? evaluateSignal(bars) : { valid: false, reason: age > 2 * TF_SECONDS ? 'STALE_CANDLE' : 'INVALID_LAST_CANDLE' };
        let duplicate = false;
        if (candleValid && signal.valid && Number.isFinite(signal.candleTime)) {
          const idem = await redisCommand('SET', `indodax:processed:${pair.symbol}:${signal.candleTime}`, '1', 'NX', 'EX', 7776000);
          duplicate = idem !== 'OK';
          if (!duplicate) state.processedBars[pair.symbol] = signal.candleTime;
        }
        signals[pair.symbol] = { signal, snapshot, candleValid, bookValid, spreadValid, dataValid: candleValid && bookValid && spreadValid, age, duplicate };
        if (!signal.valid) errors.push({ symbol: pair.symbol, reason: signal.reason || 'INVALID_SIGNAL_DATA' });
        if (!bookValid) errors.push({ symbol: pair.symbol, reason: 'EMPTY_ORDER_BOOK' });
        if (bookValid && !spreadValid) errors.push({ symbol: pair.symbol, reason: 'INVALID_SPREAD' });
        if (duplicate) errors.push({ symbol: pair.symbol, reason: 'CANDLE_ALREADY_PROCESSED_IDEMPOTENCY' });
      } catch (error) {
        const message = String(error?.message || error);
        errors.push({ symbol: pair.symbol, reason: message });
        state.apiErrors = (state.apiErrors || 0) + 1;
        await logEvent({ type: 'api_error', symbol: pair.symbol, error: message, timestamp: iso(serverTime) });
      }
    }

    // Daily equity baseline: first bot call observed after 00:00 WIB.
    const wibDay = dayKeyWib(serverTime);
    const books = Object.fromEntries(Object.entries(market).map(([s, m]) => [s, m.depth]));
    let equity = calcEquity(state, books);
    if (state.dailyDateWIB !== wibDay) {
      state.dailyDateWIB = wibDay;
      state.dailyStartEquityIDR = equity;
      state.dailyLossLocked = false;
      await logEvent({ type: 'daily_equity_baseline', dateWIB: wibDay, equityIDR: equity, rule: 'first_call_after_00:00_WIB' });
    }
    if (Number(state.dailyStartEquityIDR) > 0 && equity <= Number(state.dailyStartEquityIDR) * (1 - CONFIG.risk.dailyLossLimitPct)) {
      state.dailyLossLocked = true;
      await logEvent({ type: 'daily_loss_limit_triggered', dateWIB: wibDay, equityIDR: equity, startEquityIDR: state.dailyStartEquityIDR, limitPct: CONFIG.risk.dailyLossLimitPct * 100 });
    }

    const orderEvents = [];
    // Exit positions first. Only use valid, closed candles and current bid depth.
    for (const [symbol, pos] of Object.entries({ ...state.positions })) {
      const m = market[symbol];
      const s = signals[symbol];
      if (!m || !s?.candleValid || !s?.bookValid || !s.signal?.valid || s.duplicate) continue;
      const last = m.bars.at(-1);
      const touched = stopWasTouched(m.bars, pos.stopPrice);
      if (!touched && !s.signal.exit) continue;
      const minimumIDR = Math.max(CONFIG.execution.minimumOrderIDR, Number(m.pair.trade_min_base_currency || 0));
      const bestBidForMinimum = Number(m.depth.buy?.[0]?.[0]);
      if (!(bestBidForMinimum > 0) || pos.quantity * bestBidForMinimum < minimumIDR) {
        await logEvent({ type: 'order_rejected', side: 'sell', symbol, reason: 'BELOW_MINIMUM_ORDER', quantity: pos.quantity, estimatedNotionalIDR: pos.quantity * (bestBidForMinimum || 0), minimumIDR, candleTime: s.signal.candleTime });
        continue;
      }
      const fill = sweepBook(m.depth.buy, pos.quantity);
      if (!fill.ok) {
        await logEvent({ type: 'order_rejected', side: 'sell', symbol, reason: fill.reason, quantity: pos.quantity, candleTime: s.signal.candleTime });
        continue;
      }
      const feeRate = feeFor(m.pair, 'sell');
      const gross = fill.notional;
      const fee = gross * feeRate;
      state.cashIDR += gross - fee;
      const pnl = gross - fee - (pos.entryNotionalIDR + pos.entryFeeIDR);
      delete state.positions[symbol];
      state.cooldownUntil[symbol] = s.signal.candleTime + (CONFIG.entry.cooldownBarsAfterExit + 1) * TF_SECONDS;
      state.simulatedOrders += 1;
      const event = {
        type: 'simulated_order', timestamp: iso(serverTime), symbol, side: 'sell', quantity: pos.quantity,
        bestBid: fill.bestPrice, bestAsk: Number(m.depth.sell[0][0]), averageFillPrice: fill.averagePrice,
        feeRate, feeIDR: fee, grossNotionalIDR: gross, signalReferenceClose: last.close, fillVsSignalPct: (fill.averagePrice / last.close - 1) * 100,
        slippageVsBestPct: fill.slippagePct, spreadPct: s.snapshot.spreadPct,
        reason: touched ? 'INITIAL_ATR_STOP_TOUCHED' : 'TWO_CLOSES_BELOW_EMA30', realizedPnlIDR: pnl,
        candleTime: s.signal.candleTime, dryRun: true
      };
      orderEvents.push(event);
      await logEvent(event);
    }

    equity = calcEquity(state, books);
    const candidates = activePairs
      .filter(p => signals[p.symbol]?.candleValid && signals[p.symbol]?.bookValid && signals[p.symbol]?.spreadValid && signals[p.symbol]?.signal?.valid && !signals[p.symbol]?.duplicate && signals[p.symbol].signal.entry && !state.positions[p.symbol] && Number(signals[p.symbol].signal.candleTime) >= Number(state.cooldownUntil?.[p.symbol] || 0))
      .sort((a,b) => signals[b.symbol].signal.roc - signals[a.symbol].signal.roc);

    if (!state.dailyLossLocked) {
      for (const pair of candidates) {
        if (Object.keys(state.positions).length >= CONFIG.risk.maxOpenPositions) break;
        const m = market[pair.symbol];
        const s = signals[pair.symbol];
        const asks = m.depth.sell;
        const bestAsk = Number(asks?.[0]?.[0]);
        const bestBid = Number(m.depth.buy?.[0]?.[0]);
        const spread = s.snapshot.spreadPct;
        if (!(bestAsk > 0 && bestBid > 0 && spread <= CONFIG.execution.maxSpreadPct)) continue;
        equity = calcEquity(state, books);
        const currentExposure = Object.entries(state.positions).reduce((sum, [sym, p]) => sum + p.quantity * Number(books[sym]?.buy?.[0]?.[0] || p.lastMarkPrice || p.entryPrice), 0);
        const stopDistance = s.signal.atr * CONFIG.exit.stopAtrMultiple;
        if (!(stopDistance > 0 && s.signal.close > stopDistance)) continue;
        const riskBudget = equity * CONFIG.risk.riskPerTradePct;
        const qtyByRisk = riskBudget / stopDistance;
        const qtyByPosition = equity * CONFIG.risk.maxPositionPctEquity / bestAsk;
        const remainingGross = Math.max(0, equity * CONFIG.risk.maxGrossExposurePctEquity - currentExposure);
        const qtyByGross = remainingGross / bestAsk;
        const buyFeeRate = feeFor(pair, 'buy');
        const qtyByCash = state.cashIDR / (bestAsk * (1 + buyFeeRate));
        const increment = Number(pair.quantity_increment || 0.00000001);
        let quantity = roundDownToIncrement(Math.min(qtyByRisk, qtyByPosition, qtyByGross, qtyByCash), increment);
        const minimumIDR = Math.max(CONFIG.execution.minimumOrderIDR, Number(pair.trade_min_base_currency || 0));
        if (quantity <= 0 || quantity * bestAsk < minimumIDR || quantity < Number(pair.trade_min_traded_currency || 0)) {
          await logEvent({ type: 'signal_not_executed', symbol: pair.symbol, reason: 'BELOW_MINIMUM_OR_ZERO_SIZE', quantity, bestAsk, minimumIDR, candleTime: s.signal.candleTime });
          continue;
        }
        const fill = sweepBook(asks, quantity);
        if (!fill.ok) {
          await logEvent({ type: 'order_rejected', side: 'buy', symbol: pair.symbol, reason: fill.reason, quantity, candleTime: s.signal.candleTime });
          continue;
        }
        const gross = fill.notional;
        const fee = gross * buyFeeRate;
        if (gross + fee > state.cashIDR) {
          await logEvent({ type: 'order_rejected', side: 'buy', symbol: pair.symbol, reason: 'INSUFFICIENT_VIRTUAL_CASH', quantity, gross, fee });
          continue;
        }
        state.cashIDR -= gross + fee;
        const stopPrice = fill.averagePrice - stopDistance;
        state.positions[pair.symbol] = {
          symbol: pair.symbol, quantity, entryPrice: fill.averagePrice, entryNotionalIDR: gross,
          entryFeeIDR: fee, entryTime: iso(serverTime), entryCandleTime: s.signal.candleTime,
          stopPrice, lastMarkPrice: bestBid
        };
        state.simulatedOrders += 1;
        const event = {
          type: 'simulated_order', timestamp: iso(serverTime), symbol: pair.symbol, side: 'buy', quantity,
          bestBid, bestAsk, averageFillPrice: fill.averagePrice, feeRate: buyFeeRate, feeIDR: fee,
          grossNotionalIDR: gross, signalReferenceClose: s.signal.close, fillVsSignalPct: (fill.averagePrice / s.signal.close - 1) * 100, breakoutHigh: s.signal.breakoutHigh,
          atr: s.signal.atr, stopPrice, slippageVsBestPct: fill.slippagePct, spreadPct: spread,
          rocPct: s.signal.roc * 100, medianTurnoverIDR: s.signal.medianTurnoverIDR,
          candleTime: s.signal.candleTime, dryRun: true
        };
        orderEvents.push(event);
        await logEvent(event);
      }
    } else {
      await logEvent({ type: 'entries_blocked_daily_loss_limit', dateWIB: wibDay, equityIDR: equity });
    }

    for (const [symbol, pos] of Object.entries(state.positions)) {
      const bid = Number(books[symbol]?.buy?.[0]?.[0]);
      if (bid > 0) pos.lastMarkPrice = bid;
    }
    equity = calcEquity(state, books);
    const summary = {
      type: 'tick_summary', timestamp: iso(serverTime), wallClockTimestamp: nowWall,
      source: requestSource, callCount: state.callCount, dateWIB: wibDay,
      processedPairs: activePairs.length, validPairs: Object.values(signals).filter(s => s.candleValid && s.bookValid && s.spreadValid && s.signal?.valid).length,
      invalidPairs: errors, positions: Object.keys(state.positions).length, cashIDR: state.cashIDR,
      equityIDR: equity, dailyLossLocked: state.dailyLossLocked, simulatedOrdersThisCall: orderEvents.length,
      uptimeEvidence: { lastClosedCandleTimes: Object.fromEntries(Object.entries(signals).map(([s,v]) => [s, v.signal?.candleTime || null])) },
      signalDecisions: Object.fromEntries(Object.entries(signals).map(([symbol,v]) => [symbol, {
        candleTime: v.signal?.candleTime || market[symbol]?.bars?.at(-1)?.time || null,
        valid: Boolean(v.signal?.valid), entry: Boolean(v.signal?.entry), exit: Boolean(v.signal?.exit),
        reason: v.signal?.reason || (!v.candleValid ? 'MARKET_DATA_INVALID' : 'UNKNOWN'),
        roc: Number.isFinite(v.signal?.roc) ? v.signal.roc : null, duplicate: Boolean(v.duplicate),
        candleProcessed: Boolean(v.candleValid && !v.duplicate),
        candleProcessedOnTime: Boolean(v.candleValid && !v.duplicate && Number.isFinite(v.signal?.candleTime ?? market[symbol]?.bars?.at(-1)?.time) && serverTime <= (v.signal?.candleTime ?? market[symbol]?.bars?.at(-1)?.time) + 2 * TF_SECONDS)
      }]))
    };
    await logEvent(summary);
    await setJson(STATE_KEY, state);
    return { status: 'OK', ...summary };
  } catch (error) {
    await logEvent({ type: 'tick_error', timestamp: nowWall, source: requestSource, error: String(error?.stack || error) });
    const state = await getJson(STATE_KEY, defaultState()).catch(() => defaultState());
    state.errors = (state.errors || 0) + 1;
    state.lastError = String(error?.message || error);
    await setJson(STATE_KEY, state).catch(() => {});
    throw error;
  } finally {
    await redisCommand('DEL', LOCK_KEY).catch(() => {});
  }
}

export async function getPublicStatus() {
  const state = await getJson(STATE_KEY, defaultState());
  const kill = await redisCommand('GET', KILL_KEY);
  return {
    mode: 'DRY_RUN_ONLY', killSwitch: kill === '1' || String(process.env.KILL_SWITCH).toLowerCase() === 'true',
    state: { startedAt: state.startedAt, lastRunAt: state.lastRunAt, callCount: state.callCount, simulatedOrders: state.simulatedOrders, errors: state.errors, apiErrors: state.apiErrors || 0, cashIDR: state.cashIDR, positions: state.positions, dailyLossLocked: state.dailyLossLocked, dailyDateWIB: state.dailyDateWIB },
    strategy: { name: CONFIG.strategyName, timeframe: CONFIG.timeframeLabel, universe: PAIRS }
  };
}

export async function setKillSwitch(action, actor = 'manual') {
  if (!['kill', 'resume'].includes(action)) throw new Error('ACTION_MUST_BE_KILL_OR_RESUME');
  await redisCommand('SET', KILL_KEY, action === 'kill' ? '1' : '0');
  await logEvent({ type: 'manual_kill_switch', action, actor, dryRun: true });
  return { killSwitch: action === 'kill' };
}

export async function exportLogs() {
  const [logs, snapshots, state] = await Promise.all([
    redisCommand('LRANGE', 'indodax:logs', 0, 19999),
    redisCommand('LRANGE', 'indodax:snapshots', 0, 49999),
    getJson(STATE_KEY, defaultState())
  ]);
  return { exportedAt: new Date().toISOString(), state, logs: (logs || []).map(x => JSON.parse(x)).reverse(), snapshots: (snapshots || []).map(x => JSON.parse(x)).reverse() };
}
