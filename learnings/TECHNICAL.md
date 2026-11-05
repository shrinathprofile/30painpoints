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

### D06 — Go day: default type conversions are silent bugs; only log-shaped lines vote
- `json.Unmarshal` into `any` makes every number float64 — ns-precision epochs (19 digits) come back with confidently-wrong last digits. `json.Decoder.UseNumber()` + `strconv.ParseInt` is the exact path. Same disease as D05's spawnSync seam: the ecosystem's default conversion is where the bug hides, invisible to every fake fed well-formed input.
- Go's `flag` package stops at the first positional and `ExitOnError` calls `os.Exit` mid-`run()`. A grep-replacement CLI needs a flag HOISTER (known flags move before positionals; split on `=` before the arity lookup) and `ContinueOnError` + `ErrHelp→0` so the wiring stays testable in-process. Both idioms carry to every future Go CLI day.
- Format sniffing: decide who VOTES, not who wins. Continuations (stack lines) never vote; only log-shaped lines vote (JSON needs time-or-level); one log-shaped line is enough (`tail -n 1 | tool -`) while `{"a":1}` blobs can't capture plain files. Third appearance of the D05 position-over-prefix lesson.
- Real-world log trivia that broke parsers the author's own fixtures didn't contain: Python `%z`/Java `Z` no-colon zones (`+0530`), stringified epochs (`"ts":"1793750400"`), docker json-file's `"log"` key, 5-field CLF, `?level=` inside URLs, `\n` escaped inside JSON strings, mid-rune truncation. ALL found by the fresh-context adversarial reviewer (11 findings, 9 minutes), none by 19 tests + real-machine runs. The adversarial pass is a series standard now.
- Generated-source hygiene: raw NUL and raw BOM bytes in string literals compile-time-fail (`illegal character NUL` / `illegal byte order mark`) — `go vet` before anything else runs; invisible bytes are the new trailing whitespace.
- Reusable: `parseTimeStamp` (layout ladder + colon-normalizing zone retry) + `parseEpoch` (string-in, int64-exact, s/ms/µs/ns) + sniff-share rule + plain-anchor fallback for mixed files. D29 rebuild candidate.

### D07 — You can't scroll someone else's iframe; URL parsing is engine-divergent
- Cross-origin iframes cannot be scrolled by the parent — the sync-scroll trick that needs zero site cooperation: render each iframe very tall (40k px) inside a clipped scrollable column and scroll the *column*; pair with CSS `zoom` (affects layout; `transform: scale` does not) for multi-width walls in ~40 lines. Ceilings to name honestly: tall pages cut off, short pages get blank scroll, pixel-sync not percentage.
- `new URL()` diverges across engines: Chromium percent-encodes spaces inside hosts (`https://not a url` parses!) where Node throws — so a URL at a trust boundary gets **your own guard before the platform's parser**, or your selfcheck goes green on a claim only Node honors (D05's executed-checks rule now has a cross-platform face).
- A React mount div (`#root`) silently breaks a `body { display: flex }` column chain — `#root { display: contents }` is the one-liner; symptom when forgotten: scroll containers grow to content size and scrollTop clamps to 0.
- Reusable: `normalizeUrl` (scheme-with-`//` vs host:digit-port disambiguation, credential stripping, whitespace/control refusal, localhost→http) — inherits into any URL-at-a-boundary day (D09, D12).

### D08 — Seams: units, double-parsing, and one sanitize to rule them all
- git `%at` is epoch SECONDS; `Date.getTime()` is MILLISECONDS. The window filter compared them directly → every repo read "no commits". Eleven checks passed first because fabricated-timestamp fixtures had windows that were *expected* to be empty — real-magnitude epochs are what blew it open. Rule: two systems handing you numbers → assert the UNIT at the seam (`c.ts * 1000`, with the comment), before any comparison.
- A flag gets ONE parser. main() validated `--since` with the local-midnight parser; run() re-parsed the raw string with `new Date` — UTC midnight, the exact trap the brief named, shipped anyway. Downstream code receives the PARSED value, never the string to re-interpret.
- Unicode control pictures (U+2400 block) killed three adversarial findings with one mechanism: sanitize emits single-rune visible symbols (␇ ␍ ␛) instead of escapes — no raw control bytes reach stdout, clip-after-sanitize can never cut mid-escape (pictures don't shrink), and typed `\u0007` text can't impersonate the picture. One mechanism > three patches; LLM output goes through the SAME sanitize as sibling paths.
- Reusable: `parseLog` record format (NUL-prefixed records, `\x1f`-joined fields, strict-epoch inert counting — a field-shifted record counts, never guesses) + the two-pass identity filter (email authoritative when it matches anything; name only when email matches zero — a same-name stranger must not enter your draft). Day-11's git-digest is the named first importer: these are the seed of `packages/git-digest`. D09 inherits the determinism call: pin locales wherever output must be byte-stable.
