# IDEA-BRIEF — Day 05: todo-debt

> Written BEFORE any code. If any section is blank at build start, the build doesn't start.

## The complaint (evidence)
- **Subreddit:** r/webdev (the same "What is a tool you wish existed?" thread Day 03 answered)
- **Thread / quote:** devs lamented the dead npm package that collected TODO comments into one list (40 points on the reply); "later never comes" is the perennial r/ExperiencedDevs debt-talk shape underneath it.
- **Why I believe it's recurring:** the wish-thread reply mourns a tool that *existed and died* — demand that outlived its supplier; and TODO-debt confessions ("300 TODOs, nobody knows which are load-bearing") recur across r/ExperiencedDevs, r/webdev and every code-review thread where a `// TODO: remove before launch` from 2019 survives into production.
- **Source URL:** https://www.reddit.com/r/webdev/comments/17u929n/what_is_a_tool_you_wish_existed/

## Why this should exist (ponytail rung 1)
The data is already in git — every marker comment has a file, an author and a birthday in `git blame` — but git never shows it as one list, so the debt is invisible until it bites; a tool that just *reads* what git already knows cannot rot.

## The people hurting
Any developer inheriting or maintaining a codebase with marker comments, who today runs `grep -r TODO` and gets an unsorted, undated, unowned wall of 200 hits (or doesn't run it at all, which is the actual problem).

## Scope
- **30-minute floor (fallback):** CLI that walks tracked files (`git ls-files`), greps TODO/FIXME/HACK, prints file + line + note. Done.
- **Today's target:** that plus **author and age from `git blame`** (never dates parsed out of comments), a ratchet mode for PRs — `--base <ref>` diffs marker lines added vs removed and exits 1 when a PR adds net-new debt — and a copy-paste GitHub Action that posts the drift report on the PR (one living comment per PR, updated not duplicated).
- **Deliberately NOT building:** no issue-tracker sync (TODO→issue is a write to someone else's system), no dashboards, no "AI prioritization" of TODOs, no per-author shaming leaderboard, no TODO auto-removal.

## Stack of the day
TypeScript + GitHub Actions — the series' third zero-dependency Node CLI (native type-stripping, `node:util parseArgs`) and second Actions consumer. Maps to the #1 2026 JD demand (TypeScript) plus the CI-ratchet habit. Meta-story: this is the `ponytail-debt` pattern from my own series, productized — my ledger (`PONYTAIL-DEBT.md`) is generated from exactly the marker-comment discipline this tool automates, so Day 05 runs on its own repo as the validation.

## Definition of done
A stranger can run `node todo-debt.ts <any-repo>` and see every TODO/FIXME/HACK with its age and author in under 5 seconds, and `node todo-debt.ts --base HEAD~1` in any git repo exits 1 exactly when that commit range adds net-new marker lines — verified against this repo's own 18 `ponytail:` markers before shipping.
