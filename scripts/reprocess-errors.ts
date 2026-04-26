/**
 * Find every message labeled `evaluator/error` and re-process it cleanly:
 * remove the error label, clear KV processed/error markers, and let the
 * existing pipeline (now hardened against malformed-JSON failures via
 * tool_use) handle it.
 *
 * Usage:   npm run reprocess-errors
 *
 * Idempotent — running it again on a message that succeeds the second time
 * is a no-op (the message will already have a terminal label like
 * evaluated / needs-info / spam-filtered).
 */
import './_load-env';
import { getGmailClient, labelName } from '../src/lib/gmail';
import { processMessage } from '../src/lib/processor';
import { isStoreConfigured } from '../src/lib/store';
import { Redis } from '@upstash/redis';

(async () => {
  const gmail = getGmailClient();
  const errorLabel = labelName('error');

  // Get the error label ID
  const labels = await gmail.users.labels.list({ userId: 'me' });
  const errorLabelId = labels.data.labels?.find((l) => l.name === errorLabel)?.id;
  if (!errorLabelId) {
    console.log('no evaluator/error label exists in this inbox — nothing to reprocess.');
    return;
  }

  // Find every message with the error label
  const found = await gmail.users.messages.list({
    userId: 'me',
    q: `label:${errorLabel}`,
    maxResults: 50,
  });
  const messageIds = (found.data.messages || []).map((m) => m.id!).filter(Boolean);
  console.log(`found ${messageIds.length} message(s) with the error label`);

  // Optional: clear KV markers so the per-message dedup doesn't short-circuit us.
  let redis: Redis | null = null;
  if (isStoreConfigured()) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL!;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN!;
    redis = new Redis({ url, token });
  }

  for (const id of messageIds) {
    console.log(`\n--- ${id} ---`);
    try {
      // Strip the error label so the polling query semantics are clean.
      await gmail.users.messages.modify({
        userId: 'me',
        id,
        requestBody: { removeLabelIds: [errorLabelId] },
      });
      // Clear KV markers (best-effort).
      if (redis) {
        await redis.del(`processed:msg:${id}`).catch(() => {});
        await redis.del(`eval:${id}`).catch(() => {});
      }
      const result = await processMessage(id);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(`  failed for ${id}:`, err instanceof Error ? err.message : err);
    }
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
