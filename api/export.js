import { exportLogs } from '../lib/bot.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const expected = process.env.ADMIN_SECRET;
  if (!expected || req.headers['x-admin-secret'] !== expected) return res.status(401).json({ error: 'UNAUTHORIZED' });
  try { return res.status(200).json(await exportLogs()); }
  catch (error) { return res.status(500).json({ error: 'EXPORT_FAILED', message: String(error?.message || error) }); }
}
