# Architecture

## Data flow

```
       ┌──────────────────────┐
       │   Candidate sends    │
       │   email + PDF        │
       └──────────┬───────────┘
                  │
                  ▼
       ┌──────────────────────┐     Gmail labels used as state:
       │   Gmail inbox        │       evaluator/evaluated
       │   (label = state)    │       evaluator/needs-info
       └──────────┬───────────┘       evaluator/error
                  │                   evaluator/skipped
        Vercel Cron */1 * * * *
                  │
                  ▼
       ┌──────────────────────┐
       │ /api/cron/poll       │
       │ (Next.js route,      │
       │  maxDuration=60s)    │
       └──────────┬───────────┘
                  │ list unread (maxPerTick)
                  ▼
       ┌──────────────────────┐
       │ processMessage(id)   │
       └──────────┬───────────┘
                  │
  ┌───────────────┼────────────────┐
  ▼               ▼                ▼
isAutomated?   fetchThread     extractApplication
(skip if yes)  (full context)  (Haiku 4.5 + PDF)
                                   │
                                   ▼
                          findMissingFields
                                   │
              ┌────────────────────┤
              │ missing?           │ complete?
              ▼                    ▼
       writeEmail              gatherSignals
       (missing_info)     ┌─────────┴─────────┐
              │           ▼                   ▼
              │    fetchGithubSignal   fetchPortfolio
              │       (REST API)        (html-to-text)
              │           └─────────┬─────────┘
              │                     ▼
              │              evaluate (Opus 4.7)
              │                     │
              │                     ▼
              │              writeEmail (Haiku)
              │                     │
              └─────────────────────┤
                                    ▼
                              sendReply (Gmail)
                                    │
                                    ▼
                              labelMessage
                                (evaluated /
                                 needs-info /
                                 error /
                                 skipped)
```

## Key design decisions

### State in Gmail labels

We do not run a database. The set of "unprocessed applications" is defined by the Gmail search:
```
is:unread in:inbox -from:me
  -label:evaluator/evaluated
  -label:evaluator/needs-info
  -label:evaluator/error
  -label:evaluator/skipped
```

This is naturally idempotent — redeployment, cron overlaps, and partial failures all converge to the same state. The inbox is the source of truth.

### Thread-level fetch

`fetchApplicationFromMessage` pulls the entire thread, not just the triggering message. This lets the evaluator see the original application AND any replies when a candidate follows up with missing info, without us maintaining per-candidate state.

### Why two model tiers

- **Haiku 4.5** for PDF → JSON extraction (fast, cheap, good at structured output) and email drafting (tone + length).
- **Opus 4.7** only for the scoring/evaluation step, where honest reasoning and nuanced judgment matter.

This keeps per-application cost roughly ~$0.02–0.05 vs ~$0.15–0.30 if every call were Opus, with no measurable quality loss on the evaluation itself.

### Why polling, not Pub/Sub push

Gmail supports Pub/Sub push notifications for near-zero latency. We chose polling because:
- Pub/Sub setup requires ~30 min of GCP clicking (topic, subscription, IAM, watch-renew) for each deployment.
- A hiring workflow does not need sub-second latency. 30-60s is indistinguishable from instant to the candidate.
- Polling is trivially debuggable — `curl /api/cron/poll` and you get the full result set.

### Defensive weighted-total recompute

LLMs occasionally drift on arithmetic. We recompute `weightedTotal = Σ score_i * weight_i` in TypeScript after Opus replies, and re-derive `decision` from the threshold. The model's own reported total is overwritten.

### Budget control per tick

`MAX_PER_TICK=3` caps work per invocation, and a 55-second wall-clock check inside the loop prevents hitting Vercel's 60s maxDuration. Messages that don't get processed stay unread and are picked up on the next minute's tick.

## Cost estimate (order of magnitude)

Per application:
- Haiku PDF parse: ~$0.005–0.02 depending on PDF length
- GitHub API: free
- Portfolio fetch: free
- Opus evaluation: ~$0.05–0.15 depending on context
- Haiku email write: ~$0.002

Total: ~$0.06–0.17 per candidate. 1000 applications/month ≈ $60–170.
