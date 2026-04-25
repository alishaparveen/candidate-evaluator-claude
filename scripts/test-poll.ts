/**
 * Trigger one polling cycle against the real Gmail inbox from your terminal.
 * Useful for debugging before deploying to Vercel.
 *
 * Usage: npm run test:poll
 *
 * Requires a fully filled .env (ANTHROPIC_API_KEY + all GOOGLE_* + EVALUATOR_FROM_EMAIL).
 */
import './_load-env';
import { listPendingMessageIds } from '../src/lib/gmail';
import { processMessage } from '../src/lib/processor';

async function main() {
  const ids = await listPendingMessageIds(5);
  console.log(`Found ${ids.length} pending message(s):`, ids);
  for (const id of ids) {
    try {
      const r = await processMessage(id);
      console.log(`\n--- ${id} ---`);
      console.log(JSON.stringify(r, null, 2));
    } catch (err) {
      console.error(`\n--- ${id} ---\nFAILED:`, err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
