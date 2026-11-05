# IDEA-BRIEF — Day 08: standup-prep

> Written BEFORE any code. If any section is blank at build start, the build doesn't start.

## The complaint (evidence)
- **Subreddit:** r/ExperiencedDevs
- **Thread / quote:** "Is this your situation too with daily standups?" — the thread is devs describing that *composing* the daily update is its own dread: remembering what you did, translating it into the team's format, at 9:55am every day.
- **Why I believe it's recurring:** 717 votes / 312 comments — a comment count that size means people echoing the pain, not solving it (D01's queue-not-discussion signal). Standup dread recurs across every "rituals you hate" thread in r/ExperiencedDevs and r/remotework.
- **Source URL:** https://www.reddit.com/r/ExperiencedDevs/comments/1lvo7fd/is_this_your_situation_too_with_daily_standups_do/
- **Note (honest):** Reddit's bot wall blocked re-fetching the thread today (D04 precedent); evidence is the ideas doc's verified record from 2026-10-24. No numbers invented beyond that record.

## Why this should exist (ponytail rung 1)
The standup content is already written — it's in `git log` — but git shows commits, not a *standup*, so every developer re-translates their own day from raw hashes by memory every morning; a tool that only reads what git already knows cannot rot and touches nothing.

## The people hurting
Any developer on a team with a daily standup who spends 5–15 minutes before each call reconstructing what they did yesterday — today by scrolling `git log`, their memory, and open tabs.

## Scope
- **30-minute floor (fallback):** CLI that reads the last day's commits (`git log`, injected world) and prints a copy-pasteable 3-bullet "did" list grouped by area. No LLM, no flags beyond the repo path. Done.
- **Today's target:** the floor plus — a `--days N` / `--since` window with honest empty-day handling, `--no-merges` and author filtering (just yours: `--me`), ticket IDs surfaced from commit subjects (e.g. `AUTH-123`, regex from the repo's own history — no Jira OAuth), and the day's headline: `--llm` one tone-polish pass over the draft (OpenAI-compatible endpoint via env vars, **LLM injected as a world function**, off by default). Exit trichotomy: 0 draft produced · 1 no commits in window (honest empty) · 2 cannot check (not a repo / git failed / bad flags / LLM requested but undeliverable — never silently falls back).
- **Guarding against:** provider default ordering (git log is newest-first; a standup reads chronological — D02) · record separators that commit content can collide with (%x1f fields / NUL record split — NUL is impossible in commit objects, D06 F4) · control chars and rune-boundary output from commit messages (D06 F6/F7) · string/epoch timestamp parsing (D06 F5/V2) · checks adjudicated by execution with hand-counted fixtures, twice (D05) · the injected-world real-provider end-to-end check — this repo's own git history is the ≥2-real-sources requirement (D05 meta) · exit matrix verified pipe-free (D01/D04) · LLM output treated as untrusted text at a trust boundary — printed, never executed, and validated non-empty before use.
- **Deliberately NOT building:** no calendar/Jira OAuth (ticket export = regex on subjects, scope cut), no Slack posting, no multi-repo org mode, no persistent state or caching, no interactive editor. One repo, one draft, you edit it.

## Stack of the day
TypeScript CLI — the series' fourth zero-dependency Node CLI (native type-stripping, `node:util parseArgs`) plus **the first LLM-integration day** (the #2 most-demanded 2026 JD skill). **Ladder override, logged:** the ideas card names `simple-git`, but D01's rule — the plan never outranks the ladder — applies: raw `git` via spawn with the day-05 World adapter is already in the repo and is zero deps; `simple-git` stays unbuilt. The LLM call is plain `fetch` to an OpenAI-compatible endpoint (stdlib), injected like day-02's API. Idiom source: day-05's `parseDiff`/`parseBlame` are diff/blame porcelain — day-08 parses `git log` porcelain, a different shape, so copy-idiom per D03; `packages/git-digest` extraction stays planned for day-11, the named first importer.

## Definition of done
In any git repo with recent commits, `node standup-prep.ts` prints a copy-pasteable standup draft (done-bullets grouped from real commits, ticket IDs surfaced) in under 5 seconds — exit 0; with no commits in the window it says so honestly (exit 1); with `--llm` it returns a tone-polished draft and exits 2 naming the reason when git, config, or the LLM call cannot deliver — verified against this repo's own 8 days of real commit history and a scripted fake world.
