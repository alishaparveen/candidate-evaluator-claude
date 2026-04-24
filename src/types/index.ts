export type CandidateApplication = {
  messageId: string;
  threadId: string;
  from: string;
  fromName: string;
  subject: string;
  body: string;
  receivedAt: string;
  attachments: EmailAttachment[];
};

export type EmailAttachment = {
  filename: string;
  mimeType: string;
  data: string; // base64 (url-safe as returned by Gmail API)
};

export type ExtractedApplication = {
  candidateName: string | null;
  candidateEmail: string;
  githubUrl: string | null;
  githubUsername: string | null;
  portfolioUrl: string | null;
  hasResume: boolean;
  resumeHighlights: string[];
  yearsExperience: number | null;
  skills: string[];
  rawResumeText: string | null;
};

export type MissingField = 'resume' | 'github' | 'portfolio';

export type GitHubSignal = {
  username: string;
  profile: {
    name: string | null;
    bio: string | null;
    publicRepos: number;
    followers: number;
    following: number;
    createdAt: string;
  };
  repos: {
    name: string;
    description: string | null;
    language: string | null;
    stars: number;
    forks: number;
    isFork: boolean;
    updatedAt: string;
    url: string;
  }[];
  topLanguages: string[];
  activitySummary: string;
};

export type PortfolioSignal = {
  url: string;
  title: string | null;
  textContent: string;
  fetchedAt: string;
};

export type DimensionScore = {
  score: number;
  reasoning: string;
};

export type Evaluation = {
  scores: Record<string, DimensionScore>;
  weightedTotal: number;
  decision: 'pass' | 'fail';
  summary: string;
  strengths: string[];
  concerns: string[];
  suggestedNextSteps?: string;
  reasonForRejection?: string;
};

export type ProcessResult =
  | { action: 'requested_info'; missing: MissingField[]; candidateEmail: string; candidateName: string | null }
  | { action: 'evaluated'; decision: 'pass' | 'fail'; weightedTotal: number; candidateEmail: string; candidateName: string | null }
  | { action: 'skipped'; reason: string }
  | { action: 'error'; error: string };
