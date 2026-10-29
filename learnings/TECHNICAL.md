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

### D02 — Provider-side defaults are correctness decisions; markers are free state
- The GitHub pulls list defaults to newest-created-first — on any repo with >100 open PRs, page 1 contains the only PRs that *can't* be stale. `sort=updated&direction=asc` makes page 1 the stale end forever. A fake-API test cannot catch this; only a real run can.
- Idempotency without state: stamp your own outputs (dated `<!-- marker -->` in each comment) and read them back. No DB, no cache, no Actions artifacts — state that isn't stored can't drift.
- Inherited harnesses carry inherited assumptions: day-01's sync `check()` would false-pass async assertions; await-ify before reuse.
- Reusable: `run(opts, api, io)` + recording fake API + injected clock. Second consumer (D05 GitHub-Action day) triggers `packages/gh-harness` extraction.

### D03 — Permission boundaries are provider-side behavior; discover, don't hardcode
- `killall -HUP mDNSResponder` exits 1 for non-root users (mDNSResponder belongs to root) — the third face of D02's lesson, now in local-command form. Fake worlds answer 0 for anything you didn't script to fail. Fix pattern: mark best-effort commands `required: false` in the registry — a demoted failure becomes a printed note, never a failed target.
- Ask the tool, not the filesystem-of-your-memory: `pnpm store path` returned `store/v10` on this machine — a versioned path every hardcoded "known location" gets wrong on the next major. One subprocess buys never-wrong discovery; undiscoverable → skip with a reason.
- Destructive-CLI trust boundary (inversion of D01's tell-don't-touch): plan by default showing exact paths + bytes, act on explicit `--go`, PM-owned clean commands for PM caches, `rm` restricted to documented-disposable dirs, bytes reclaimed re-measured after each clear.
- Test assertions written by the code's author inherit the code's arithmetic: two wrong assertions (byte total, rounding rule) failed against a correct tool. Review assertions as hard as code — a wrong assertion is a bug wearing a green checkmark.
- Reusable: recording fake world (`sh`/`dirSize`/`rm` scripted + every destructive call recorded) + PATH-stripped spawns for deterministic CLI tests. Copy-idiom stays: the zero-dep harness extraction trigger fired (3rd unchanged consumer) and was overruled — the copy IS the interface; extract only when a day must *import* another day's logic.
