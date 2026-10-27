# IDEA-BRIEF — Day 02: stale-PR wrangler

> Written BEFORE any code. If any section is blank at build start, the build doesn't start.

## The complaint (evidence)
- **Subreddit:** r/ExperiencedDevs
- **Thread / quote:** "Why does code review take forever once teams hit 15-20 engineers?" — the top answer (**571 points**) blames waiting, not code: PRs sit unreviewed because nobody owns the nagging. 5+ separate high-comment threads in r/ExperiencedDevs alone.
- **Why I believe it's recurring:** review latency is the sub's canonical scale complaint — every thread converges on the same failure mode (no rotation, no visible age, polite silence), and the market answers (CodeOwners, review bots) all assume you already know which PRs are rotting.
- **Source URL:** https://www.reddit.com/r/ExperiencedDevs/comments/1rjfo06/why_does_code_review_take_forever_once_teams_hit/

## Why this should exist (ponytail rung 1)
Review latency isn't a tooling gap at the moment of review — it's a *visibility* gap: nobody can see, each morning, which PRs have been waiting longest and whose turn it is to review. A scheduled digest that names the oldest waiters and rotates the nag turns "someone should review that" into an assigned, dated nudge — with zero new state.

## The people hurting
Developers on teams of ~10+ whose PRs wait days for a first review, and reviewers who only discover a stale PR when the author pings them in DMs — which is exactly the social friction the digest exists to remove.

## Scope
- **30-minute floor (fallback):** a workflow that lists PRs older than 3 days into the run summary. Read-only, done.
- **Today's target:** a zero-dependency TS script + copy-paste GitHub workflow. On a schedule it lists a repo's open PRs, flags every non-draft PR with no activity for N days (default 3), prints the digest to stdout **and** the workflow-run summary, and with `--post` comments a one-line nudge on each newly-stale PR tagging a deterministically rotating reviewer (`PR number % team`). Ping-once-per-window via a dated HTML marker in its own comments — no state file, no database. `--enforce` exits non-zero while anything is stale (CI-gate use).
- **Deliberately NOT building:** no Slack/email, no auto-assignment or requested-reviewer writes (read + comment only), no dashboards, no multi-repo org mode, no review-state analysis beyond what the PR list payload already carries (`requested_reviewers`), no pagination past the first 100 open PRs.

## Stack of the day
TypeScript + GitHub Actions REST API — native `fetch` (Node ≥22), `node:util parseArgs`, native type-stripping: **zero dependencies, zero build step**, same harness discipline as Day 01. Maps to CI/CD-in-JD demand (6.7% of postings) and GitHub as the #1 collab tool (81.1%, SO 2025).

## Definition of done
A stranger can drop `stale-pr.ts` + the example workflow into any repo and, on the next run (or `workflow_dispatch` click), see a dated digest of waiting PRs in the run summary — verified before shipping by a read-only run against a real public repo plus an assert-based self-check with a fake API that records every POST.
