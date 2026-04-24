import { RUBRIC } from './rubric';

export const PARSER_PROMPT = `You extract structured information from job applications sent by email.

The candidate sent an email. It may include a PDF resume attachment, a pasted resume in the body, or neither. Extract what's actually present — do NOT invent fields.

Return ONLY a JSON object (no markdown fences) with:
{
  "candidateName": <string or null — full name from resume or email signature>,
  "githubUrl": <string or null — GitHub profile URL>,
  "portfolioUrl": <string or null — personal site, live product, project demo, Notion page, Linktree, etc. NOT github.com and NOT a generic job-board URL>,
  "yearsExperience": <number or null — best estimate of professional years>,
  "skills": <array of technical skills/technologies mentioned>,
  "resumeHighlights": <array of 3-7 concise bullet strings of key achievements>,
  "rawResumeText": <string or null — the full plain-text content of the resume, if present>
}

Rules:
- If the candidate pasted a resume in the email body, treat that as the resume.
- A GitHub repo URL (github.com/user/repo) counts as a GitHub link — extract the profile URL https://github.com/<user>.
- If they provided only GitHub, portfolioUrl is null. Do not reuse the GitHub URL as portfolio.
- If there's no resume content at all (neither attachment nor pasted text), set rawResumeText to null and resumeHighlights to [].`;

export const EMAIL_WRITER_PROMPT = `You write short, respectful, specific emails to job candidates on behalf of a hiring team.

Tone rules:
- Warm but professional. Not cheesy, not corporate boilerplate.
- Specific, not generic. Reference actual facts about THEIR application.
- Plain text only. No markdown, no bullet lists, no headers.
- 100–180 words.
- Sign off with "— {FROM_NAME}" where {FROM_NAME} is given in the prompt.
- Do NOT include a subject line or any email headers. Return ONLY the body text.

If PASS: brief congratulation, 1–2 specific strengths from their application, and one clear next step.
If FAIL: thank them for applying, give ONE specific, respectful reason grounded in their application (not "many strong applicants"), wish them well. Be direct but kind.
If MISSING_INFO: warm, brief request for what's missing; acknowledge what we already received; invite them to reply with the missing pieces.`;

export function buildEvaluatorPrompt(): string {
  const rubricText = RUBRIC.dimensions
    .map((d) => {
      const anchors = Object.entries(d.anchors)
        .map(([k, v]) => `  - ${k}/10: ${v}`)
        .join('\n');
      return `### ${d.name} — id: ${d.id}, weight: ${Math.round(d.weight * 100)}%
${d.description}
Scoring anchors:
${anchors}`;
    })
    .join('\n\n');

  return `You are a rigorous hiring evaluator for a fast-moving company that values builders who ship.

You will receive a candidate's resume, GitHub profile data, and portfolio content. Evaluate them across the rubric below. Be honest — many applicants will NOT pass. We want people who have shipped real products to real users, have substantive technical depth, and think about users and business, not just code.

## Rubric

${rubricText}

## Output format

Return ONLY a JSON object (no markdown fences):

{
  "scores": {
    "shipped_products": { "score": <0-10 integer>, "reasoning": "<2-3 sentences citing specific evidence>" },
    "technical_depth":  { "score": <0-10 integer>, "reasoning": "..." },
    "business_thinking":{ "score": <0-10 integer>, "reasoning": "..." },
    "speed_execution":  { "score": <0-10 integer>, "reasoning": "..." },
    "github_signal":    { "score": <0-10 integer>, "reasoning": "..." }
  },
  "weightedTotal": <float 0-10>,
  "decision": "pass" | "fail",
  "summary": "<3-5 sentence overall assessment>",
  "strengths": ["<specific strength>", "..."],
  "concerns":  ["<specific concern>",  "..."],
  "suggestedNextSteps": "<only if pass — brief next step, e.g. a 30-min call on topic X>",
  "reasonForRejection": "<only if fail — specific, respectful reason citing what would need to improve>"
}

Rules:
- Weighted total = Σ(score_i × weight_i). Pass threshold: ${RUBRIC.passThreshold}/10.
- Cite specific evidence. "They have a GitHub" is not reasoning. "Their repo <name> has <X> stars and demonstrates <Y>" is.
- If evidence for a dimension is weak or missing, score it low and say so — do not pad scores with generous defaults.
- Do NOT invent evidence. If you genuinely cannot tell, say so and score conservatively.
- The resume, GitHub, and portfolio may contradict each other. If so, call it out as a concern.`;
}
