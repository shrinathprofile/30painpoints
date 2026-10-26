# IDEA-BRIEF — Day 01: env-doctor

> Written BEFORE any code. If any section is blank at build start, the build doesn't start.

## The complaint (evidence)
- **Subreddit:** r/webdev
- **Thread / quote:** "Guys I'm tired of spending hours configuring my development environment" — a 15-year dev describing setup dread on every new project. **504 upvotes, 198 comments.**
- **Why I believe it's recurring:** 198 comments means 198 people typing "same"; env-setup dread is the canonical r/webdev genre (node version mismatches, missing .env keys, "works on my machine") and every onboarding checklist tries to solve it with docs nobody reads.
- **Source URL:** https://www.reddit.com/r/webdev/comments/1jgrdgl/guys_im_tired_of_spending_hours_configuring_my/

## Why this should exist (ponytail rung 1)
Onboarding docs rot the moment the repo changes; a diagnostic that *reads the repo itself* and prints what's wrong cannot rot, because the repo is the source of truth.

## The people hurting
Any developer cloning a repo they didn't create — new hires, open-source contributors, people returning to an old project — who today debug blindly or ping a teammate.

## Scope
- **30-minute floor (fallback):** check `package.json` engines vs running Node, and `.env.example` keys vs `.env`. That's it.
- **Today's target:** a CLI that scans a repo path for `.nvmrc`, `package.json` (engines, lockfiles, node_modules presence), `.env.example` vs `.env`, and `pyproject.toml` (requires-python) — then prints every mismatch with the exact fix command. Non-zero exit if anything fails (CI-able).
- **Deliberately NOT building:** no auto-fixing (diagnose + tell; don't touch the machine), no Docker/devcontainer generation, no language ecosystems beyond Node and Python, no Windows-specific checks beyond path handling, no `--fix` flag, no registry lookups.

## Stack of the day
TypeScript + Node CLI, **zero dependencies** — `node:util parseArgs` instead of commander, native TS type-stripping (Node ≥22.18) instead of a build step. Maps to the #1 demand in 2026 job descriptions (TypeScript, GitHub Octoverse 2025) plus the CI-able exit-code habit.

## Definition of done
A stranger can run `node env-doctor.ts <any-repo-path>` and in under 5 seconds see either "✓ environment looks good" or a numbered list of what's wrong, each with a copy-paste fix command — verified against a fixture repo with planted problems.
