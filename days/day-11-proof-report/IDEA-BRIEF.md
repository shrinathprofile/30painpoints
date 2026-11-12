# IDEA-BRIEF — Day 11: proof-report

> Written BEFORE any code. If any section is blank at build start, the build doesn't start.

## The complaint (evidence)
- **Subreddit:** r/remotework
- **Thread / quote:** "My company tracks whether you open Slack within 15 minutes of start" — **8.8K upvotes, 479 comments**; presence surveillance is remote work's hottest wound. The thread is people describing green-dot monitoring, keystroke counters, and "active" indicators — being measured by *visibility* instead of *output*.
- **Why I believe it's recurring:** 8.8K upvotes is this doc's largest thread by a factor of ~5; 479 comments means echoing, not solving (D01's queue-not-discussion signal). Presence-tracking complaints recur weekly in r/remotework.
- **Source URL:** https://www.reddit.com/r/remotework/comments/1t2focv/my_company_tracks_whether_you_open_slack_within/
- **Note (honest):** Reddit's bot wall blocked re-fetching the thread today (D04/D08 precedent); evidence is the ideas doc's verified record from 2026-10-24. No numbers invented beyond that record.

## Why this should exist (ponytail rung 1)
The output ALREADY EXISTS — every commit in `git log` is third-party-verifiable proof — but it is compiled nowhere, so the cheap-to-measure thing (presence) wins by default. A command that compiles the receipts in 5 seconds changes what's cheap. It reads what git already knows, produces a paste-able document, and cannot rot into a monitoring tool: it has no daemon, no scheduler, and one direction — you run it on yourself and share what it prints.

## The people hurting
Any remote worker whose manager equates "green dot" with "working" — and who ends the day having shipped plenty that nobody can see at a glance.

## Scope
- **30-minute floor (fallback):** CLI that reuses Day 08's git parsing (`packages/git-digest`) and prints a daily output summary: commits with short hashes, +/- lines, files touched. No tickets line, no docs count. Done.
- **Today's target:** the floor plus — `--days N` / `--since` / `--me` (same flags, same semantics, same functions as Day 08 — that's the point), per-commit receipts with short hashes (`git show`-verifiable), unique files touched and docs-file count from numstat, ticket keys harvested from subjects, area tally, first→last-commit landing span (framed as *when work landed*, explicitly NOT hours-at-desk — this tool must not become the surveillance it answers), singular/plural and inert/cap/future notes (package discipline). Exit trichotomy: 0 report · 1 no commits in window (honest empty) · 2 cannot check (refusals name the true reason).
- **The other deliverable — the extraction itself:** Day 08's brief deferred `packages/git-digest` to "day-11, the named first importer." Today extracts Day 08's parser verbatim into `packages/git-digest/`, rewires Day 08 onto it, and Day 08's existing 41-check self-check — byte-precise assertions unchanged — is the extraction's proof. New porcelain parsing (hash + numstat, a different record shape) stays local to Day 11 until a second importer exists.
- **Guarding against:** the numstat record seam (blank-line-terminated blocks, binary `-` lines, quoted paths, renames — strict-shape or counted-inert, never guessed) · every D06/D08 display trap (control pictures, rune-boundary clip) — inherited from the package, not re-implemented · author-date windows in JS, not git's committer-date `--since` (D05/D08) · future-dated commits excluded AND counted (D08 F4) · a same-name stranger never enters your report (D08 F3, two-pass identity) · the span line must never read as hours worked.
- **Deliberately NOT building:** no LLM pass (a proof report with generated prose is a weaker proof — receipts, not narrative; this is also the scope line vs Day 08), no Slack posting (scope cut), no boss-facing dashboard, no monitoring of anyone else, no multi-repo mode, no HTML output (Markdown pastes everywhere).

## Stack of the day
TypeScript CLI, zero dependencies, Node ≥ 22.18 native type-stripping — plus **the series' first cross-day package**: `packages/git-digest`, extracted verbatim from Day 08 (rungs 1–2 of the ladder: already in this repo > new code). The ideas card promised "Day 11 takes 40 minutes because Day 08 extracted a package"; the honest version — Day 08 *seeded* the parser and named today the extractor — is that the extraction is today's first hour and the reporter is the 40 minutes after it. The NEXT git tool starts at 40 minutes.

## Definition of done
In any git repo with recent commits, `node proof-report.ts` prints a shareable Markdown report — one line per commit with a short hash, headline stats (commits, files, +/−, docs), tickets and areas — in under 5 seconds, exit 0; with no commits in the window it says so honestly, exit 1; on a non-repo / bare repo / missing git / bad flags it names the true reason, exit 2 — verified against this repo's own 10-day real history, a scripted fake world, AND Day 08's 41 checks still green on the extracted package.
