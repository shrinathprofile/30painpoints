# BUILD-LOG — Day 02: stale-PR wrangler

> Appended in real time, not written at the end. Honest beats tidy.

## Decisions
| Time | Decision | Why |
|------|----------|-----|
| 0:05 | Zero deps again — native `fetch`, not `@actions/github` | Node 22 ships fetch; the Actions SDK is a convenience wrapper over REST we call four times. Same rung-2 ladder call as Day 01. |
| 0:10 | No `action.yml` packaging — ship script + copy-paste workflow | Composite actions can't carry a `schedule:` trigger; the consumer's workflow is the native platform feature. One less file, one less registry. |
| 0:15 | `run(opts, api, io)` — world fully injected | Day 01's retro said it verbatim: "inject the world (GitHub API client behind a parameter) — same pattern, bigger stage." Design cost ≈ 0 because yesterday forced the decision. |
| 0:20 | Staleness = `updated_at` age on non-draft PRs; reviewers from `requested_reviewers` in the list payload | The whole digest builds from ONE API call. Any push/edit/comment refreshes the clock — "no activity for N days" is exactly the complaint's failure mode. |
| 0:25 | Ping-once-per-window via a dated HTML marker in our own comment | Zero-state idempotency: no DB, no cache, no Actions artifacts. Works whether or not commenting bumps `updated_at`. |
| 0:30 | Rotation = `PR number % team size` | Deterministic, spreads load evenly, stable across days — the PR number IS the state. |
| 0:40 | Default exit 0 even with stale PRs; `--enforce` to fail | A daily cron that goes red because PRs exist trains people to ignore it. Failure must be opt-in (CI-gate use). |

## Rabbit holes
| Time lost | What happened | Lesson |
|-----------|---------------|--------|
| 15 min | **The sort bug (caught by the real run, not the self-check):** the pulls API defaults to newest-created-first. On any repo with >100 open PRs, page 1 contains the *newest* PRs — the stale ones live at the far end. The tool reported "nothing waiting > 90 days" on denoland/deno. Fix: `sort=updated&direction=asc`, so page 1 is always the stale end. | The fake API in tests returns exactly what you feed it — provider-side default orderings are *correctness decisions* and can only be validated against the real provider. |
| 10 min | Chatty-PR re-ping: comments endpoint returns oldest-first, so on a 500-comment PR our recent ping marker sits on the last page and gets missed → double ping. First "fix" was `sort=created&direction=desc` — **which the per-issue comments endpoint silently ignores** (post-ship validation: identical order with and without it on a 513-comment issue; the fake-API test only asserted the URL we built). Real fix: `since=<now − window>`, the one filter that endpoint honours. | Every paged endpoint has an ordering question attached — and asserting you *sent* a param proves nothing about whether the provider *honours* it. |
| 5 min | The async-check trap (caught at write time): day-01's sync `check()` helper would log ✓ *before* an async assertion's promise settled — async checks could false-pass. Fixed before first run. | Reusing yesterday's harness? Check its assumptions match today's shapes (sync checks → async run()). |
| 5 min | Floating `.then()` at the CLI edge could unhandled-reject with a raw stack on an infra bug. Added the rejection handler → clean exit 1. | Exit paths deserve the same error-handling as happy paths. |

## AI vs me
| ZCode did | I did (chose / rejected / rewrote) |
|-----------|-----------------------------------|
| Wrote script, fixtures, self-check, workflow, docs — and ran the adversarial review pass itself | Set the rule up front: "same logic as day 1" — the day-01 discipline (brief-before-code, injectable world, assert checks, real-run validation, ponytail markers) was the steering |
| First fetch used the API's default ordering | The real-run validation habit (day-01's "validate exit codes without pipes in the way") is what surfaced the 440-day PRs — and with them the sort bug; chose oldest-activity-first as a *correctness* rule, now in the README table |
| Drafted `action.yml` composite packaging | Rejected it: composite actions can't carry cron; consumer workflow is the native feature (one file cut at SHRINK) |
| Suggested storing ping state in Actions artifacts / cache | Rejected: dated markers in our own comments make the tool stateless — state that isn't there can't drift |

*This table is the judgment evidence. If it's empty, either the build was trivial or I wasn't steering.*

## Shortcuts marked
- `ponytail:` one page of PRs (oldest-activity-first) — trigger: a repo with >100 simultaneously-stale PRs
- `ponytail:` marker trust (any comment containing our exact HTML marker counts as ours) — trigger: first spoofing report
- `ponytail:` no retry on 403 secondary rate limits — trigger: a scheduled run that dies to rate limiting
- `ponytail:` approved-but-unmerged PRs read as "waiting" (no review-state call) — trigger: complaints about nudging approved PRs; then one GET /reviews per stale PR
- `ponytail:` single-file CLI over commander — trigger: a second subcommand (same as day-01)

## The one check
`self-check.ts` — 17 assert-based checks: staleness/rotation/marker logic table, markdown rendering (incl. pipe-escaping), end-to-end `run()` against a fake API that **records every POST** (proves pings land only on PRs without a fresh marker), CLI usage errors, and the day-01 symlink regression. `npm run check`.

## Real-world validation (before shipping)
Read-only, unauthenticated: own repo (all-clear path) · denoland/deno `--days 90` → 89 stale (post-sort-fix; 0 before it) · `--days 200` → 4 stale, oldest **440 days** · nonexistent repo → clean `GitHub API 404`, exit 1 · `GITHUB_STEP_SUMMARY` writer → renders the markdown table. Self-check 17/17.
