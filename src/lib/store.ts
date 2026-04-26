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

export type StoredAction = 'evaluated' | 'requested_info' | 'skipped' | 'spam_filtered' | 'error';

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
  decision?: 'pass' | 'fail' | 'needs_more_info';
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

/**
 * Sender-level dedup. The cron will skip processing a message from a sender
 * we've already replied to within the last `ttlHours` (default 24). Prevents
 * the agent from spamming a marketing list that sends a fresh email every day.
 *
 * IMPORTANT: this dedup is bypassed when the new message arrives in a thread
 * we've already engaged with (see wasThreadEngaged). A candidate replying to
 * our "please send your GitHub" ask shows up under the same sender address,
 * but is the EXPECTED next step in a conversation we started — not a
 * duplicate application.
 */
const REPLIED_KEY = (email: string) => `replied:${email.toLowerCase().trim()}`;

export async function markRepliedToSender(email: string, ttlSeconds = 86_400): Promise<void> {
  if (!isStoreConfigured()) return;
  const redis = getRedis();
  await redis.set(REPLIED_KEY(email), new Date().toISOString(), { ex: ttlSeconds });
}

export async function recentlyRepliedToSender(email: string): Promise<string | null> {
  if (!isStoreConfigured()) return null;
  const redis = getRedis();
  const v = await redis.get<string>(REPLIED_KEY(email));
  return typeof v === 'string' ? v : null;
}

/**
 * Per-thread engagement tracking. When we send any reply (needs-info,
 * pass, fail, more-info), we mark the thread as engaged. Subsequent messages
 * in the same thread are continuations of an active conversation we started,
 * so the sender-level dedup should NOT block them.
 *
 * 30-day TTL — long enough that a candidate following up two weeks later
 * doesn't get a fresh "you already applied" treatment.
 */
const ENGAGED_THREAD_KEY = (threadId: string) => `engaged:thread:${threadId}`;

export async function markThreadEngaged(threadId: string, ttlSeconds = 30 * 86_400): Promise<void> {
  if (!isStoreConfigured()) return;
  const redis = getRedis();
  await redis.set(ENGAGED_THREAD_KEY(threadId), new Date().toISOString(), { ex: ttlSeconds });
}

export async function wasThreadEngaged(threadId: string): Promise<boolean> {
  if (!isStoreConfigured()) return false;
  const redis = getRedis();
  const v = await redis.get<string>(ENGAGED_THREAD_KEY(threadId));
  return typeof v === 'string' && v.length > 0;
}

/**
 * Per-message processed tracking. Belt-and-braces with Gmail labels: if the
 * Gmail search query lets a previously-processed message slip through (e.g.
 * because we relaxed it to allow candidate replies in `needs-info` threads),
 * KV catches the duplicate before we re-process.
 *
 * 14-day TTL — well past the `newer_than:7d` polling window.
 */
const PROCESSED_MSG_KEY = (id: string) => `processed:msg:${id}`;

export async function markMessageProcessed(messageId: string, ttlSeconds = 14 * 86_400): Promise<void> {
  if (!isStoreConfigured()) return;
  const redis = getRedis();
  await redis.set(PROCESSED_MSG_KEY(messageId), new Date().toISOString(), { ex: ttlSeconds });
}

export async function wasMessageProcessed(messageId: string): Promise<boolean> {
  if (!isStoreConfigured()) return false;
  const redis = getRedis();
  const v = await redis.get<string>(PROCESSED_MSG_KEY(messageId));
  return typeof v === 'string' && v.length > 0;
}

// ---------- Test pack records (separate namespace) ----------
//
// The Plum test pack runs 22 .eml fixtures through the dry-run pipeline
// and writes the results here so the dashboard can show "what happened
// vs what the test pack expected". Lives in a separate KV namespace
// (`test:eval:<id>` + `tests:list`) so it doesn't pollute production
// records, and so the dashboard can render it as its own section.

export type TestVerdict = 'PASS' | 'FAIL' | 'SOFT-FAIL';

export type TestResult = {
  fixtureId: string;
  folder: string;
  from: string;
  subject: string;
  expectedDecision: string; // raw from expected_results.json (may be "pass_or_needs_info")
  actualDecision: string; // pass / fail / needs_info / skipped / ERROR
  verdict: TestVerdict;
  weightedTotal?: number;
  scores?: Record<string, number>;
  reasoning?: string;
  filterLayer?: string;
  notes?: string; // expected_results.json's free-text notes for this fixture
  recordedAt: string;
};

const TEST_LIST_KEY = 'tests:list';
const TEST_KEY = (id: string) => `test:eval:${id}`;

export async function saveTestResult(record: TestResult): Promise<void> {
  if (!isStoreConfigured()) return;
  const redis = getRedis();
  await redis.set(TEST_KEY(record.fixtureId), JSON.stringify(record));
}

export async function setTestResultIndex(fixtureIds: string[]): Promise<void> {
  if (!isStoreConfigured()) return;
  const redis = getRedis();
  await redis.del(TEST_LIST_KEY);
  if (fixtureIds.length) await redis.rpush(TEST_LIST_KEY, ...fixtureIds);
}

export async function getTestResults(): Promise<TestResult[]> {
  if (!isStoreConfigured()) return [];
  const redis = getRedis();
  const ids = await redis.lrange(TEST_LIST_KEY, 0, -1);
  if (!ids.length) return [];
  const records = await Promise.all(
    ids.map(async (id) => {
      const raw = await redis.get<string | TestResult>(TEST_KEY(id));
      if (!raw) return null;
      return typeof raw === 'string' ? (JSON.parse(raw) as TestResult) : raw;
    }),
  );
  return records.filter((r): r is TestResult => r !== null);
}

export async function getTestSummary(): Promise<{
  total: number;
  pass: number;
  fail: number;
  softFail: number;
  recordedAt: string | null;
}> {
  const results = await getTestResults();
  let pass = 0, fail = 0, softFail = 0;
  let latest: string | null = null;
  for (const r of results) {
    if (r.verdict === 'PASS') pass++;
    else if (r.verdict === 'SOFT-FAIL') softFail++;
    else fail++;
    if (!latest || r.recordedAt > latest) latest = r.recordedAt;
  }
  return { total: results.length, pass, fail, softFail, recordedAt: latest };
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
    spam_filtered: 0,
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
