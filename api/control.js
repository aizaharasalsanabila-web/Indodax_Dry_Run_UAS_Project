import { setKillSwitch } from '../lib/bot.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const expected = process.env.ADMIN_SECRET;
  if (!expected || req.headers['x-admin-secret'] !== expected) return res.status(401).json({ error: 'UNAUTHORIZED' });
  try {
    const result = await setKillSwitch(req.body?.action, 'authenticated_admin');
    return res.status(200).json({ status: 'OK', ...result });
  } catch (error) {
    return res.status(400).json({ error: 'CONTROL_FAILED', message: String(error?.message || error) });
  }
}
