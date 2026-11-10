import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { CONFIG, ROOT } from '../lib/config.js';

function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function git(args, allowFailure = false) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0 && !allowFailure) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return (r.stdout || '').trim();
}
const universeFile = path.join(ROOT,'config/universe.json');
const snapshotsFile = path.join(ROOT,'data/snapshots.jsonl');
if (!fs.existsSync(universeFile)) throw new Error('No verified universe. Run npm run universe:check first.');
if (!fs.existsSync(snapshotsFile)) throw new Error('No real order-book snapshots. Run npm run preflight first.');
const universe = JSON.parse(fs.readFileSync(universeFile,'utf8'));
if (universe.status !== 'VERIFIED' || universe.symbols.length < 3 || universe.symbols.length > 10) throw new Error('Universe must be verified and contain 3-10 pairs.');
const snapshots = fs.readFileSync(snapshotsFile,'utf8').split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));
for (const symbol of universe.symbols) {
  const n = snapshots.filter(x=>x.symbol===symbol && Number.isFinite(Number(x.spreadPct))).length;
  if (n < 1) throw new Error(`${symbol}: no real order-book snapshot`);
  const measured = snapshots.filter(x=>x.symbol===symbol && Number.isFinite(Number(x.spreadPct)) && Number.isFinite(Number(x.buySweepSlippagePct)) && Number.isFinite(Number(x.sellSweepSlippagePct)));
  if (measured.length < 1) throw new Error(`${symbol}: spread and both sweep slippage measurements are required`);
  if (n < 3) console.warn(`WARNING ${symbol}: only ${n} snapshot(s); UAS recommends snapshots at least 3x/day.`);
  const hist = path.join(ROOT,'data/history_4h',`${symbol}.csv`);
  if (!fs.existsSync(hist)) throw new Error(`Missing 4h history for ${symbol}`);
  const rows = fs.readFileSync(hist,'utf8').trim().split(/\r?\n/);
  if (rows.length < 1000) throw new Error(`${symbol}: history file too short; download >=3 years first`);
  const firstTime = Number(rows[1]?.split(',')[0]);
  const lastTime = Number(rows.at(-1)?.split(',')[0]);
  const startTime = Math.floor(Date.parse(CONFIG.backtestStartUtc)/1000);
  if (!(firstTime <= startTime - 100 * 86400 && lastTime - startTime >= 3 * 365 * 86400)) throw new Error(`${symbol}: history does not cover 3 years plus indicator warm-up`);
}
const backtestFile = path.join(ROOT,'results/backtest.json');
if (!fs.existsSync(backtestFile)) throw new Error('Run npm run backtest and inspect results/backtest.json before freezing.');
const backtest = JSON.parse(fs.readFileSync(backtestFile,'utf8'));
if (backtest.mode !== 'HISTORICAL_BACKTEST' || backtest.metrics?.initialCapitalIDR !== CONFIG.initialCapitalIDR) throw new Error('Backtest result is not the expected full historical backtest.');
if (Date.parse(backtest.backtestEndUtc) - Date.parse(backtest.backtestStartUtc) < 3 * 365 * 86400000) throw new Error('Backtest output does not span at least three years.');
const expectedHashes = { strategyConfigSha256: sha(path.join(ROOT,'config/strategy.json')), universeSha256: sha(universeFile), signalEngineSha256: sha(path.join(ROOT,'lib/strategy.js')), executionEngineSha256: sha(path.join(ROOT,'lib/execution.js')) };
for (const [key,value] of Object.entries(expectedHashes)) if (backtest.sourceHashes?.[key] !== value) throw new Error(`Backtest source hash mismatch for ${key}; rerun backtest after the last strategy/config edit.`);
if (backtest.sourceHashes?.snapshotDataSha256 !== sha(snapshotsFile)) throw new Error('Backtest snapshot hash mismatch; rerun measured-cost backtest.');
const historyDataHashes = Object.fromEntries(universe.symbols.map(s=>[s,sha(path.join(ROOT,'data/history_4h',`${s}.csv`))]));
for (const [symbol,value] of Object.entries(historyDataHashes)) if (backtest.sourceHashes?.historyDataSha256?.[symbol] !== value) throw new Error(`Backtest historical data hash mismatch for ${symbol}; rerun backtest.`);
if (fs.existsSync(path.join(ROOT,'.env'))) throw new Error('.env exists; remove it from repository/worktree and keep secrets in deployment environment only.');
const scheduled = Date.parse(CONFIG.forwardTest.scheduledStartUtc);
const now = new Date();
const lateByHours = Math.max(0,(now.getTime()-scheduled)/3600000);
const record = {
  status: now.getTime() > scheduled ? 'LATE_FREEZE' : 'ON_TIME_FREEZE',
  actualFreezeAt: now.toISOString(),
  originallyScheduledFreezeAt: '2026-11-04T05:00:00.000Z',
  originallyScheduledForwardStartAt: CONFIG.forwardTest.scheduledStartUtc,
  lateByHours: Number(lateByHours.toFixed(2)),
  forwardTestStartPlannedAt: now.toISOString(),
  forwardTestActualStartAt: null,
  forwardTestActualStartRule: 'Set only by first successful deployed tick; never backdate.',
  strategyConfigSha256: sha(path.join(ROOT,'config/strategy.json')),
  universeSha256: sha(universeFile),
  signalEngineSha256: sha(path.join(ROOT,'lib/strategy.js')),
  executionEngineSha256: sha(path.join(ROOT,'lib/execution.js')),
  snapshotDataSha256: sha(snapshotsFile),
  historyDataSha256: historyDataHashes,
  universe: universe.symbols,
  orderBookSnapshotCounts: Object.fromEntries(universe.symbols.map(s=>[s,snapshots.filter(x=>x.symbol===s).length])),
  feeSourceUrl: CONFIG.execution.feeSourceUrl,
  feeEffectiveDate: CONFIG.execution.feeEffectiveDate,
  feeSourceAccessedAt: now.toISOString(),
  officialTakerFeeAllInPct: { buy: CONFIG.execution.buyTakerFeeAllInPctOfficial, sell: CONFIG.execution.sellTakerFeeAllInPctOfficial },
  apiTakerFeePctByPair: Object.fromEntries(universe.symbols.map(s=>[s, snapshots.find(x=>x.symbol===s)?.pairFeeTakerPct ?? null])),
  note: 'This is a truthful late freeze. It does not claim a freeze on 4 November or create historical forward-test logs.'
};
fs.writeFileSync(path.join(ROOT,'freeze.json'),JSON.stringify(record,null,2)+'\n');

const gitDir = path.join(ROOT,'.git');
if (!fs.existsSync(gitDir)) git(['init']);
if (!git(['config','user.name'],true) || !git(['config','user.email'],true)) throw new Error('Set your own Git author first: git config user.name "Your Name" and git config user.email "your-email"');
git(['add','-A']);
const status = git(['status','--porcelain']);
if (!status) throw new Error('Nothing to commit; freeze record is unchanged.');
git(['commit','-m',`Freeze Indodax dry-run strategy (${record.status.toLowerCase()})`]);
const commit = git(['rev-parse','HEAD']);
const tag = `freeze-late-${now.toISOString().slice(0,10)}`;
git(['tag','-a',tag,'-m',`Freeze tag for commit ${commit}; actual timestamp ${now.toISOString()}. This is a late freeze, not the scheduled 4 November freeze.`,commit]);
console.log(JSON.stringify({ ...record, commit, tag, next: 'Deploy this exact commit, then start the forward log at the first successful /api/tick.' },null,2));
