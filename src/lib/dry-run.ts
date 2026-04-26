/**
 * Pure pipeline — no Gmail send, no KV writes, no labeling.
 *
 * Given a normalized message dict (the same shape the Plum test pack feeds
 * to its Python runner), runs the same layered filter + extraction +
 * evaluation pipeline that processor.ts uses for production, and returns the
 * decision + reasoning + the email body we *would* have sent.
 *
 * Used by:
 *   - scripts/test-handler-server.ts  (HTTP bridge for the Python test runner)
 *   - any future inline tests that don't want side effects
 *
 * Message-ID-level dedup is maintained in-memory at module scope, so the
 * test pack's edge_11b duplicate fixture correctly returns "skipped" when
 * sent right after edge_11a in the same process.
 */
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
import type { CandidateApplication, EmailAttachment } from '@/types';

export type TestPackAttachment = {
  filename: string;
  content_type: string;
  size_bytes: number;
  data_b64: string;
};

export type TestPackMessage = {
  message_id: string;
  from: string;
  from_email: string;
  to: string;
  subject: string;
  date?: string;
  body_text: string;
  body_html?: string | null;
  headers: Record<string, string>;
  in_reply_to?: string | null;
  references?: string | null;
  attachments: TestPackAttachment[];
  fixture_id?: string;
};

export type DryRunResult = {
  decision: 'pass' | 'fail' | 'needs_info' | 'skipped';
  reasoning: string;
  response_email: string;
  // Useful diagnostic data that the checker doesn't grade on but humans want to see:
  weighted_total?: number;
  scores?: Record<string, number>;
  missing?: string[];
  filter_layer?: string;
};

const seenMessageIds = new Set<string>();

export function resetDryRunDedup(): void {
  seenMessageIds.clear();
}

function headerCI(headers: Record<string, string>, name: string): string | undefined {
  for (const k of Object.keys(headers || {})) {
    if (k.toLowerCase() === name.toLowerCase()) return headers[k];
  }
  return undefined;
}

function toCandidateApplication(m: TestPackMessage): CandidateApplication {
  const fromMatch = m.from.match(/^\s*(?:"?([^"<]*)"?\s*)?<?([^<>\s]+@[^<>\s]+)>?/);
  const fromName = fromMatch?.[1]?.trim() || '';
  const attachments: EmailAttachment[] = (m.attachments || []).map((a) => ({
    filename: a.filename,
    mimeType: a.content_type,
    data: a.data_b64,
  }));
  return {
    messageId: m.message_id,
    threadId: m.in_reply_to || m.message_id,
    from: m.from_email || fromMatch?.[2] || m.from,
    fromName,
    to: m.to,
    subject: m.subject,
    body: m.body_text || '',
    receivedAt: m.date || '',
    attachments,
    listUnsubscribe: headerCI(m.headers, 'List-Unsubscribe'),
    precedence: headerCI(m.headers, 'Precedence'),
    autoSubmitted: headerCI(m.headers, 'Auto-Submitted'),
  };
}

export async function dryRun(m: TestPackMessage): Promise<DryRunResult> {
  const app = toCandidateApplication(m);

  // Message-ID dedup — same as production would do via Gmail labels on the same thread.
  if (m.message_id && seenMessageIds.has(m.message_id)) {
    return {
      decision: 'skipped',
      reasoning: `duplicate Message-ID ${m.message_id} — already processed`,
      response_email: '',
      filter_layer: 'message-id-dedup',
    };
  }

  // Layer 1a — RFC bulk-mail headers
  const bulk = isBulkOrAutomated(app);
  if (bulk.spam) {
    if (m.message_id) seenMessageIds.add(m.message_id);
    return {
      decision: 'skipped',
      reasoning: `bulk/marketing mail filtered: ${bulk.reason}`,
      response_email: '',
      filter_layer: 'layer-1a-bulk-headers',
    };
  }

  // Layer 1b — sender heuristics
  const auto = isAutomatedSender(app.from, app.subject);
  if (auto.skip) {
    if (m.message_id) seenMessageIds.add(m.message_id);
    return {
      decision: 'skipped',
      reasoning: `automated sender filtered: ${auto.reason}`,
      response_email: '',
      filter_layer: 'layer-1b-sender-heuristic',
    };
  }

  // Layer 1c — recruiter / agency outreach (no headers, individual sender)
  const recruiter = looksLikeRecruiterOutreach(app);
  if (recruiter.recruiter) {
    if (m.message_id) seenMessageIds.add(m.message_id);
    return {
      decision: 'skipped',
      reasoning: recruiter.reason || 'recruiter outreach',
      response_email: '',
      filter_layer: 'layer-1c-recruiter',
    };
  }

  // Layer 2 — opt-in EVALUATOR_ALLOWED_TO allowlist
  const toCheck = passesAllowedTo(app);
  if (!toCheck.allowed) {
    if (m.message_id) seenMessageIds.add(m.message_id);
    return {
      decision: 'skipped',
      reasoning: toCheck.reason || 'not in demo allowlist',
      response_email: '',
      filter_layer: 'layer-2-allowlist',
    };
  }

  const extracted = await extractApplication(app);

  // Pre-Opus check — if the resume parsed almost-empty (scanned PDF, OCR
  // miss, partial non-English extraction, broken inputs) OR the original
  // resume was in a non-English script we can't fully evaluate, ask for a
  // parseable / English version rather than letting Opus auto-fail.
  const hadPdf = (m.attachments || []).some((a) => a.content_type === 'application/pdf');
  if (
    looksLikePoorExtraction(extracted, hadPdf) ||
    looksNonEnglishOriginal(extracted.rawResumeText, app.body, app.subject)
  ) {
    const askMissing: import('@/types').MissingField[] = ['resume'];
    const { body } = await writeEmail({
      kind: 'missing_info',
      candidateName: extracted.candidateName,
      missing: askMissing,
      received: {
        resume: extracted.hasResume,
        github: !!extracted.githubUsername,
        portfolio: !!extracted.portfolioUrl,
      },
    });
    if (m.message_id) seenMessageIds.add(m.message_id);
    return {
      decision: 'needs_info',
      reasoning:
        'resume content was too thin to evaluate (likely scanned PDF, OCR miss, or unreadable format). Asking for a text-extractable PDF.',
      response_email: body,
      missing: askMissing,
      filter_layer: 'poor-extraction',
    };
  }

  // Layer 4 — content heuristic
  if (!isLikelyApplication(extracted, app)) {
    if (m.message_id) seenMessageIds.add(m.message_id);
    return {
      decision: 'skipped',
      reasoning: 'no application signal (no resume / no GitHub / no portfolio / no application keywords)',
      response_email: '',
      filter_layer: 'layer-4-no-signal',
    };
  }

  const missing = findMissingFields(extracted);
  if (missing.length > 0) {
    const { body } = await writeEmail({
      kind: 'missing_info',
      candidateName: extracted.candidateName,
      missing,
      received: {
        resume: extracted.hasResume,
        github: !!extracted.githubUsername,
        portfolio: !!extracted.portfolioUrl,
      },
    });
    if (m.message_id) seenMessageIds.add(m.message_id);
    return {
      decision: 'needs_info',
      reasoning: `missing required fields: ${missing.join(', ')}`,
      response_email: body,
      missing,
      filter_layer: 'completeness-gate',
    };
  }

  const { github, portfolio } = await gatherSignals(extracted);
  // We deliberately do NOT auto-route to needs_info when URLs fail to fetch.
  // A strong resume with a broken portfolio link is still a pass; a weak resume
  // with a broken portfolio link is a fail. Opus has both signals and the
  // prompt explicitly tells it to choose needs_more_info when claims are
  // credible but evidence is unverifiable.
  const evaluation = await evaluate(extracted, github, portfolio);

  const { body } = await writeEmail({
    kind: evaluation.decision,
    candidateName: extracted.candidateName,
    evaluation,
  });

  const reasoningParts = [
    evaluation.summary,
    evaluation.reasonForRejection ? `Reason for rejection: ${evaluation.reasonForRejection}` : null,
    evaluation.evidenceRequest ? `Evidence requested: ${evaluation.evidenceRequest}` : null,
    evaluation.suggestedNextSteps ? `Next step: ${evaluation.suggestedNextSteps}` : null,
    `Strengths: ${(evaluation.strengths || []).slice(0, 3).join(' | ')}`,
    `Concerns: ${(evaluation.concerns || []).slice(0, 3).join(' | ')}`,
    `GitHub: ${github ? `${github.profile.publicRepos} public repos, top langs: ${github.topLanguages.join(', ')}` : 'unavailable'}`,
    `Portfolio: ${portfolio ? `"${portfolio.title}" (${portfolio.textContent.length} chars)` : 'unavailable'}`,
  ].filter(Boolean);

  if (m.message_id) seenMessageIds.add(m.message_id);

  // Map the agent's evaluation decision to the test pack's vocabulary.
  const externalDecision: DryRunResult['decision'] =
    evaluation.decision === 'pass' ? 'pass'
      : evaluation.decision === 'needs_more_info' ? 'needs_info'
        : 'fail';

  return {
    decision: externalDecision,
    reasoning: reasoningParts.join('\n'),
    response_email: body,
    weighted_total: evaluation.weightedTotal,
    scores: Object.fromEntries(
      Object.entries(evaluation.scores).map(([k, v]) => [k, v.score]),
    ),
    filter_layer: evaluation.decision === 'needs_more_info' ? 'evaluator-needs-more-info' : 'evaluated',
  };
}
