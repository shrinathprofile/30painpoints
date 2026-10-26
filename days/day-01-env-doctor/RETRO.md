# RETRO — Day 01: env-doctor

> No retro, no post. The post is a byproduct of the work.

## What I learned
- **Technical:** Node ≥22.18 strips TypeScript natively — a zero-dependency, zero-build-step TS CLI is now a real shipping option, not a party trick. And: make environment-dependent logic injectable (a `probe` parameter) if you ever want deterministic tests; reading the world inside your logic function is what makes tests flaky.
- **Meta:** The plan said "commander"; the ladder said stdlib. The ladder wins every time — but only if you actually run the SHRINK pass with deletion intent. Two of today's three cuts were dead guards I'd written an hour earlier.

## Reusable artifact
The minimal semver-subset `satisfiesRange()` (comparators + x-ranges + `||` unions + PEP 440 comma form, ~40 lines, stdlib only). Day 09's overlap planner and any future engines/manifest tool inherit it. Extract to `packages/` when a second consumer appears — not before.

## Ponytail debt created
Five markers (see BUILD-LOG) — all low-severity, all with named triggers. Ledger: none need action this week.

## Numbers
- Time spent: ~1.5h (light day, within timebox)
- Token spend (est.): ~120k across planning docs + build + validation
- Self-check passing: yes — 11/11, plus real CLI validated on 5 targets (broken fixture, clean fixture, self-referential run, docs-only repo, bad path) with exit codes 1/0/0/1/2

## Tomorrow
Day 02 (stale-PR wrangler, build day): reuse today's decision to inject the "world" (GitHub API client behind a parameter) — it's the same testability pattern, bigger stage.

## Honest failures
- The first engines fix-string was broken in a way my pure-function self-check could never catch (`nvm install 1820`) — the rendered output did. Lesson logged: assert on rendered strings too when the string IS the product.
- zsh tricked me into thinking the exit code was wrong (PIPESTATUS is a bash-ism). Cost 5 minutes, no code harm.
