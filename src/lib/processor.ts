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
  writeEmail,
} from './evaluator';
import type { ProcessResult } from '@/types';

export async function processMessage(messageId: string): Promise<ProcessResult> {
  const app = await fetchApplicationFromMessage(messageId);

  const auto = isAutomatedSender(app.from, app.subject);
  if (auto.skip) {
    await markReadOnly(messageId).catch(() => {});
    await labelMessage(messageId, 'skipped', true).catch(() => {});
    return { action: 'skipped', reason: auto.reason || 'automated' };
  }

  const extracted = await extractApplication(app);
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

  // Log full evaluation to console — shows up in Vercel function logs for debugging.
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
