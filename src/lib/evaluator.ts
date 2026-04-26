import type Anthropic from '@anthropic-ai/sdk';
import { getClaude, MODELS, extractText, parseJsonFromText } from './claude';
import { extractGithubUsername, fetchGithubSignal } from './github';
import { fetchPortfolio } from './portfolio';
import { RUBRIC } from './rubric';
import {
  PARSER_PROMPT,
  EMAIL_WRITER_PROMPT,
  buildEvaluatorPrompt,
} from './prompts';
import type {
  CandidateApplication,
  Evaluation,
  ExtractedApplication,
  GitHubSignal,
  MissingField,
  PortfolioSignal,
} from '@/types';

const MAX_RESUME_TEXT_FOR_EVAL = 15_000;
const MAX_PORTFOLIO_TEXT_FOR_EVAL = 8_000;

/**
 * Layer 1 — RFC bulk-mail headers. Marketing / transactional / auto-reply mail
 * advertises itself with these headers; checking them is free, deterministic,
 * and kills the vast majority of false positives before we hit the LLM.
 *
 * Returns spam=true when the message is bulk/automated and SHOULD NOT be
 * replied to. Caller should label `evaluator/spam-filtered` and move on.
 */
export function isBulkOrAutomated(app: CandidateApplication): { spam: boolean; reason?: string } {
  if (app.listUnsubscribe) {
    return { spam: true, reason: 'List-Unsubscribe header present (bulk mail)' };
  }
  if (app.precedence && /bulk|junk|list/i.test(app.precedence)) {
    return { spam: true, reason: `Precedence: ${app.precedence}` };
  }
  if (app.autoSubmitted && app.autoSubmitted.toLowerCase() !== 'no') {
    return { spam: true, reason: `Auto-Submitted: ${app.autoSubmitted}` };
  }
  return { spam: false };
}

/**
 * Layer 1.5 — sender-address heuristics for senders that don't bother with
 * RFC bulk headers (small mailers, corporate "team@" replies, bounce dorks).
 * Kept narrow to avoid false-positives on legit candidates.
 */
export function isAutomatedSender(email: string, subject: string): { skip: boolean; reason?: string } {
  const e = email.toLowerCase();
  if (/^(no-?reply|noreply|mailer-daemon|postmaster|bounce|bounces|do[-_]?not[-_]?reply|notifications?|alerts?|do-not-reply)@/.test(e)) {
    return { skip: true, reason: 'role / automated sender address' };
  }
  const s = subject.toLowerCase();
  if (/out of office|auto[- ]?reply|delivery (status|failure)|undeliverable|automatic reply/i.test(s)) {
    return { skip: true, reason: 'automated subject' };
  }
  return { skip: false };
}

/**
 * Layer 1c — recruiter / agency outreach detection. These don't carry
 * List-Unsubscribe headers (so Layer 1a misses them) and they're sent from
 * legitimate-looking individual addresses (so Layer 1b misses them too),
 * but they're NOT applications — they're sales pitches selling candidates.
 *
 * Conservative: requires both a recruiter-domain/signal AND outreach phrasing.
 * Triggers on actual fixtures like "we have a pool of pre-vetted senior
 * engineers currently looking for opportunities" but won't match a real
 * candidate who happens to write "I'm currently looking for a role".
 */
export function looksLikeRecruiterOutreach(app: CandidateApplication): { recruiter: boolean; reason?: string } {
  const fromDomain = (app.from.split('@')[1] || '').toLowerCase();
  const text = `${app.subject}\n${app.body}`.toLowerCase();
  const senderHints = /(recruit|staffing|talent[\s-]?(hub|acquisition|partners|solutions)|head[\s-]?hunt|placement|agency)/i;
  const senderMatch = senderHints.test(fromDomain) || senderHints.test(text.slice(0, 800));
  const outreachPatterns = [
    /pool of (pre-?vetted|qualified|senior|top|skilled)/,
    /candidates (available|looking|currently)/,
    /(senior|top|qualified) (engineers?|developers?|talent|candidates?) (available|for hire|looking)/,
    /pre[- ]?vetted (engineers?|developers?|candidates?)/,
    /we (have|represent|place|source) (engineers?|developers?|candidates?|talent)/,
    /(quick )?call to discuss (how we can|hiring|your (hiring|engineering|team|needs))/,
    /help (you )?with (your )?(hiring|recruit|staffing|engineering hires)/,
    /interested in (hiring|adding) (our|some|engineers|developers)/,
    /our (bench|roster|pool) of/,
    /open to (a )?(quick )?(call|chat|conversation) (to|about) (discuss )?(your )?hiring/,
  ];
  const phrasingMatch = outreachPatterns.some((rx) => rx.test(text));
  if (senderMatch && phrasingMatch) {
    return { recruiter: true, reason: 'recruiter / agency outreach (sender + outreach phrasing)' };
  }
  return { recruiter: false };
}

/**
 * Demo-mode allowlist. If EVALUATOR_ALLOWED_TO is set, only mail addressed
 * to that address (in the To: header) is processed. Useful for live demos
 * where you want to constrain the agent to a dedicated `apply@` address
 * while a shared inbox keeps receiving everything else.
 */
export function passesAllowedTo(app: CandidateApplication): { allowed: boolean; reason?: string } {
  const allow = (process.env.EVALUATOR_ALLOWED_TO || '').toLowerCase().trim();
  if (!allow) return { allowed: true };
  const to = (app.to || '').toLowerCase();
  if (to.includes(allow)) return { allowed: true };
  return { allowed: false, reason: `To: header does not match EVALUATOR_ALLOWED_TO=${allow}` };
}

/**
 * After parsing, decide whether the email actually looks like a job application.
 * Filters out newsletters, transactional mail, and random inbound that happens
 * to land in the inbox. We err on the side of responding when there is ANY
 * candidate-like signal (a PDF, a GitHub link, a portfolio URL, or application
 * keywords in the body).
 */
export function isLikelyApplication(extracted: ExtractedApplication, app: CandidateApplication): boolean {
  if (extracted.hasResume) return true;
  if (extracted.githubUsername) return true;
  if (extracted.portfolioUrl) return true;
  const text = `${app.subject}\n${app.body}`.toLowerCase();
  if (/\b(applic(ation|ant|ying)|apply\b|resume|cv|candidate|portfolio|github|linkedin|hiring|job opening|position|interview|role at|engineer|developer)\b/i.test(text)) {
    return true;
  }
  return false;
}

export async function extractApplication(app: CandidateApplication): Promise<ExtractedApplication> {
  const claude = getClaude();
  const pdfAttachments = app.attachments.filter((a) => a.mimeType === 'application/pdf');

  const content: Anthropic.MessageParam['content'] = [
    {
      type: 'text',
      text: `## Email metadata
From: ${app.fromName ? `${app.fromName} <${app.from}>` : app.from}
Subject: ${app.subject}

## Email body
${app.body || '(empty body)'}

${pdfAttachments.length ? `## Resume PDFs follow as attachments.` : '## No PDF attached.'}`,
    },
  ];

  for (const pdf of pdfAttachments) {
    // Gmail returns url-safe base64; Anthropic accepts standard base64.
    const standard = pdf.data.replace(/-/g, '+').replace(/_/g, '/');
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: standard },
    } as any);
  }

  const res = await claude.messages.create({
    model: MODELS.parser,
    max_tokens: 4096,
    system: PARSER_PROMPT,
    messages: [{ role: 'user', content }],
  });

  const parsed = parseJsonFromText<any>(extractText(res.content));
  const githubUsername = parsed.githubUrl ? extractGithubUsername(parsed.githubUrl) : null;
  const hasResume =
    pdfAttachments.length > 0 ||
    (typeof parsed.rawResumeText === 'string' && parsed.rawResumeText.trim().length > 300);

  return {
    candidateName: parsed.candidateName ?? null,
    candidateEmail: app.from,
    githubUrl: parsed.githubUrl ?? null,
    githubUsername,
    portfolioUrl: parsed.portfolioUrl ?? null,
    hasResume,
    resumeHighlights: Array.isArray(parsed.resumeHighlights) ? parsed.resumeHighlights : [],
    yearsExperience:
      typeof parsed.yearsExperience === 'number' ? parsed.yearsExperience : null,
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    rawResumeText: typeof parsed.rawResumeText === 'string' ? parsed.rawResumeText : null,
  };
}

/**
 * After we've tried to fetch GitHub + portfolio, identify URLs the candidate
 * gave us that didn't resolve. A 404 GitHub or a dead portfolio is a strong
 * signal we should ASK rather than guess — Opus has no real evidence to
 * score against, and auto-failing because the link is broken is unfair.
 */
export function findUnreachableProvidedUrls(
  extracted: ExtractedApplication,
  github: GitHubSignal | null,
  portfolio: PortfolioSignal | null,
): MissingField[] {
  const missing: MissingField[] = [];
  if (extracted.githubUsername && !github) missing.push('github');
  if (extracted.portfolioUrl && !portfolio) missing.push('portfolio');
  return missing;
}

/**
 * If Haiku extracted almost nothing from a candidate's resume — empty or
 * single-bullet highlights, very short raw text — but a PDF was attached or
 * URLs were provided, the right answer is to ASK for a parseable resume,
 * not to let Opus auto-fail on emptiness. Catches scanned/image-only PDFs,
 * non-English resumes that partially extracted, and broken-link cases where
 * the resume content was also too thin to stand alone.
 */
export function looksLikePoorExtraction(
  extracted: ExtractedApplication,
  hadPdf: boolean,
): boolean {
  const highlightCount = (extracted.resumeHighlights || []).length;
  const rawLength = (extracted.rawResumeText || '').trim().length;
  const skillCount = (extracted.skills || []).length;
  // "Essentially nothing extracted": fewer than 2 highlights AND short raw
  // text AND fewer than 3 skills. PDFs that came through Haiku as <300 chars
  // are usually unreadable scans / OCR misses.
  const noContent = highlightCount < 2 && rawLength < 300 && skillCount < 3;
  if (!noContent) return false;
  // Only treat as poor extraction when the candidate clearly TRIED to send a
  // resume — either an attached PDF or links to inspect. Otherwise the right
  // answer is the regular missing-fields ask.
  return hadPdf || !!extracted.githubUrl || !!extracted.portfolioUrl;
}

/**
 * If the resume's original text is dominantly non-Latin script (CJK, Devanagari,
 * Cyrillic, Arabic, Hebrew, etc.), Haiku may translate snippets into English
 * but we lose nuance and can't fully evaluate. Ask the candidate for an English
 * version / summary instead of guessing. This is also the polite move — many
 * non-English resumes are quite strong and a brief English summary lets us
 * evaluate them fairly.
 */
export function looksNonEnglishOriginal(...sources: (string | null | undefined)[]): boolean {
  // Check each source independently. If ANY source is dominantly non-Latin
  // (>15%), treat as non-English. Avoids dilution when one source is in
  // English and another is in CJK / Devanagari / Cyrillic / Arabic / Hebrew.
  const nonLatinRanges =
    /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u0900-\u097f\u0400-\u04ff\u0600-\u06ff\u0590-\u05ff]/g;
  for (const src of sources) {
    if (!src) continue;
    const text = src.trim();
    if (text.length < 30) continue;
    const nonLatinCount = (text.match(nonLatinRanges) || []).length;
    if (nonLatinCount / text.length > 0.15) return true;
  }
  return false;
}

export function findMissingFields(e: ExtractedApplication): MissingField[] {
  const missing: MissingField[] = [];
  if (!e.hasResume) missing.push('resume');
  // Resume is required. For evidence of work, EITHER a GitHub profile OR a
  // portfolio is enough — strong open-source candidates without a portfolio
  // site shouldn't be auto-rejected, and contractors with a public portfolio
  // but no GitHub shouldn't be either. Only flag both as missing when neither
  // is present.
  if (!e.githubUsername && !e.portfolioUrl) {
    missing.push('github', 'portfolio');
  }
  return missing;
}

export async function gatherSignals(e: ExtractedApplication): Promise<{
  github: GitHubSignal | null;
  portfolio: PortfolioSignal | null;
}> {
  const [github, portfolio] = await Promise.all([
    e.githubUsername ? fetchGithubSignal(e.githubUsername) : Promise.resolve(null),
    e.portfolioUrl ? fetchPortfolio(e.portfolioUrl) : Promise.resolve(null),
  ]);
  return { github, portfolio };
}

export async function evaluate(
  extracted: ExtractedApplication,
  github: GitHubSignal | null,
  portfolio: PortfolioSignal | null,
): Promise<Evaluation> {
  const claude = getClaude();

  const payload = {
    candidate: {
      name: extracted.candidateName,
      email: extracted.candidateEmail,
      yearsExperience: extracted.yearsExperience,
      skills: extracted.skills,
      resumeHighlights: extracted.resumeHighlights,
      resumeText: extracted.rawResumeText?.slice(0, MAX_RESUME_TEXT_FOR_EVAL) ?? null,
    },
    github: github
      ? {
          username: github.username,
          profile: github.profile,
          topLanguages: github.topLanguages,
          activitySummary: github.activitySummary,
          repos: github.repos,
        }
      : { error: 'GitHub data unavailable (profile not found, private, or rate-limited)' },
    portfolio: portfolio
      ? {
          url: portfolio.url,
          title: portfolio.title,
          textContent: portfolio.textContent.slice(0, MAX_PORTFOLIO_TEXT_FOR_EVAL),
        }
      : { error: 'Portfolio unavailable (fetch failed or URL unreachable)' },
  };

  const res = await claude.messages.create({
    model: MODELS.evaluator,
    max_tokens: 4096,
    system: buildEvaluatorPrompt(),
    messages: [
      {
        role: 'user',
        content: `Evaluate this candidate against the rubric.\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``,
      },
    ],
  });

  const parsed = parseJsonFromText<Evaluation>(extractText(res.content));

  // Recompute weighted total for display only — Opus's decision is now
  // authoritative. Scoring is intentionally conservative (a junior with one
  // strong shipped product can land at 6.0–6.5), so a strict threshold gate
  // overrules clearly-pass reasoning. We trust Opus's qualitative call and
  // keep the arithmetic on the side for the dashboard / logs.
  let weighted = 0;
  for (const d of RUBRIC.dimensions) {
    const s = parsed.scores?.[d.id]?.score ?? 0;
    weighted += s * d.weight;
  }
  parsed.weightedTotal = Math.round(weighted * 100) / 100;

  // Sanity guard: if Opus returned an unrecognized decision, fall back to the
  // arithmetic. This handles malformed JSON / hallucinated values without
  // erroring.
  if (
    parsed.decision !== 'pass' &&
    parsed.decision !== 'fail' &&
    parsed.decision !== 'needs_more_info'
  ) {
    parsed.decision = parsed.weightedTotal >= RUBRIC.passThreshold ? 'pass' : 'fail';
  }

  if (!Array.isArray(parsed.strengths)) parsed.strengths = [];
  if (!Array.isArray(parsed.concerns)) parsed.concerns = [];

  return parsed;
}

export async function writeEmail(params: {
  kind: 'pass' | 'fail' | 'missing_info' | 'needs_more_info';
  candidateName: string | null;
  evaluation?: Evaluation;
  missing?: MissingField[];
  received?: { resume: boolean; github: boolean; portfolio: boolean };
}): Promise<{ subject: string; body: string }> {
  const claude = getClaude();
  const fromName = process.env.EVALUATOR_FROM_NAME || 'Hiring Team';
  const firstName = params.candidateName?.split(/\s+/)[0] || 'there';

  let subject = '';
  let userPrompt = '';

  if (params.kind === 'pass' && params.evaluation) {
    subject = 'Next step on your application';
    userPrompt = `Decision: PASS.
FROM_NAME: ${fromName}
Candidate first name: ${firstName}
Top strengths (use 1–2 in the email): ${params.evaluation.strengths.slice(0, 3).join(' | ') || 'strong overall profile'}
Summary: ${params.evaluation.summary}
Suggested next step: ${params.evaluation.suggestedNextSteps || 'set up a 30-min intro call — reply with three time slots that work next week'}

Write the email body.`;
  } else if (params.kind === 'fail' && params.evaluation) {
    subject = 'About your application';
    userPrompt = `Decision: FAIL.
FROM_NAME: ${fromName}
Candidate first name: ${firstName}
Specific reason for rejection: ${params.evaluation.reasonForRejection || params.evaluation.summary}
Main concerns (for context, do not list all verbatim): ${params.evaluation.concerns.slice(0, 3).join(' | ')}

Write the email body. Give ONE specific, respectful reason grounded in their actual application.`;
  } else if (params.kind === 'missing_info' && params.missing) {
    subject = 'One more thing on your application';
    const labels: Record<MissingField, string> = {
      resume: 'a resume (PDF attachment is best)',
      github: 'a link to your GitHub profile',
      portfolio: 'a link to your portfolio or a project you shipped (anything other than GitHub)',
    };
    const missingList = params.missing.map((m) => labels[m]).join(', ');
    const recv = params.received;
    const receivedList = recv
      ? [recv.resume && 'resume', recv.github && 'GitHub link', recv.portfolio && 'portfolio link']
          .filter(Boolean)
          .join(', ')
      : '';
    userPrompt = `Decision: MISSING_INFO.
FROM_NAME: ${fromName}
Candidate first name: ${firstName}
Missing: ${missingList}
Already received: ${receivedList || 'your email'}

Write the email body asking for the missing pieces. Brief and friendly.`;
  } else if (params.kind === 'needs_more_info' && params.evaluation) {
    subject = 'A quick follow-up on your application';
    userPrompt = `Decision: NEEDS_MORE_INFO.
FROM_NAME: ${fromName}
Candidate first name: ${firstName}
What's interesting so far: ${params.evaluation.summary}
Specific evidence we'd like before deciding: ${params.evaluation.evidenceRequest || 'a code sample or working link to one of the products you mentioned'}

Write the email body. Acknowledge what you've seen, then ask for the specific evidence in one sentence. End with "happy to evaluate further once we have it." or similar warm close.`;
  } else {
    throw new Error(`writeEmail: invalid params for kind=${params.kind}`);
  }

  const res = await claude.messages.create({
    model: MODELS.writer,
    max_tokens: 800,
    system: EMAIL_WRITER_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const body = extractText(res.content);
  return { subject, body };
}
