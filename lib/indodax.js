const BASE = 'https://indodax.com';

export async function fetchJson(url, { retries = 2, timeoutMs = 8000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'accept': 'application/json', 'user-agent': 'UAS-Indodax-DryRun/1.0' }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const body = await response.json();
      if (body == null) throw new Error('EMPTY_JSON_RESPONSE');
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function getServerTime() {
  const data = await fetchJson(`${BASE}/api/server_time`);
  const ms = Number(data.server_time);
  if (!Number.isFinite(ms) || ms <= 0) throw new Error('INVALID_SERVER_TIME');
  return Math.floor(ms / 1000);
}

export async function getPairs() {
  const data = await fetchJson(`${BASE}/api/pairs`);
  if (!Array.isArray(data)) throw new Error('INVALID_PAIRS_RESPONSE');
  return data;
}

export async function getPriceIncrements() {
  const data = await fetchJson(`${BASE}/api/price_increments`);
  return data.increments || {};
}

export async function getDepth(pairId) {
  return fetchJson(`${BASE}/api/depth/${encodeURIComponent(pairId.toLowerCase())}`);
}

export async function getHistory(symbol, timeframeMinutes, fromSec, toSec) {
  const url = new URL(`${BASE}/tradingview/history_v2`);
  url.searchParams.set('symbol', symbol.toUpperCase());
  url.searchParams.set('tf', String(timeframeMinutes));
  url.searchParams.set('from', String(fromSec));
  url.searchParams.set('to', String(toSec));
  const data = await fetchJson(url.toString());
  if (!Array.isArray(data)) throw new Error(`INVALID_HISTORY_RESPONSE_${symbol}`);
  const duration = timeframeMinutes * 60;
  return data.map(row => ({
    time: Number(row.Time), open: Number(row.Open), high: Number(row.High), low: Number(row.Low), close: Number(row.Close), volume: Number(row.Volume)
  })).filter(b => Number.isFinite(b.time) && b.time + duration <= toSec && [b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite))
    .sort((a,b) => a.time - b.time);
}

export function normalizePair(pair) {
  const symbol = String(pair.symbol || '').toUpperCase();
  const id = String(pair.id || '').toLowerCase();
  return { ...pair, symbol, id };
}
