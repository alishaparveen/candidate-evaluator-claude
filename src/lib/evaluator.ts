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

export function isAutomatedSender(email: string, subject: string): { skip: boolean; reason?: string } {
  const e = email.toLowerCase();
  if (/^(no-?reply|noreply|mailer-daemon|postmaster|bounce|bounces|do[-_]?not[-_]?reply|info|hello|hi|news|newsletter|notifications?|alerts?|updates?|team|support|marketing|hr|recruiting|onboarding|welcome|notify|admin|account|billing|sales|contact|community|help|service|do-not-reply)@/.test(e)) {
    return { skip: true, reason: 'role / automated sender address' };
  }
  if (/@(mail\.|email\.|news\.|newsletter\.|noreply\.|notifications?\.|info\.|hello\.|marketing\.|alerts?\.|updates?\.|notify\.)/.test(e)) {
    return { skip: true, reason: 'transactional/marketing sender domain' };
  }
  const s = subject.toLowerCase();
  if (/out of office|auto[- ]?reply|delivery (status|failure)|undeliverable|automatic reply/i.test(s)) {
    return { skip: true, reason: 'automated subject' };
  }
  return { skip: false };
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

export function findMissingFields(e: ExtractedApplication): MissingField[] {
  const missing: MissingField[] = [];
  if (!e.hasResume) missing.push('resume');
  if (!e.githubUsername) missing.push('github');
  if (!e.portfolioUrl) missing.push('portfolio');
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

  // Recompute weighted total defensively (model sometimes drifts on arithmetic).
  let weighted = 0;
  for (const d of RUBRIC.dimensions) {
    const s = parsed.scores?.[d.id]?.score ?? 0;
    weighted += s * d.weight;
  }
  parsed.weightedTotal = Math.round(weighted * 100) / 100;
  parsed.decision = parsed.weightedTotal >= RUBRIC.passThreshold ? 'pass' : 'fail';

  if (!Array.isArray(parsed.strengths)) parsed.strengths = [];
  if (!Array.isArray(parsed.concerns)) parsed.concerns = [];

  return parsed;
}

export async function writeEmail(params: {
  kind: 'pass' | 'fail' | 'missing_info';
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
