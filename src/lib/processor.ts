import {
  fetchApplicationFromMessage,
  fetchMessageIdHeader,
  labelMessage,
  markReadOnly,
  sendReply,
} from './gmail';
import {
  evaluate,
  extractApplication,
  findMissingFields,
  gatherSignals,
  isAutomatedSender,
  isBulkOrAutomated,
  isLikelyApplication,
  passesAllowedTo,
  writeEmail,
} from './evaluator';
import {
  markRepliedToSender,
  recentlyRepliedToSender,
  saveEvaluation,
  type StoredAction,
  type StoredEvaluation,
} from './store';
import type { CandidateApplication, Evaluation, MissingField, ProcessResult } from '@/types';

export async function processMessage(messageId: string): Promise<ProcessResult> {
  const app = await fetchApplicationFromMessage(messageId);

  // Layer 1a — RFC bulk-mail headers (List-Unsubscribe, Precedence, Auto-Submitted).
  // Catches Apollo/Streak/etc. that politely advertise they're marketing.
  const bulk = isBulkOrAutomated(app);
  if (bulk.spam) {
    await markReadOnly(messageId).catch(() => {});
    await labelMessage(messageId, 'spam-filtered', true).catch(() => {});
    await persist(app, 'spam_filtered', null, { reason: bulk.reason });
    return { action: 'skipped', reason: bulk.reason || 'bulk mail' };
  }

  // Layer 1b — Sender-address heuristics for senders that don't bother with headers.
  const auto = isAutomatedSender(app.from, app.subject);
  if (auto.skip) {
    await markReadOnly(messageId).catch(() => {});
    await labelMessage(messageId, 'spam-filtered', true).catch(() => {});
    await persist(app, 'spam_filtered', null, { reason: auto.reason });
    return { action: 'skipped', reason: auto.reason || 'automated' };
  }

  // Demo-mode allowlist: when EVALUATOR_ALLOWED_TO is set, only process mail
  // addressed to that specific address (e.g. apply@yourdomain.com).
  const toCheck = passesAllowedTo(app);
  if (!toCheck.allowed) {
    await markReadOnly(messageId).catch(() => {});
    await labelMessage(messageId, 'skipped', true).catch(() => {});
    await persist(app, 'skipped', null, { reason: toCheck.reason });
    return { action: 'skipped', reason: toCheck.reason || 'not in demo allowlist' };
  }

  // Sender-level dedup. Don't reply to the same human twice within 24h —
  // protects both the candidate (one decision per submission) and us
  // (don't bombard a marketing list that snuck past Layer 1).
  const lastReplied = await recentlyRepliedToSender(app.from).catch(() => null);
  if (lastReplied) {
    await labelMessage(messageId, 'skipped', true).catch(() => {});
    await persist(app, 'skipped', null, { reason: `already replied to ${app.from} at ${lastReplied}` });
    return { action: 'skipped', reason: `already replied to ${app.from} within last 24h` };
  }

  const extracted = await extractApplication(app);

  if (!isLikelyApplication(extracted, app)) {
    await labelMessage(messageId, 'skipped', true).catch(() => {});
    await persist(app, 'skipped', extracted.candidateName, {
      reason: 'no application signal (no resume/github/portfolio/keywords)',
    });
    return { action: 'skipped', reason: 'no application signal (no resume/github/portfolio/keywords)' };
  }

  const missing = findMissingFields(extracted);
  const msgIdHeader = await fetchMessageIdHeader(messageId).catch(() => '');

  if (missing.length > 0) {
    const { subject, body } = await writeEmail({
      kind: 'missing_info',
      candidateName: extracted.candidateName,
      missing,
      received: {
        resume: extracted.hasResume,
        github: !!extracted.githubUsername,
        portfolio: !!extracted.portfolioUrl,
      },
    });
    await sendReply({
      threadId: app.threadId,
      to: app.from,
      toName: app.fromName || extracted.candidateName || undefined,
      originalSubject: app.subject,
      subject,
      body,
      inReplyTo: msgIdHeader,
    });
    await labelMessage(messageId, 'needs-info', true);
    await markRepliedToSender(app.from).catch(() => {});
    await persist(app, 'requested_info', extracted.candidateName, { missing });
    return {
      action: 'requested_info',
      missing,
      candidateEmail: app.from,
      candidateName: extracted.candidateName,
    };
  }

  const { github, portfolio } = await gatherSignals(extracted);
  const evaluation = await evaluate(extracted, github, portfolio);

  const { subject, body } = await writeEmail({
    kind: evaluation.decision,
    candidateName: extracted.candidateName,
    evaluation,
  });
  await sendReply({
    threadId: app.threadId,
    to: app.from,
    toName: app.fromName || extracted.candidateName || undefined,
    originalSubject: app.subject,
    subject,
    body,
    inReplyTo: msgIdHeader,
  });
  await labelMessage(messageId, 'evaluated', true);
  await markRepliedToSender(app.from).catch(() => {});
  await persist(app, 'evaluated', extracted.candidateName, { evaluation });

  console.log('[evaluator] decision', {
    candidate: extracted.candidateEmail,
    name: extracted.candidateName,
    decision: evaluation.decision,
    weightedTotal: evaluation.weightedTotal,
    scores: Object.fromEntries(
      Object.entries(evaluation.scores).map(([k, v]) => [k, v.score]),
    ),
  });

  return {
    action: 'evaluated',
    decision: evaluation.decision,
    weightedTotal: evaluation.weightedTotal,
    candidateEmail: app.from,
    candidateName: extracted.candidateName,
  };
}

async function persist(
  app: CandidateApplication,
  action: StoredAction,
  candidateName: string | null,
  extras: {
    evaluation?: Evaluation;
    missing?: MissingField[];
    reason?: string;
    errorMessage?: string;
  },
): Promise<void> {
  const record: StoredEvaluation = {
    messageId: app.messageId,
    threadId: app.threadId,
    candidateEmail: app.from,
    candidateName,
    subject: app.subject,
    receivedAt: app.receivedAt,
    processedAt: new Date().toISOString(),
    action,
    ...(extras.evaluation
      ? {
          decision: extras.evaluation.decision,
          weightedTotal: extras.evaluation.weightedTotal,
          scores: extras.evaluation.scores,
          summary: extras.evaluation.summary,
          strengths: extras.evaluation.strengths,
          concerns: extras.evaluation.concerns,
          reasonForRejection: extras.evaluation.reasonForRejection,
          suggestedNextSteps: extras.evaluation.suggestedNextSteps,
        }
      : {}),
    ...(extras.missing ? { missing: extras.missing } : {}),
    ...(extras.reason ? { reason: extras.reason } : {}),
    ...(extras.errorMessage ? { errorMessage: extras.errorMessage } : {}),
  };
  // KV failures should never break the actual workflow.
  try {
    await saveEvaluation(record);
  } catch (err) {
    console.error('[store] saveEvaluation failed (non-fatal)', err);
  }
}
