/**
 * One-shot script: walks every Gmail message that already carries an
 * evaluator/* label and re-runs extraction + evaluation, writing the result
 * to Upstash so the /dashboard page has historical content.
 *
 * IMPORTANT: this does NOT send any reply emails. It only re-creates
 * KV records for messages we already replied to in the past.
 *
 *   npm run backfill
 *
 * Optional: pass --max=N to cap how many messages to backfill per label.
 */
import './_load-env';
import {
  getGmailClient,
  fetchApplicationFromMessage,
  labelName,
} from '../src/lib/gmail';
import {
  extractApplication,
  findMissingFields,
  gatherSignals,
  evaluate,
  isAutomatedSender,
  isLikelyApplication,
} from '../src/lib/evaluator';
import { saveEvaluation, isStoreConfigured } from '../src/lib/store';

const maxArg = process.argv.find((a) => a.startsWith('--max='));
const MAX_PER_LABEL = maxArg ? Number(maxArg.split('=')[1]) : 30;

async function listByLabel(label: string): Promise<string[]> {
  const gmail = getGmailClient();
  const out: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: `label:${label}`,
      maxResults: 50,
      pageToken,
    });
    for (const m of res.data.messages || []) {
      if (m.id) out.push(m.id);
      if (out.length >= MAX_PER_LABEL) return out;
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

async function main() {
  if (!isStoreConfigured()) {
    console.error('KV not configured. Set UPSTASH_REDIS_REST_URL + TOKEN (or KV_REST_API_URL + TOKEN) in .env.');
    process.exit(1);
  }

  const labels = ['evaluated', 'needs-info', 'skipped', 'error'].map(labelName);
  console.log(`Backfilling up to ${MAX_PER_LABEL} per label: ${labels.join(', ')}\n`);

  let totalWritten = 0;
  for (const lbl of labels) {
    const ids = await listByLabel(lbl);
    console.log(`-- ${lbl}: ${ids.length} message(s)`);
    for (const id of ids) {
      try {
        const app = await fetchApplicationFromMessage(id);

        if (lbl.endsWith('/skipped')) {
          const auto = isAutomatedSender(app.from, app.subject);
          await saveEvaluation({
            messageId: id,
            threadId: app.threadId,
            candidateEmail: app.from,
            candidateName: null,
            subject: app.subject,
            receivedAt: app.receivedAt,
            processedAt: new Date().toISOString(),
            action: 'skipped',
            reason: auto.reason || 'no application signal (backfill)',
          });
          process.stdout.write('s');
          totalWritten++;
          continue;
        }

        if (lbl.endsWith('/error')) {
          await saveEvaluation({
            messageId: id,
            threadId: app.threadId,
            candidateEmail: app.from,
            candidateName: null,
            subject: app.subject,
            receivedAt: app.receivedAt,
            processedAt: new Date().toISOString(),
            action: 'error',
            errorMessage: '(historical error — backfilled)',
          });
          process.stdout.write('e');
          totalWritten++;
          continue;
        }

        const extracted = await extractApplication(app);

        if (lbl.endsWith('/needs-info')) {
          const missing = findMissingFields(extracted);
          await saveEvaluation({
            messageId: id,
            threadId: app.threadId,
            candidateEmail: app.from,
            candidateName: extracted.candidateName,
            subject: app.subject,
            receivedAt: app.receivedAt,
            processedAt: new Date().toISOString(),
            action: 'requested_info',
            missing,
          });
          process.stdout.write('i');
          totalWritten++;
          continue;
        }

        if (lbl.endsWith('/evaluated')) {
          if (!isLikelyApplication(extracted, app)) {
            process.stdout.write('-');
            continue;
          }
          const { github, portfolio } = await gatherSignals(extracted);
          const evaluation = await evaluate(extracted, github, portfolio);
          await saveEvaluation({
            messageId: id,
            threadId: app.threadId,
            candidateEmail: app.from,
            candidateName: extracted.candidateName,
            subject: app.subject,
            receivedAt: app.receivedAt,
            processedAt: new Date().toISOString(),
            action: 'evaluated',
            decision: evaluation.decision,
            weightedTotal: evaluation.weightedTotal,
            scores: evaluation.scores,
            summary: evaluation.summary,
            strengths: evaluation.strengths,
            concerns: evaluation.concerns,
            reasonForRejection: evaluation.reasonForRejection,
            suggestedNextSteps: evaluation.suggestedNextSteps,
          });
          process.stdout.write(evaluation.decision === 'pass' ? 'P' : 'F');
          totalWritten++;
        }
      } catch (err) {
        process.stdout.write('x');
        console.error(`\n  failed for ${id}:`, err);
      }
    }
    console.log(`\n   wrote ${totalWritten} so far`);
  }
  console.log(`\nDone. ${totalWritten} record(s) in KV.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
