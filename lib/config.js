import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/strategy.json'), 'utf8'));
const universePath = path.join(ROOT, 'config/universe.json');
export const UNIVERSE = fs.existsSync(universePath) ? JSON.parse(fs.readFileSync(universePath, 'utf8')) : { status: 'PENDING', symbols: [] };
export const TF_SECONDS = CONFIG.timeframeMinutes * 60;
export const PAIRS = UNIVERSE.status === 'VERIFIED' ? UNIVERSE.symbols : [];
export const FEE_BUY = CONFIG.execution.buyTakerFeeAllInPctOfficial / 100;
export const FEE_SELL = CONFIG.execution.sellTakerFeeAllInPctOfficial / 100;
