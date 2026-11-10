import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ROOT, TF_SECONDS } from '../lib/config.js';
import { median } from '../lib/strategy.js';

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  return lines.slice(1).map(line => {
    const [time, open, high, low, close, volume] = line.split(',').map(Number);
    return { time, open, high, low, close, volume };
  }).filter(x => [x.time,x.open,x.high,x.low,x.close,x.volume].every(Number.isFinite));
}

const start = Math.floor(Date.parse(CONFIG.backtestStartUtc) / 1000);
const end = start + CONFIG.universeSelection.firstWindowDays * 86400;
const out = [];
for (const symbol of CONFIG.universeCandidates) {
  const file = path.join(ROOT, 'data/history_4h', `${symbol}.csv`);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}; run npm run data:download first`);
  const bars = readCsv(file).filter(b => b.time >= start && b.time < end);
  if (bars.length < Math.floor(CONFIG.universeSelection.firstWindowDays * 24 / CONFIG.timeframeMinutes * 0.8)) {
    throw new Error(`${symbol}: insufficient bars in initial liquidity window (${bars.length})`);
  }
  const med = median(bars.map(b => b.close * b.volume));
  out.push({
  symbol,
  bars: bars.length,
  medianTurnoverPer4hIDR: med,
  pass: med >= CONFIG.universeSelection.minimumMedianTurnoverPer4hIDR
});
}
const selected = out.filter(x => x.pass);
if (selected.length < 3 || selected.length > 10) throw new Error(`Universe must contain 3-10 pairs; passed=${selected.length}. See ${JSON.stringify(out)}`);
const result = {
  status: 'VERIFIED',
  verifiedAt: new Date().toISOString(),
  method: CONFIG.universeSelection.method,
  initialWindowStartUtc: new Date(start * 1000).toISOString(),
  initialWindowEndUtc: new Date(end * 1000).toISOString(),
  minimumMedianTurnoverPer4hIDR: CONFIG.universeSelection.minimumMedianTurnoverPer4hIDR,
  symbols: selected.map(x => x.symbol),
  measurements: out,
  survivorshipBias: CONFIG.universeSelection.survivorshipBiasDisclosure
};
const outPath = path.join(ROOT, 'config/universe.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
