# stale-PR wrangler

**Day 02 of 30** · [Retro](RETRO.md) · [Build log](BUILD-LOG.md)

> "Why does code review take forever once teams hit 15-20 engineers?" — r/ExperiencedDevs; the top answer (571 points) blames the waiting, not the code
> [thread →](https://www.reddit.com/r/ExperiencedDevs/comments/1rjfo06/why_does_code_review_take_forever_once_teams_hit/)

A zero-dependency TypeScript script + a 20-line workflow that, every morning, shows **which PRs have been waiting longest and whose turn it is to review**:

- lists all open PRs, flags every non-draft PR with **no activity for N days** (default 3)
- prints the digest to stdout **and** the workflow-run summary (a markdown table)
- with `--post`, comments a one-line nudge on each newly-stale PR tagging a **deterministically rotating reviewer** (`PR number % team`) — no state file, no database
- pings each PR **at most once per window** (a dated HTML marker in its own comment says when it last pinged)
- `--enforce` exits non-zero while anything is stale — the review-latency CI gate
- **Read + comment only.** It never assigns reviewers, never touches branches, never merges.

## Run it

Locally, read-only (works on public repos with no token at all):

```bash
# needs Node ≥ 22.18 (native TypeScript type-stripping — no build step, no deps)
node stale-pr.ts --repo denoland/deno --days 200
```

In your repo (the actual "GitHub Action"): drop `stale-pr.ts` anywhere in the repo, paste [`workflow-example.yml`](workflow-example.yml) as `.github/workflows/stale-pr.yml`, edit the reviewer list, done — the schedule and the `GITHUB_TOKEN` are native Actions features.

## What it looks like

Real run, 2026-10-27, read-only against denoland/deno (`--days 200`):

```text
stale-pr — denoland/deno (threshold: 200 days, 100 open)
 ⏳ #30376 · feat: unstable feature async-dns-resolver — waiting 440 days → nudge: nobody configured
 ⏳ #30221 · feat: Replace spawn_blocking with spawn_blocking_o — waiting 440 days → nudge: nobody configured
 ⏳ #30085 · fix(permissions): check before and after dns resol — waiting 229 days (asked: bartlomieju, littledivy) → nudge: nobody configured
 ⏳ #30791 · perf: key gen cache by emit configuration — waiting 228 days → nudge: nobody configured

4 stale · dry-run (--post to nudge) · informational
```

And the workflow-run summary renders as a markdown table (Waiting · PR · Author · Asked · Today's nudge).

Exit codes: `0` fine (stale PRs don't fail a cron by default) · `1` API failure, or stale-while-`--enforce` · `2` usage error.

## How it decides

| Decision | Rule | Why |
|----------|------|-----|
| "Waiting" | non-draft PR with `updated_at` older than the threshold | any push, edit or comment refreshes it — the PR is only stale when *nobody did anything* |
| Fetch order | `sort=updated&direction=asc` — oldest activity on page 1 | on a 1000-PR repo, staleness lives at the far end of the default sort; page 1 must be that end |
| Rotation | `PR number % team size` | deterministic, spreads load, zero state to drift |
| Ping cadence | own comment marker `<!-- stale-pr-ping YYYY-MM-DD -->`, re-arms after one window | works whether or not a comment bumps `updated_at`; no DB, no cache |
| Unparsable date | treated as not stale | never ping on bad data — false negatives are safe, false pings are spam |

## Validate it works

```bash
npm run check    # 17 assert-based checks: logic table + end-to-end runs against a fake API that records every POST (clock fixed at 2026-10-27)
```

Plus real-world validation before shipping: read-only runs against `shrinathprofile/30painpoints` (all-clear path), `denoland/deno` (89 stale > 90 days; 4 stale > 200 days), a nonexistent repo (clean 404 → exit 1), and the workflow-summary writer.

## Deliberately not built

No Slack/email, no auto-assignment or requested-reviewer **writes**, no review-state analysis beyond the list payload's `requested_reviewers` (an approved-but-unmerged PR still shows as waiting — arguably correct: it *is* stuck), no dashboards, no multi-repo org mode, no pagination past 100 (one page of oldest-activity-first covers every team the complaint describes). Every cut is marked in the code with a `ponytail:` comment.

## Files

- `stale-pr.ts` — the tool (249 lines, stdlib only — native `fetch`)
- `workflow-example.yml` — the copy-paste scheduled workflow (this file is the "Action")
- `self-check.ts` — the one runnable check
- `fixtures/` — realistic GitHub REST payloads (PR list + comment threads)
