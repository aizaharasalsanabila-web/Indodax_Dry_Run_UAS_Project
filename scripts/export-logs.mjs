import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/config.js';

const base = process.env.BOT_URL;
const secret = process.env.ADMIN_SECRET;
if (!base || !secret) throw new Error('Set BOT_URL and ADMIN_SECRET before exporting logs');
const response = await fetch(`${base.replace(/\/$/,'')}/api/export`, { headers: { 'x-admin-secret': secret }, signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`Export failed: HTTP ${response.status} ${await response.text()}`);
const data = await response.json();
fs.mkdirSync(path.join(ROOT,'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT,'data/forward_logs.json'), JSON.stringify(data, null, 2) + '\n');
fs.writeFileSync(path.join(ROOT,'data/snapshots.jsonl'), (data.snapshots || []).map(x=>JSON.stringify(x)).join('\n') + ((data.snapshots || []).length ? '\n' : ''));
console.log(JSON.stringify({ exportedAt: data.exportedAt, logRows: data.logs?.length || 0, snapshots: data.snapshots?.length || 0, calls: data.state?.callCount || 0, simulatedOrders: data.state?.simulatedOrders || 0 }, null, 2));
