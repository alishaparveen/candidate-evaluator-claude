/**
 * Local end-to-end test WITHOUT touching Gmail.
 *
 * Usage:
 *   npm run test:eval                                        # uses defaults
 *   npm run test:eval -- path/to/resume.pdf
 *   npm run test:eval -- path/to/resume.pdf "email body text"
 *
 * Requires: ANTHROPIC_API_KEY (+ optionally GITHUB_TOKEN) in .env.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  extractApplication,
  findMissingFields,
  gatherSignals,
  evaluate,
  writeEmail,
} from '../src/lib/evaluator';
import type { CandidateApplication } from '../src/types';

async function main() {
  const resumePath = process.argv[2];
  const body =
    process.argv[3] ||
    `Hi,\n\nPlease find my application attached.\nGitHub: https://github.com/torvalds\nPortfolio: https://en.wikipedia.org/wiki/Linus_Torvalds\n\nBest,\nLinus`;

  const attachments = resumePath
    ? [
        {
          filename: 'resume.pdf',
          mimeType: 'application/pdf',
          data: readFileSync(resolve(resumePath)).toString('base64'),
        },
      ]
    : [];

  const app: CandidateApplication = {
    messageId: 'test-msg',
    threadId: 'test-thread',
    from: 'test@example.com',
    fromName: 'Test Candidate',
    subject: 'Application for Resident role',
    body,
    receivedAt: new Date().toISOString(),
    attachments,
  };

  console.log('## 1. Extracting application...');
  const extracted = await extractApplication(app);
  console.log(JSON.stringify({ ...extracted, rawResumeText: extracted.rawResumeText?.slice(0, 200) + '...' }, null, 2));

  console.log('\n## 2. Completeness check...');
  const missing = findMissingFields(extracted);
  console.log('missing:', missing);

  if (missing.length) {
    const email = await writeEmail({
      kind: 'missing_info',
      candidateName: extracted.candidateName,
      missing,
      received: {
        resume: extracted.hasResume,
        github: !!extracted.githubUsername,
        portfolio: !!extracted.portfolioUrl,
      },
    });
    console.log('\n## 3. Email (missing_info):\n');
    console.log(`Subject: ${email.subject}\n\n${email.body}`);
    return;
  }

  console.log('\n## 3. Gathering signals (GitHub + portfolio)...');
  const { github, portfolio } = await gatherSignals(extracted);
  console.log('github:', github ? `✓ ${github.profile.publicRepos} public repos, top langs: ${github.topLanguages.join(', ')}` : '✗ unavailable');
  console.log('portfolio:', portfolio ? `✓ "${portfolio.title}" (${portfolio.textContent.length} chars)` : '✗ unavailable');

  console.log('\n## 4. Evaluating with Opus...');
  const evalResult = await evaluate(extracted, github, portfolio);
  console.log(JSON.stringify(evalResult, null, 2));

  console.log('\n## 5. Writing response email...');
  const email = await writeEmail({
    kind: evalResult.decision,
    candidateName: extracted.candidateName,
    evaluation: evalResult,
  });
  console.log(`\nSubject: ${email.subject}\n\n${email.body}`);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
