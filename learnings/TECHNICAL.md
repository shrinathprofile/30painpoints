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
- Post-ship: recording fakes whose `dirSize`/`rm` never throw can't catch throws — EACCES (root-owned `~/.npm`) crashed the dry-run, one failed `rm` aborted `--go`. Fake the syscall failure modes too; isolate each destructive step so one failure can't skip the rest. And wrap `parseArgs`: its throws are usage errors (exit 2), not crashes.

### D04 — Diff specs, not source; a CI linter has three outcomes
- Ask the framework for its own contract: `app.openapi()` returns the same dict the deployed `/openapi.json` serves, so "app vs spec" becomes dict-vs-dict with zero FastAPI internals and zero source parsing. Fourth provider-pattern day in a row (GitHub sort, pnpm store path, killall semantics, FastAPI itself).
- Exit-code honesty for linters: in sync (0) / drift (1) / **cannot check** (2). A real repo's app raised `TypeError` at import under newer typing-extensions, and the first tool version printed a stack and exited 1 — CI would have filed "docs drifted" when the check itself was broken. User-code imports get a catch-all: user code can raise anything, including inside framework route registration.
- Real-world input trivia that crashes naive parsers: a string inside a spec's `parameters` list; a UTF-8 BOM (PowerShell export signature — read with `utf-8-sig`, which handles both); an `openapi()` overridden to return `None`.
- Plain-assert checks can serve two runners by naming alone: `test_*()` functions with zero framework APIs run green under a 6-line `__main__` loop AND under pytest — the stack card is honored without the tool or the checks depending on it.
- Reusable: `extract()`/`diff()` (~60 lines, stdlib) — OpenAPI endpoint normalizer + drift differ; inherits into Day 29 rebuild or any future spec tool. Also the self-proving Dockerfile (checks green AND the failure path must fail, or the container exits non-zero).

### D05 — Header-vs-content is a position fact; the fake/real seam is where bugs live
- Diff-parsing lesson: `--- a/x` / `+++ b/x` are headers only OUTSIDE hunks and `+`/`-` lines are content only INSIDE — deciding by string prefix ("skip lines starting +++") rejects real content that begins `++`, and forgetting to reset hunk state at `diff --git` boundaries turns the NEXT file's `--- a/TODO.ts` header into "removed content" (a marker in a PATH false-fires as debt). Lexer state machine, not prefix blacklists.
- git trivia: diff headers suffix a TAB onto paths containing spaces (`+++ b/my file.ts\t`) — trimEnd or the tab leaks into reports. Renames with 100% similarity emit no content hunks at all (debt moves without tripping the ratchet — correct by construction, like whitespace reformats netting zero).
- The World-adapter seam bug: the CLI handed spawnSync's raw result to a World expecting `{ok, stdout, stderr}` — `ok` always undefined, every real git call "failed", and 21 scripted-world checks passed through it. Fake worlds are well-formed by construction; the bug lived exactly at the boundary fakes can't see. Fifth straight real-run day (npm bin link, GitHub sort, mDNSResponder, import-crash-as-drift, now this): every injected-world day adds ONE real-provider end-to-end check, no exceptions.
- Wrong-assertion day: six checks were wrong while the tool was right (hand-miscounted fixture, escaped-pipe expectation, stderr-vs-stdout guess, "no FIXME" forgetting the header prints the marker list, a fixture mutation that dropped the sections it claimed to keep, one check asserting the opposite of its own fixture). Four caught by running, two by hand-recount before they ever ran green. Day-03's warning reproduced ×6. Checks are reviewed by execution; fixtures are hand-counted, twice.
- Ratchet design: EXISTING debt exits 0 (informational index), only the `base...HEAD` DELTA exits 1 — a linter that fails forever on 200 legacy TODOs trains teams to ignore it. Posting config validates BEFORE the diff: a broken action must fail fast (2), not print "drift found" and die half-delivered.
- D02's gh-harness extraction trigger fired (D05 was its named second consumer) and was overruled again per D03's re-arming: 4th copy-idiom of `run(opts, world, io)` + recording fake, zero imports. `packages/` stays empty until a day must import another day's logic (D08/D11 git readers are the candidates — and they inherit `parseDiff`/`parseBlame` when they do).
