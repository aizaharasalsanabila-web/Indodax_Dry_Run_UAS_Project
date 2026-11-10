import { runTick } from '../lib/bot.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!expected || auth !== `Bearer ${expected}`) return res.status(401).json({ error: 'UNAUTHORIZED' });
  try {
    const result = await runTick(req.body?.source || 'scheduled');
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: 'TICK_FAILED', message: String(error?.message || error) });
  }
}
