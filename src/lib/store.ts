import { Redis } from '@upstash/redis';
import type { DimensionScore, MissingField } from '@/types';

let cached: Redis | null = null;

function getRedis(): Redis {
  if (cached) return cached;
  // @upstash/redis auto-reads UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
  // Vercel's Upstash Marketplace integration also injects KV_REST_API_URL +
  // KV_REST_API_TOKEN. Support both so it works regardless of how it's wired.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.REDIS_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.REDIS_TOKEN;
  if (!url || !token) {
    throw new Error(
      'Upstash Redis env vars missing. Expected UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL + KV_REST_API_TOKEN).',
    );
  }
  cached = new Redis({ url, token });
  return cached;
}

export function isStoreConfigured(): boolean {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
      (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN),
  );
}

const RECENT_LIST_KEY = 'evals:recent';
const RECENT_LIST_CAP = 200;

export type StoredAction = 'evaluated' | 'requested_info' | 'skipped' | 'error';

export type StoredEvaluation = {
  messageId: string;
  threadId: string;
  candidateEmail: string;
  candidateName: string | null;
  subject: string;
  receivedAt: string;
  processedAt: string;
  action: StoredAction;
  // present if action === 'evaluated'
  decision?: 'pass' | 'fail';
  weightedTotal?: number;
  scores?: Record<string, DimensionScore>;
  summary?: string;
  strengths?: string[];
  concerns?: string[];
  reasonForRejection?: string;
  suggestedNextSteps?: string;
  // present if action === 'requested_info'
  missing?: MissingField[];
  // present if action === 'skipped' or 'error'
  reason?: string;
  errorMessage?: string;
};

const KEY = (id: string) => `eval:${id}`;

export async function saveEvaluation(record: StoredEvaluation): Promise<void> {
  if (!isStoreConfigured()) return; // graceful no-op when KV not provisioned
  const redis = getRedis();
  await Promise.all([
    redis.set(KEY(record.messageId), JSON.stringify(record)),
    redis.lpush(RECENT_LIST_KEY, record.messageId),
    redis.ltrim(RECENT_LIST_KEY, 0, RECENT_LIST_CAP - 1),
  ]);
}

export async function getEvaluation(messageId: string): Promise<StoredEvaluation | null> {
  if (!isStoreConfigured()) return null;
  const redis = getRedis();
  const raw = await redis.get<string | StoredEvaluation>(KEY(messageId));
  if (!raw) return null;
  return typeof raw === 'string' ? (JSON.parse(raw) as StoredEvaluation) : raw;
}

export async function getRecentEvaluations(limit = 50): Promise<StoredEvaluation[]> {
  if (!isStoreConfigured()) return [];
  const redis = getRedis();
  const ids = await redis.lrange(RECENT_LIST_KEY, 0, limit - 1);
  if (!ids.length) return [];
  const records = await Promise.all(ids.map((id) => getEvaluation(id)));
  return records.filter((r): r is StoredEvaluation => r !== null);
}

export async function getStats(): Promise<{
  total: number;
  byAction: Record<StoredAction, number>;
  passRate: number | null;
  avgScore: number | null;
}> {
  const evals = await getRecentEvaluations(200);
  const byAction: Record<StoredAction, number> = {
    evaluated: 0,
    requested_info: 0,
    skipped: 0,
    error: 0,
  };
  let passes = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  for (const e of evals) {
    byAction[e.action]++;
    if (e.action === 'evaluated') {
      if (e.decision === 'pass') passes++;
      if (typeof e.weightedTotal === 'number') {
        scoreSum += e.weightedTotal;
        scoreCount++;
      }
    }
  }
  return {
    total: evals.length,
    byAction,
    passRate: byAction.evaluated > 0 ? passes / byAction.evaluated : null,
    avgScore: scoreCount > 0 ? scoreSum / scoreCount : null,
  };
}
