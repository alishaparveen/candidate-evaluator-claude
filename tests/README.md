# Plum Builders test pack

A self-contained set of `.eml` fixtures + a runner + a checker for the AI Candidate Evaluator agent. Run it locally before the live test to catch the bugs you don't want them finding for you.

## What's in here

```
test_pack/
├── README.md                 ← you are here
├── runner.py                 ← parses .eml fixtures, calls your agent
├── checker.py                ← grades results against expected_results.json
├── expected_results.json     ← ground truth for each fixture
├── example_handler.py        ← stub showing the handler contract
├── _generate.py              ← regenerate everything (idempotent)
├── fixtures/
│   ├── 01_strong/            ← 4 strong candidates (should all pass)
│   ├── 02_weak/              ← 4 weak candidates (should all fail)
│   ├── 03_borderline/        ← 3 borderline cases (test reasoning)
│   └── 04_edge_cases/        ← 15 edge cases (the bulk of the value)
└── attachments/              ← all PDFs referenced by the .eml files
```

22 .eml files total. Every fixture is a real RFC-5322 email — proper headers, real attachments, real `Message-ID`s. They parse identically whether you read them locally or load them from Gmail.

## Quick start

```bash
# 1. (optional) See what's in the fixtures
python runner.py --dry-run

# 2. Wire up your agent (see "Wiring up your agent" below)
python runner.py --handler my_agent_module:process_message --out results.json

# 3. Grade the run
python checker.py results.json
```

## Wiring up your agent

The runner imports a Python function with this signature:

```python
def process_message(message: dict) -> dict:
    ...
```

`message` is a normalized email dict. The full schema is in `runner.py`'s docstring — the important fields:

```python
{
  "fixture_id": "edge_13_marketing_email",
  "message_id": "<...>",
  "from": "Apollo <hello@apollo.io>",
  "from_email": "hello@apollo.io",
  "subject": "...",
  "body_text": "...",
  "body_html": "..." | None,
  "headers": {"List-Unsubscribe": "...", ...},   # all email headers
  "in_reply_to": "<...>" | None,
  "references": "<...>" | None,
  "attachments": [
    {"filename": "...", "content_type": "application/pdf",
     "size_bytes": 12345, "data_b64": "..."},
  ],
}
```

Your function should return:

```python
{
  "decision": "pass" | "fail" | "needs_info" | "skipped",
  "reasoning": "<one paragraph of why>",
  "response_email": "<the body of what you sent the candidate>"  # empty for skipped
}
```

The simplest wire-up: write a thin adapter that calls your real agent with whatever shape it expects. See `example_handler.py` for a working stub that you can copy and replace the body of.

If your agent has its own Gmail-message → decision function, your adapter just translates this dict into your agent's input format. The decoupling is intentional — the runner doesn't need to know how your agent works.

## The four decision values

| Decision | When |
|---|---|
| `pass` | Strong candidate. Send "you're advancing" email. |
| `fail` | Clearly weak. Send respectful, specific rejection. |
| `needs_info` | Incomplete application. Ask for what's missing. |
| `skipped` | Not an application at all (marketing, recruiter outreach, gibberish). **Do not reply.** |

The `skipped` decision is the one most candidates miss. Replying to marketing emails was the bug in the original screenshot — the test pack covers it directly via `edge_13_marketing_email` (which has `List-Unsubscribe` and `Precedence: bulk` headers) and `edge_14_recruiter_outreach`.

## What each bucket tests

### `01_strong/` — would your agent let through real builders?

| Fixture | Tests |
|---|---|
| `strong_01_senior_fullstack` | Obvious senior with massive shipped scope. Easy pass. |
| `strong_02_mid_strong_project` | Mid-level with a real side product (paying users). |
| `strong_03_nontraditional` | Self-taught, no CS degree, multiple shipped products. **Watches for credentialism bias.** |
| `strong_04_junior_exceptional` | Junior with one exceptional project. **Watches for years-of-experience bias.** |

### `02_weak/` — does your rejection reasoning hold up?

The decisions matter less than the *reasons*. Read each rejection email and ask: would this be useful to the candidate?

| Fixture | What's weak |
|---|---|
| `weak_01_buzzwords_no_ship` | All buzzwords, no shipped products. |
| `weak_02_forks_only` | Trainee, GitHub is just tutorial forks. |
| `weak_03_ai_generated_tells` | Vague metrics, AI-generated tone, no public artifacts. |
| `weak_04_screenshot_portfolio` | Portfolio is a Notion doc with screenshots. |

### `03_borderline/` — does your agent reason or pattern-match?

These don't have one right answer. The check is whether the agent reasons explicitly about the trade-offs.

| Fixture | The tension |
|---|---|
| `borderline_01_resume_strong_github_dead` | Strong resume + dead GitHub (was an EM, work is private). |
| `borderline_02_github_strong_no_portfolio` | Strong open source + no portfolio site. |
| `borderline_03_private_repos_only` | Independent contractor, all client work under NDA. |

Auto-rejecting any of these is a real failure mode. `pass`, `pass with caveat`, and `needs_info` (asking for code samples) are all defensible. `fail` is not.

### `04_edge_cases/` — the bucket they'll spend most of the live test on

| Fixture | Tests | Expected |
|---|---|---|
| `edge_01_no_attachment` | Missing resume, links present | `needs_info`, ask for resume |
| `edge_02_docx_not_pdf` | Wrong file format | `needs_info`, ask for PDF |
| `edge_03_scanned_pdf` | PDF with no extractable text (image-only) | OCR or `needs_info` |
| `edge_04_no_github` | Resume + portfolio but no GitHub link | Ask, don't auto-reject |
| `edge_05_broken_portfolio` | Portfolio link 404s | Detect + ask |
| `edge_06_404_github` | GitHub user doesn't exist | Detect + ask |
| `edge_07_multiple_pdfs` | Resume *and* cover letter attached | Pick the resume |
| `edge_08_gibberish` | Random keystrokes, no signal | `skipped`, no reply |
| `edge_09_non_english` | Application in Mandarin | Don't skip; respond gracefully |
| `edge_10_empty_body` | Empty body + empty subject + PDF | `needs_info` |
| `edge_11a_duplicate_first` | First send | `pass` |
| `edge_11b_duplicate_second` | **Same `Message-ID`** as 11a | **MUST `skipped`** — this catches deduplication bugs |
| `edge_12_reply_to_needs_info` | A candidate replying to your earlier "send me your resume" ask, with `In-Reply-To` set | Stitch back to original thread, don't treat as new application |
| `edge_13_marketing_email` | Apollo-style email with `List-Unsubscribe` + `Precedence: bulk` | **MUST `skipped`** — this is the bug from your screenshot |
| `edge_14_recruiter_outreach` | Recruiter pitching candidates, not applying | `skipped` (or polite "no agencies" reply, but never treat as candidate) |

The two with hard `MUST` requirements are the ones most likely to embarrass you live. Test them first.

## Reading the checker output

```
fixture                       expected      actual       mentions   verdict
strong_01_senior_fullstack    pass          pass         ok         PASS
edge_13_marketing_email       skipped       skipped      ok         PASS
edge_11b_duplicate_second     skipped       pass         -          FAIL
   ↳ accepted: ['skipped'], got: pass
weak_01_buzzwords_no_ship     fail          fail         missing 2  PASS
   ↳ (soft) missing mentions: ['specific', 'shipped']
```

- **Verdict `PASS`** — decision matches one of the accepted values for that fixture.
- **Verdict `FAIL`** — decision is wrong. Look at this first.
- **`mentions: missing N`** — soft check. The reasoning/response didn't include keywords that *should* appear in a high-quality response. Defaults to a warning. Run `python checker.py results.json --strict` to make this hard.

Some fixtures have decisions like `pass_or_needs_info` — both are accepted because either is defensible.

## Running just one folder

```bash
python runner.py --only 04_edge_cases --handler my_handler:fn --out edge_results.json
python checker.py edge_results.json
```

Useful when iterating on a specific failure mode.

## What this pack does NOT test

- **Live email I/O.** The runner feeds your agent parsed dicts directly. It doesn't test that your Gmail polling works, that OAuth tokens refresh, or that outbound email actually delivers. Test that separately by sending a few real emails from another inbox.
- **Latency.** The brief mentions response time but the checker doesn't measure it. If you care, time `process_message` calls in your handler and add a `latency_ms` field to your result dict — extending the checker to grade on it is ~10 lines.
- **Visual rendering of outbound email.** The HTML email you send back can look broken even if the text is right. Open one in your own inbox before the demo.
- **Concurrency / rate limits.** Sending 26 messages back-to-back through the runner is sequential. If your agent has shared mutable state (token caches, dedup sets in memory), test it with multiple workers separately.

## Regenerating the fixtures

```bash
python _generate.py
```

Idempotent. Tweak the script if you want different candidates / edge cases.

## Recommended workflow before submission

1. `python runner.py --dry-run` — sanity check the fixtures look right.
2. Wire up your agent, run the full suite, look at every `FAIL` row.
3. Fix the `MUST skipped` failures first (`edge_11b`, `edge_13`).
4. Read your agent's actual outbound emails for the `02_weak/` fixtures — would *you* be okay receiving that rejection?
5. Read your agent's reasoning for the `03_borderline/` fixtures — does it actually weigh trade-offs, or is it pattern-matching?
6. Run `--strict` and aim for full green. If you can't, document why in your README's "trade-offs" section.

## Talking about this in your Loom

Showing a clean run of this pack in your video (even just a screenshot of the checker output) is a strong signal. It says: *I built an adversarial test suite for myself and ran it before submitting.* Most candidates won't.

If you can also show a `evaluator/skipped` Gmail label populated with all the marketing emails your agent silently filtered out — that's the chef's kiss.
