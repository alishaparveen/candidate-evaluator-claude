import {
  fetchApplicationFromMessage,
  fetchThreadingHeaders,
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
  looksLikePoorExtraction,
  looksLikeRecruiterOutreach,
  looksNonEnglishOriginal,
  passesAllowedTo,
  writeEmail,
} from './evaluator';
import {
  markMessageProcessed,
  markRepliedToSender,
  markThreadEngaged,
  recentlyRepliedToSender,
  saveEvaluation,
  wasMessageProcessed,
  wasThreadEngaged,
  type StoredAction,
  type StoredEvaluation,
} from './store';
import type { CandidateApplication, Evaluation, MissingField, ProcessResult } from '@/types';

export async function processMessage(messageId: string): Promise<ProcessResult> {
  // Per-message KV dedup. Catches the case where the polling query returns
  // a message we already labeled — happens when the broader query (now
  // including `needs-info` threads so candidate replies come through) picks
  // up the original message a second time before Gmail's index updates, or
  // after a transient processing error.
  if (await wasMessageProcessed(messageId).catch(() => false)) {
    return { action: 'skipped', reason: `message ${messageId} already processed (KV)` };
  }

  const app = await fetchApplicationFromMessage(messageId);

  // Layer 1a — RFC bulk-mail headers (List-Unsubscribe, Precedence, Auto-Submitted).
  // Catches Apollo/Streak/etc. that politely advertise they're marketing.
  const bulk = isBulkOrAutomated(app);
  if (bulk.spam) {
    await markReadOnly(messageId).catch(() => {});
    await labelMessage(messageId, 'spam-filtered', true).catch(() => {});
    await persist(app, 'spam_filtered', null, { reason: bulk.reason });
    await markMessageProcessed(messageId).catch(() => {});
    return { action: 'skipped', reason: bulk.reason || 'bulk mail' };
  }

  // Layer 1b — Sender-address heuristics for senders that don't bother with headers.
  const auto = isAutomatedSender(app.from, app.subject);
  if (auto.skip) {
    await markReadOnly(messageId).catch(() => {});
    await labelMessage(messageId, 'spam-filtered', true).catch(() => {});
    await persist(app, 'spam_filtered', null, { reason: auto.reason });
    await markMessageProcessed(messageId).catch(() => {});
    return { action: 'skipped', reason: auto.reason || 'automated' };
  }

  // Layer 1c — recruiter / agency outreach. They're selling candidates, not
  // applying. Same treatment as marketing.
  const recruiter = looksLikeRecruiterOutreach(app);
  if (recruiter.recruiter) {
    await markReadOnly(messageId).catch(() => {});
    await labelMessage(messageId, 'spam-filtered', true).catch(() => {});
    await persist(app, 'spam_filtered', null, { reason: recruiter.reason });
    await markMessageProcessed(messageId).catch(() => {});
    return { action: 'skipped', reason: recruiter.reason || 'recruiter outreach' };
  }

  // Demo-mode allowlist: when EVALUATOR_ALLOWED_TO is set, only process mail
  // addressed to that specific address (e.g. apply@yourdomain.com).
  const toCheck = passesAllowedTo(app);
  if (!toCheck.allowed) {
    await markReadOnly(messageId).catch(() => {});
    await labelMessage(messageId, 'skipped', true).catch(() => {});
    await persist(app, 'skipped', null, { reason: toCheck.reason });
    await markMessageProcessed(messageId).catch(() => {});
    return { action: 'skipped', reason: toCheck.reason || 'not in demo allowlist' };
  }

  // Sender-level dedup, but ONLY when this is a fresh thread. If the new
  // message is in a thread we already engaged with (we previously sent a
  // needs-info ask in the same thread), the candidate is replying to OUR
  // ask — process it normally so we evaluate the full thread context.
  const isContinuation = await wasThreadEngaged(app.threadId).catch(() => false);
  if (!isContinuation) {
    const lastReplied = await recentlyRepliedToSender(app.from).catch(() => null);
    if (lastReplied) {
      await labelMessage(messageId, 'skipped', true).catch(() => {});
      await persist(app, 'skipped', null, { reason: `already replied to ${app.from} at ${lastReplied}` });
      await markMessageProcessed(messageId).catch(() => {});
      return { action: 'skipped', reason: `already replied to ${app.from} within last 24h (different thread)` };
    }
  }

  const extracted = await extractApplication(app);

  if (!isLikelyApplication(extracted, app)) {
    await labelMessage(messageId, 'skipped', true).catch(() => {});
    await persist(app, 'skipped', extracted.candidateName, {
      reason: 'no application signal (no resume/github/portfolio/keywords)',
    });
    await markMessageProcessed(messageId).catch(() => {});
    return { action: 'skipped', reason: 'no application signal (no resume/github/portfolio/keywords)' };
  }

  // Pre-Opus check: if we got almost nothing out of the resume but the
  // candidate clearly tried to apply (PDF attached, URLs provided), ask for
  // a parseable version rather than letting Opus auto-fail on empty input.
  // Catches scanned/image-only PDFs, OCR misses, and partial non-English
  // extractions.
  const hadPdf = app.attachments.some((a) => a.mimeType === 'application/pdf');
  if (
    looksLikePoorExtraction(extracted, hadPdf) ||
    looksNonEnglishOriginal(extracted.rawResumeText, app.body, app.subject)
  ) {
    const threadingEarly = await fetchThreadingHeaders(messageId).catch(() => ({ messageId: '', references: '' }));
    const askMissing: MissingField[] = ['resume'];
    const { subject, body } = await writeEmail({
      kind: 'missing_info',
      candidateName: extracted.candidateName,
      missing: askMissing,
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
      inReplyTo: threadingEarly.messageId,
      parentReferences: threadingEarly.references,
    });
    await labelMessage(messageId, 'needs-info', true);
    await markRepliedToSender(app.from).catch(() => {});
    await markThreadEngaged(app.threadId).catch(() => {});
    await markMessageProcessed(messageId).catch(() => {});
    await persist(app, 'requested_info', extracted.candidateName, { missing: askMissing });
    return {
      action: 'requested_info',
      missing: askMissing,
      candidateEmail: app.from,
      candidateName: extracted.candidateName,
    };
  }

  const missing = findMissingFields(extracted);
  const threading = await fetchThreadingHeaders(messageId).catch(() => ({ messageId: '', references: '' }));

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
      inReplyTo: threading.messageId,
      parentReferences: threading.references,
    });
    await labelMessage(messageId, 'needs-info', true);
    await markRepliedToSender(app.from).catch(() => {});
    await markThreadEngaged(app.threadId).catch(() => {});
    await markMessageProcessed(messageId).catch(() => {});
    await persist(app, 'requested_info', extracted.candidateName, { missing });
    return {
      action: 'requested_info',
      missing,
      candidateEmail: app.from,
      candidateName: extracted.candidateName,
    };
  }

  const { github, portfolio } = await gatherSignals(extracted);
  // We deliberately do NOT auto-route to needs_info when provided URLs fail to
  // fetch. Strong resume with a broken portfolio link is still a pass; weak
  // resume is still a fail. Opus has both signals and the prompt explicitly
  // tells it to use needs_more_info when claims are credible but evidence
  // can't be verified.
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
    inReplyTo: threading.messageId,
    parentReferences: threading.references,
  });
  // needs_more_info is functionally a follow-up ask, so it gets the
  // needs-info label and the candidate is allowed to reply.
  const finalLabel: 'evaluated' | 'needs-info' =
    evaluation.decision === 'needs_more_info' ? 'needs-info' : 'evaluated';
  await labelMessage(messageId, finalLabel, true);
  await markRepliedToSender(app.from).catch(() => {});
  // Engage the thread so candidate replies bypass sender dedup. Even for a
  // final pass/fail decision we mark engagement — if the candidate replies
  // with "thanks", we won't accidentally try to evaluate them again. The
  // labelMessage above plus the polling-query exclusion of `evaluated`
  // means this thread also won't appear in future polls anyway.
  await markThreadEngaged(app.threadId).catch(() => {});
  await markMessageProcessed(messageId).catch(() => {});
  if (evaluation.decision === 'needs_more_info') {
    await persist(app, 'requested_info', extracted.candidateName, {
      missing: [],
      reason: evaluation.evidenceRequest || evaluation.summary,
    });
  } else {
    await persist(app, 'evaluated', extracted.candidateName, { evaluation });
  }

  console.log('[evaluator] decision', {
    candidate: extracted.candidateEmail,
    name: extracted.candidateName,
    decision: evaluation.decision,
    weightedTotal: evaluation.weightedTotal,
    scores: Object.fromEntries(
      Object.entries(evaluation.scores).map(([k, v]) => [k, v.score]),
    ),
  });

  if (evaluation.decision === 'needs_more_info') {
    return {
      action: 'requested_info',
      missing: [],
      candidateEmail: app.from,
      candidateName: extracted.candidateName,
    };
  }

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
