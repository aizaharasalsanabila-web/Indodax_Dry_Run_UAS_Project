import { getPublicStatus } from '../lib/bot.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  try { return res.status(200).json(await getPublicStatus()); }
  catch (error) { return res.status(500).json({ error: 'STATUS_FAILED', message: String(error?.message || error) }); }
}
