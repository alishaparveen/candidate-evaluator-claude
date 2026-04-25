import './_load-env';
import { Redis } from '@upstash/redis';

(async () => {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.error('KV not configured');
    process.exit(1);
  }
  const r = new Redis({ url, token });
  const recent = await r.lrange<string>('evals:recent', 0, -1);
  console.log(`flushing ${recent.length} records`);
  if (recent.length) {
    await Promise.all(recent.map((id) => r.del(`eval:${id}`)));
    await r.del('evals:recent');
  }
  // also clear the replied:* keys (24h TTL would expire them anyway)
  console.log('done.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
