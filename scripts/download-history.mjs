import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ROOT, TF_SECONDS } from '../lib/config.js';
import { getServerTime, getHistory } from '../lib/indodax.js';

const start = Math.floor(Date.parse(CONFIG.backtestStartUtc) / 1000) - 700 * TF_SECONDS;
const symbols = CONFIG.universeCandidates;
const outDir = path.join(ROOT, 'data/history_4h');
fs.mkdirSync(outDir, { recursive: true });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function csvEscape(n) { return Number(n).toString(); }

const serverTime = await getServerTime();
console.log(`Indodax server time: ${new Date(serverTime * 1000).toISOString()}`);
console.log(`Download timeframe=240m from ${new Date(start * 1000).toISOString()} for ${symbols.join(', ')}`);

for (const symbol of symbols) {
  let cursor = serverTime;
  const byTime = new Map();
  let pages = 0;
  while (cursor > start && pages < 100) {
    const pageFrom = Math.max(start, cursor - 640 * TF_SECONDS);
    const bars = await getHistory(symbol, CONFIG.timeframeMinutes, pageFrom, cursor);
    pages += 1;
    for (const b of bars) if (b.time >= start && b.time + TF_SECONDS <= serverTime) byTime.set(b.time, b);
    if (!bars.length) {
      if (pages === 1) throw new Error(`${symbol}: API returned no historical candles`);
      break;
    }
    const oldest = bars[0].time;
    if (oldest >= cursor - TF_SECONDS) throw new Error(`${symbol}: pagination did not move backwards (oldest=${oldest}, cursor=${cursor})`);
    cursor = oldest - 1;
    console.log(`${symbol}: page ${pages}, ${bars.length} bars, oldest=${new Date(oldest * 1000).toISOString()}`);
    await wait(450); // <= 3 requests/second, sequential only
  }
  if (cursor > start && pages >= 100) throw new Error(`${symbol}: safety page limit reached before backtest start`);
  const rows = [...byTime.values()].sort((a,b) => a.time - b.time);
  if (rows.length < 1000) throw new Error(`${symbol}: only ${rows.length} candles; insufficient for a 3-year 4h backtest`);
  const lines = ['time,open,high,low,close,volume', ...rows.map(b => [b.time,b.open,b.high,b.low,b.close,b.volume].map(csvEscape).join(','))];
  const out = path.join(outDir, `${symbol}.csv`);
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log(`${symbol}: saved ${rows.length} candles -> ${path.relative(ROOT, out)}`);
}
console.log('Download complete. Next: npm run universe:check');
