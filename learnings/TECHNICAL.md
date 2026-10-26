# Technical Learnings

> One entry per day, max. Actionable tomorrow or it gets cut. See [rules](README.md).

<!-- Format:
### D01 — title
- what happened / the pattern / the fix
- reusable: yes/no → where
-->

## Week 1 — Developer pain

### D01 — Native TS + inject-the-world = testable zero-dep CLIs
- Node ≥22.18 strips TypeScript at runtime: zero-dependency, zero-build-step TS CLIs are a real shipping option now. Declare `engines: node >=22.18.0` honestly and skip the toolchain entirely.
- Testability pattern: `scanRepo(dir, probe)` — the scanner takes runtime versions as a parameter, defaulting to real detection. Self-checks become deterministic and pass identically on any machine. Reading the world *inside* logic is what makes tests flaky.
- Regex density is a smell: a 3-regex x-range matcher was subtly wrong; `raw.split(".")` + part inspection was 4 lines and obviously correct.
- Reusable: `satisfiesRange()` (~40 lines, node-semver subset + PEP 440 operators, stdlib only). Extract to `packages/` on the second consumer — not before. (D09 overlap planner is the likely first.)
