function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`MISSING_ENV_${name}`);
  return value;
}

export async function redisCommand(...command) {
  const url = required('UPSTASH_REDIS_REST_URL').replace(/\/$/, '');
  const token = required('UPSTASH_REDIS_REST_TOKEN');
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`REDIS_HTTP_${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`REDIS_${payload.error}`);
  return payload.result;
}

export async function getJson(key, fallback = null) {
  const raw = await redisCommand('GET', key);
  if (raw == null) return fallback;
  return JSON.parse(raw);
}
export async function setJson(key, value) { return redisCommand('SET', key, JSON.stringify(value)); }
export async function appendLog(event, max = 20000) {
  await redisCommand('LPUSH', 'indodax:logs', JSON.stringify(event));
  await redisCommand('LTRIM', 'indodax:logs', 0, max - 1);
}
export async function appendSnapshot(snapshot, max = 50000) {
  await redisCommand('LPUSH', 'indodax:snapshots', JSON.stringify(snapshot));
  await redisCommand('LTRIM', 'indodax:snapshots', 0, max - 1);
}
