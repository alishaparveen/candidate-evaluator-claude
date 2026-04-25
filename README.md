# Candidate Evaluator

An email-based AI agent that screens job applications end-to-end:
1. A candidate emails a resume (PDF), GitHub link, and portfolio link to a dedicated inbox.
2. A Vercel cron job polls Gmail every minute, picks up new applications, and parses them.
3. If the application is incomplete, the agent replies asking for the missing pieces.
4. Otherwise it fetches GitHub + portfolio signals, scores the candidate against a rubric, and replies with a pass or a specific, respectful fail — all in the same Gmail thread.

Built for the Plum Residency take-home.

**Live:** https://candidate-evaluator-oxiyc8bwq-alisha02012001-1865s-projects.vercel.app
**Email the agent at:** `goldenpointpickleballclub@gmail.com`
**Health:** [/api/health](https://candidate-evaluator-oxiyc8bwq-alisha02012001-1865s-projects.vercel.app/api/health)

## Architecture (one paragraph)

**Inbound email** lives in Gmail. A Vercel Cron triggers `/api/cron/poll` every minute; the endpoint calls the Gmail API for `is:unread in:inbox -label:evaluator/evaluated -label:evaluator/error -from:me` and processes up to `MAX_PER_TICK` (default 3) applications per invocation under a 55-second function budget. Each message is pulled *with full thread context* (so a candidate replying to our "please send your GitHub" email is evaluated against the original application plus the reply). **Parsing** is a single Haiku 4.5 call that takes the email body plus the PDF attachment (Claude's native document support — no `pdf-parse`) and returns structured JSON. If required fields are missing, Haiku also drafts a friendly follow-up. If the application is complete, we fan out in parallel to the **GitHub REST API** (profile + 30 most recent owned repos) and the **portfolio URL** (fetch + `html-to-text`). All three signals go to **Opus 4.7**, which scores the candidate across a 5-dimension weighted rubric (defined in [`src/lib/rubric.ts`](src/lib/rubric.ts)) and returns JSON with per-dimension scores + reasoning, a decision, strengths, concerns, and next steps. Haiku then drafts the reply email; Gmail sends it in-thread; we label the message `evaluator/evaluated` so it won't be re-processed. **State lives in Gmail labels** — no database.

```
 ┌──────────┐    ┌───────────────────┐    ┌────────────┐
 │ Candidate│───▶│  Gmail inbox      │◀───│ Vercel Cron│
 │  email   │    │  (labels = state) │    │  */1 * * * │
 └──────────┘    └────────┬──────────┘    └─────┬──────┘
                          │                     │
                          ▼                     ▼
                  ┌─────────────────────────────────────┐
                  │  /api/cron/poll  (Next.js route)    │
                  │                                      │
                  │  list pending → for each message:    │
                  │    fetch thread (Gmail API)          │
                  │    ├─ Haiku: parse PDF + body → JSON │
                  │    ├─ completeness check             │
                  │    │   └─ missing? → Haiku: draft    │
                  │    │       follow-up → Gmail send    │
                  │    └─ parallel:                      │
                  │         GitHub API, portfolio HTML   │
                  │       → Opus: score vs rubric        │
                  │       → Haiku: draft pass/fail email │
                  │       → Gmail send, apply label      │
                  └─────────────────────────────────────┘
```

## Tech stack — and why

- **Next.js 14 App Router on Vercel** — gives us API routes, Vercel Cron, and a free HTTPS endpoint in one deploy. No server to manage.
- **Gmail API with OAuth 2 refresh-token auth** — polled from cron. Chose polling over Gmail Push/Pub-Sub because setting up Pub/Sub topics is 30 min of GCP clicking for a < 60-second latency improvement we don't need for hiring triage.
- **State = Gmail labels**, not a database. `evaluator/evaluated`, `evaluator/needs-info`, `evaluator/skipped`, `evaluator/error`. No Postgres, no Redis, no schema migrations. The source of truth is the inbox the human already trusts.
- **Claude: Haiku 4.5 for parsing + email drafting, Opus 4.7 for evaluation.** Haiku handles PDFs natively (so we don't need `pdf-parse` or OCR) and is fast + cheap for structured extraction. Opus does the reasoning-heavy scoring where honesty and specificity matter.
- **GitHub REST (unauthenticated by default)** — one profile call + one repos call is enough signal for triage. A `GITHUB_TOKEN` lifts the rate limit from 60 → 5000 req/hr if we ever need it.
- **Portfolio fetch via `html-to-text`** — strip chrome/nav, keep content, cap at 15k chars so we don't blow up the evaluator prompt.
- **Defensive math** — we recompute the weighted total in code after Opus replies, in case it fumbles the arithmetic.

Deliberately NOT in the stack: a database, a queue, a vector store, a scraping service, webhooks/Pub-Sub, a feature flag system, a frontend beyond a status page.

## Project layout

```
src/
├── app/
│   ├── page.tsx                    status page
│   ├── layout.tsx
│   └── api/
│       ├── health/route.ts         GET /api/health — env check
│       └── cron/poll/route.ts      GET/POST /api/cron/poll — the engine
├── lib/
│   ├── gmail.ts                    list / fetch / send / label
│   ├── claude.ts                   SDK singleton + JSON parse helpers
│   ├── github.ts                   REST fetch + username extraction
│   ├── portfolio.ts                fetch + html-to-text
│   ├── rubric.ts                   5-dimension weighted rubric
│   ├── prompts.ts                  parser, evaluator, writer prompts
│   ├── evaluator.ts                extract → evaluate → write email
│   └── processor.ts                per-message orchestration
└── types/index.ts
scripts/
├── get-refresh-token.ts            one-time OAuth helper
├── test-evaluate.ts                local pipeline test (no Gmail)
└── test-poll.ts                    poll the real inbox from CLI
```

## Setup

### 1. Google Cloud / Gmail OAuth (5 min)

1. Create a project at https://console.cloud.google.com.
2. In **APIs & Services → Library**, enable the **Gmail API**.
3. In **APIs & Services → OAuth consent screen**, choose **External**, publish the app (or add your Gmail address as a test user — fine for a single-inbox agent).
4. In **APIs & Services → Credentials**, create an **OAuth 2.0 Client ID** of type **Desktop app**. Note the client ID and client secret.

### 2. Install + get a refresh token

```bash
cd candidate-evaluator
cp .env.example .env
# fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
npm install
npm run get-token
```

A browser opens, you sign in with the Gmail account the agent will use, you approve the scopes, and the script prints a `GOOGLE_REFRESH_TOKEN=...` line. Paste it into `.env`.

### 3. Fill the rest of `.env`

```
ANTHROPIC_API_KEY=sk-ant-...
EVALUATOR_FROM_EMAIL=jobs@yourdomain.com   # the Gmail account that authorized step 2
EVALUATOR_FROM_NAME=Plum Hiring
CRON_SECRET=<any long random string>
GITHUB_TOKEN=ghp_...   # optional but recommended
```

### 4. Test locally

```bash
# pipeline smoke test — no Gmail involved
npm run test:eval                        # uses Linus Torvalds + a fake body as the demo

# with a real resume PDF:
npm run test:eval -- ./path/to/resume.pdf "Hi, my GitHub: https://github.com/<user>  Portfolio: https://<url>"

# pull + process real unread messages from the configured inbox:
npm run test:poll
```

### 5. Deploy to Vercel

```bash
npx vercel link           # or use the Vercel UI
npx vercel env add ANTHROPIC_API_KEY production
npx vercel env add GOOGLE_CLIENT_ID production
npx vercel env add GOOGLE_CLIENT_SECRET production
npx vercel env add GOOGLE_REFRESH_TOKEN production
npx vercel env add EVALUATOR_FROM_EMAIL production
npx vercel env add EVALUATOR_FROM_NAME production
npx vercel env add CRON_SECRET production
npx vercel env add GITHUB_TOKEN production    # optional
npx vercel deploy --prod
```

After the first deploy, verify:

```
curl https://<your-deployment>.vercel.app/api/health
```

Should return `{"ok": true, ...}`.

Then send a real application to `EVALUATOR_FROM_EMAIL` and wait ~60 seconds.

#### About the cron tier

`vercel.json` declares `*/1 * * * *` (every minute). **Vercel Hobby** allows only daily crons, so on Hobby the cron line will fail to register — deploy will still succeed, but you'll need to either upgrade to Pro or use an external 1-minute cron (e.g. cron-job.org) hitting `POST /api/cron/poll` with `Authorization: Bearer $CRON_SECRET`. The endpoint is idempotent and authenticated either way.

## Evaluation rubric

Defined in [`src/lib/rubric.ts`](src/lib/rubric.ts). Pass threshold: **6.5 / 10** weighted.

| Dimension | Weight | What we look for |
|---|---|---|
| Shipped production products | 25% | Live URLs, real users, revenue, app store listings — not tutorials |
| Technical depth | 25% | Non-trivial engineering, system design, quality repos |
| Business thinking | 20% | Users, market, revenue reasoning — not just "what I built" |
| Speed of execution | 15% | Shipping cadence, end-to-end ownership |
| GitHub signal | 15% | Original repos (not forks), stars, meaningful READMEs |

Edit `src/lib/rubric.ts` to re-weight, change anchors, or add/remove dimensions — the evaluator prompt is built from this file, so changes propagate automatically.

## Edge cases — how they're handled

| Case | Behavior |
|---|---|
| No resume attached | Haiku drafts a friendly ask; thread labeled `evaluator/needs-info` |
| No GitHub link | Same — asks specifically for GitHub |
| No portfolio (or only GitHub reused) | Same — asks for a non-GitHub project link |
| Multiple missing fields | One email that asks for all of them, acknowledging what we already received |
| Candidate replies with missing info | Full thread is re-parsed (original message + all replies) before evaluation |
| Reply to our pass/fail email | Ignored — thread already has `evaluated` label |
| Auto-reply / out-of-office / MAILER-DAEMON | Detected by `isAutomatedSender`; labeled `skipped`, no reply sent |
| GitHub profile private / 404 | Evaluator sees `"github": { error: "unavailable" }`, scores `github_signal` low accordingly |
| Portfolio URL unreachable / times out | Same — evaluator notes it and scores conservatively |
| Opus returns malformed JSON | Defensive `parseJsonFromText` strips fences and isolates `{...}`; if it still fails, the message gets `evaluator/error` and is safe to retry |
| Cron function hits 55-second budget | Remaining messages are left unread and picked up on the next tick |

## What I'd improve with more time

- **Duplicate application detection**: right now a candidate who applies twice from scratch gets evaluated twice (different threads). Would add a lightweight dedup by sender email over the last 14 days (KV store or Gmail search).
- **Attachment-signature check**: verify the PDF is actually a resume vs. a random document. One extra Haiku boolean call, or reject files > 10 MB up-front.
- **Rate-limit + retry with backoff on Anthropic 429s.** Currently one failed message gets labeled `error` and needs manual retry.
- **LangFuse / OpenTelemetry traces** for the full pipeline — today I rely on Vercel function logs. With a real funnel you want per-stage latency and token-cost dashboards.
- **Confidence scores on extraction** — a low-confidence GitHub URL should trigger a clarifying email instead of being silently wrong.
- **Human-in-the-loop edits** before sending. A Slack ping with "approve/edit/reject" for borderline (say, 6.0–7.0 weighted) scores would catch the cases where Opus is right 80% of the time.
- **Proper test suite.** Today there's a CLI harness but no mocks. Would add Vitest with recorded Claude responses.
- **Per-role rubrics.** One JSON config per job opening, selected by the To: address or a subject tag.

## Trade-offs I made consciously

- **Gmail labels as state instead of a database.** Simpler to reason about, free, and survives redeploys. The cost: I can't do aggregate analytics without re-scanning the inbox. For a hiring-triage volume, that's fine. For 10k applications / day, it's not.
- **Polling over Gmail Push notifications.** A ~30s average latency trade for avoiding a Pub/Sub topic. The review brief promises "we'll test it live" — 30-60s reply latency is acceptable; 0-latency isn't meaningfully better for this workflow.
- **Two model tiers (Haiku + Opus).** Opus for the one step where reasoning quality actually matters (scoring). Haiku for everything else. Halves cost and ~halves latency vs all-Opus without measurably hurting quality on the live tests I ran.
- **No `pdf-parse`.** Claude's native PDF support is higher quality (handles tables, columns, layout) AND removes 500KB of bundle weight on cold start. The trade-off is that PDFs count against the context window — we cap at typical resume size so this hasn't bitten in practice.
- **No framework for the rubric (no Zod, no schema registry).** A plain `as const` TypeScript object with string keys the evaluator knows about. I'd add Zod if we were accepting rubric uploads from users.
- **Defensive recompute of the weighted total.** Five multiplications and a sum in Python-speak. Cheap insurance against the LLM arithmetic drifting.
- **No job / queue system for retries.** Failed messages get an `evaluator/error` label and stop. The right fix is exponential-backoff retry, but until we see a real failure mode in production it's premature.

## License

MIT — built for an interview.
