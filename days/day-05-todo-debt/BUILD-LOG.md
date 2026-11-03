# BUILD-LOG — Day 05: todo-debt

> Appended in real time, not written at the end. Honest beats tidy.

## Decisions
| Time | Decision | Why |
|------|----------|-----|
| 0:05 | Age from `git blame --line-porcelain -w`, never comment dates | Day-04 carry-over: ask the provider. A date inside a TODO rots the moment someone reformats the line; blame re-derives it. |
| 0:05 | File set from `git ls-files`, not a directory walk | Tracked files only, gitignore respected for free, and it's philosophically right: debt enters the ledger when it's committed. |
| 0:10 | Two modes, not subcommands: index (default) + `--base <ref>` ratchet | parseArgs stays (ponytail ceiling from days 01–03); a repo's EXISTING debt must exit 0 — a linter that fails forever on 200 old TODOs is how teams learn to ignore tools (day-04's lesson, applied). |
| 0:15 | Drift = marker lines on `+`/`-` of `git diff --unified=0 base...HEAD` | The diff is the provider — no scan-and-compare, no line-number matching. Three-dot = merge-base = PR semantics. Free feature: renames and whitespace reformats net zero by construction. |
| 0:20 | Exit trichotomy: 0 clean / 1 drift / 2 cannot-check; `--post` config validated BEFORE diffing | Day-04 carry-over. A misconfigured action must fail fast as 2, not report drift (1) and die half-delivered. |
| 0:25 | One living PR comment: find ours by marker, PATCH in place; clean PRs get nothing | Day-02's marker-read-back idiom, third use. No state, no duplicate reports, no comment spam on green PRs. |
| 0:30 | Markers case-as-given, whole-word | Uppercase TODO is the convention; `--markers ponytail` (lowercase) is how this repo's own ledger gets indexed — the meta-demo runs on the tool's own discipline. |

## Rabbit holes
| Time lost | What happened | Lesson |
|-----------|---------------|--------|
| 15 min | First parseDiff guarded content lines with `!startsWith("+++")` — which also rejected real content lines that begin `++` (`++++ TODO banner` in the diff) | Header-vs-content is a POSITION fact (inside a hunk or not), not a PREFIX fact. State machine, not string blacklist. |
| 10 min | The same parser didn't reset hunk state at `diff --git` boundaries — a following file's `--- a/TODO.ts` header could be read as removed content (marker in the path!) | Section separators are load-bearing lexer events, not comments to skip. |
| 5 min | Checked a piped exit code in zsh again (`node … \| tail; $?` = tail's 0) after day-01 AND day-04 logged this exact trap | Third offense. Logged lessons are not learned lessons. Pipe-free exit matrices only. |

## AI vs me
| ZCode did | I did (chose / rejected / rewrote) |
|-----------|-----------------------------------|
| Wrote the tool, the fixtures, and all 24 checks | Caught the `+++` guard bug only because I made the check assert the weird input — the guard's blind spot was the test's center of gravity, not an afterthought |
| Produced six wrong assertions across the session (a wrong net count, an escaped-pipe expectation, a fixture-mutation miscount, a stderr-vs-stdout guess, a "no FIXME" that forgot the header prints the marker list, one check that asserted the opposite of its own fixture) | Hand-counted the fixture twice and rejected the code's arithmetic twice — day-03's "wrong assertion is a bug wearing a green checkmark" reproduced six times in one day: four caught by running, two caught by hand-recounting before they ever ran green |
| First CLI wiring returned spawnSync's raw result where the injected World expects `{ok, stdout, stderr}` — `ok` always undefined, every real git call "failed" | Only the real-git end-to-end caught it; all 21 scripted-world checks passed through it. Fake worlds are well-formed by construction — the exact D02 lesson, now in local-command form |
| Suggested a `--max` debt threshold and per-author summary table | Rejected both — dashboards are a named scope cut; the ratchet needs exactly one number (net) |

*This table is the judgment evidence. If it's empty, either the build was trivial or I wasn't steering.*

## Shortcuts marked
- `ponytail:` single-file CLI, parseArgs over commander — trigger: a second subcommand or second VCS provider
- `ponytail:` summary table caps at 50 rows (console prints all) — trigger: a summary someone needs to scroll
- `ponytail:` one page of PR comments (100) searched for our marker — trigger: a PR whose report lands off page 1
- `ponytail:` marker words match in prose too (docs mention "TODO-debt indexer" → indexed) — trigger: a user needing a code-only allowlist
- `ponytail:` one blame spawn per file-with-hits — trigger: a perf report on a huge repo

## The one check
`self-check.ts` — 28 assert-based checks (24 at ship + 4 post-ship regressions): marker word-boundary table, porcelain parsing against a realistic fixture, diff state-machine traps (path-marker, `+++` content, spaced-path TAB suffix), scripted-world run() paths (trichotomy, posting, repaid-flip), and real-git end-to-end with pinned commit dates (ratchet fires on net +1, passes on repay, custom markers, staged-but-uncommitted shown honestly). `npm run check`.

## Post-ship adversarial pass (day-01 pattern)
Probed with inputs real repos contain — CRLF, no trailing newline, spaces and ünicode in paths, 100%-rename carrying debt, whitespace-only reformat, empty repo, unborn HEAD, gitlink (submodule) entries:
- **Found + fixed:** git suffixes a TAB onto `---`/`+++` header paths containing spaces (`+++ b/my file.ts\t`) — leaked into the report as `my file.ts\t:3`. Header paths now `trimEnd()`; regression check added.
- Correct-by-construction: rename → no diff content → no ratchet trip; reformat → add+remove of the same marker → net 0; gitlink → unreadable → skipped with a count, report survives; unborn HEAD → exit 2 one-liner.
- SHRINK finding: `paint()` (the day-01 TTY-color idiom) rode along in the copy and was never called — deleted. Dead idioms inherit too.

## Real-run validation
- Index on this repo, default markers: 2 items — both prose ("TODO-debt indexer" in two retros). Honest and documented.
- Index `--markers ponytail`: 53 items, 21 files, ages 3–8d — the ledger's 18 code markers plus their prose mentions, cross-checkable against `PONYTAIL-DEBT.md`.
- Drift vs `HEAD~2` (day-04's commit): net +14 → exit 1, pipe-free. The tool correctly failed the commit that added its own inspiration's debt.
- Drift vs `HEAD~1`: net 0 → exit 0. Exit matrix: drift 1 · clean 0 · bad ref 2 · usage 2 · path-missing 2.

## Post-ship validation (re-run)
Ship-day probes covered ünicode paths in the *diff*, not the *index*, and nobody tried a user's own git config. Four leaks, each reproduced in a scratch repo first, each with a regression check (24 → 28):
- **Index silently dropped paths with ünicode / tab / quote characters.** Plain `git ls-files` C-quotes them (`"\303\274n\303\257.ts"`), the read fails, and the file lands in "skipped or unblamable": 3 of 4 TODO files vanished. Now `ls-files -z`.
- **`color.diff=always` in the user's gitconfig → false green.** Every diff line arrived wrapped in ANSI codes, nothing parsed, net 0, exit 0: the worst failure a ratchet can have. The diff call now pins `--no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/` (that last pair also beats `diff.noprefix`).
- **`--markers @todo` never matched.** `\b` needs a word character on the marker's own edge, and `@` isn't one. Lookarounds `(?<!\w)…(?!\w)` keep the same semantics for TODO and fix `@todo` (JSDoc/PHPDoc's convention).
- **`--post` without `GITHUB_TOKEN` passed the fail-fast check.** The message named the token, the check never tested it: drift printed, then a 404, then exit 2. That's the half-delivered run the check exists to prevent. The API client is now built only when a token exists, so the existing guard catches it before any diffing.
- Cosmetic, fixed in passing: C-quoted diff header paths (`"b/q\"x.ts"`) are unquoted for display.
- Re-confirmed: shallow clone → exit 2; a subdirectory as root → indexes that subtree; `actions/checkout@v7` and `setup-node@v7` exist (v7.0.1 / v7.1.0); real-repo drift vs `HEAD~2` is still net +14 → exit 1.
