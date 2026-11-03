# BUILD-LOG — Day 06: loglens

> Appended in real time, not written at the end. Honest beats tidy.

## Decisions
| Time | Decision | Why |
|------|----------|-----|
| 0:05 | Exit codes follow grep: 0 matched · 1 nothing matched · 2 cannot check | The tool's pitch is "grep, smarter" — grep pipelines must swap over without changing exit-code semantics. Day-04/05's trichotomy maps onto it exactly (2 = cannot check). |
| 0:10 | Records, not lines: a line anchors by leading timestamp or level word; everything else attaches to the record above it | The multi-line stack trace is THE thing grep can't model. Anchoring is a lexical fact, continuation is the default. |
| 0:15 | Sniff votes among anchor candidates, not among all lines | Caught on the first fixture run: a JSON log whose errors carry stacks is half non-JSON lines — counting stack lines against JSON rejected the tool's own core case. |
| 0:20 | `-since 30m` counts back from the log's NEWEST timestamp, not from now | Archived incident logs: "last 30 minutes" from wall-clock now is an empty window. The resolved window prints in the footer so the anchor is never mysterious. |
| 0:25 | Footer on stderr, records on stdout | `loglens -level error app.log \| wc -l` counts records, not report noise. Pipe-cleanliness is a grep-replacement requirement. |
| 0:30 | Filters validated against the file's dimensions before dropping anything | Day-04/05 carry-over: `-level` on a file with no level words, or `-since` with no timestamps, is a cannot-check (2) with a one-line reason — never a fake empty result (1). |
| 0:40 | Go stdlib `testing` as the check runner | The protocol says "no frameworks" — in Go, `testing` IS stdlib (pytest-equivalent came with day-04's stack the same way). Plain `t.Errorf`, no testify. |
| 0:50 | `flag.ContinueOnError`, not `ExitOnError`; `-h` maps to 0 | ExitOnError calls os.Exit(2) from inside `run()` — it would kill the in-process test runner. Wiring must be testable in-process (day-02's async-check lesson, flag-package edition). |
| 1:00 | reorderArgs: hoist known flags before positionals | `loglens app.log -level error` is how grep users type; Go's flag package stops at the first positional and told them "one file at a time". |
| 1:10 | `json.Decoder.UseNumber()` for time fields | See rabbit holes: float64 cannot hold a ns-precision epoch. Numbers stay `json.Number`, int64 path is exact. |
| 1:15 | Collapse fingerprint = level + message + continuations, joined on NUL | `["a b"]` and `["a","b"]` join identically on a space — a space separator would merge two different records. Consecutive-only: the same crash at a different time keeps its place. |

## Rabbit holes
| Time lost | What happened | Lesson |
|-----------|---------------|--------|
| 15 min | The generated source shipped a **raw NUL byte** inside a string literal (the `\x00` Join separator was written as the byte, not the escape) — `go vet: illegal character NUL`, plus one em dash mangled into a replacement character | Byte-level escapes in generated code need `gofmt`/`go vet` before anything else runs; the fix is a byte-safe perl pass, not a rewrite. The compiler caught what both eyes skipped. |
| 20 min | First sniff required a majority of ALL lines → the JSON fixture (12 JSON lines, 13 stack/junk lines) detected as `plain-inert` with zero records | The test fixture IS the spec: the tool's core case (stack traces after JSON errors) broke its own format detection. Vote among candidates. |
| 25 min | Plain-format trivia, three rounds: python's comma milliseconds (`10:00:02,001`) split the time token so the level never matched; log4j's `[timestamp]` brackets didn't anchor; a leading space after timestamp stripping defeated the level regex | Real-format-first (day-05's rule): python logging, log4j and logfmt are what actual logs look like — the fixture tour found all three in one pass. |
| 10 min | Epoch nanos came back ...456768 instead of ...456789 — float64 rounds at ~16 significant digits; a 19-digit ns epoch can't survive `json.Unmarshal` into `any` | The CHECK caught it (asserted the exact nanoseconds). Exactness needs `json.Number` + `ParseInt`. Day-05's wrong-assertion lesson, inverted: this time the assertion was right and the code was wrong. |
| 5 min | Two of my own assertions contradicted my own documented design (asserted syslog lines stay timeless — the code intentionally anchors them at year 0; asserted a mid-line level word anchors — prose safety says it must not) | Day-05 reproduced ×2 on day 6: checks are reviewed by execution against the DECISIONS, and the decisions live in the brief and the ponytail comments, not in memory. |

## AI vs me
| ZCode did | I did (chose / rejected / rewrote) |
|-----------|-----------------------------------|
| Wrote the tool, fixtures, and all 19 checks; drafted the reorder/UseNumber fixes after the fixtures and the check run exposed the gaps | Chose the grep exit-code contract and the newest-timestamp window anchor in the brief, before code — the two decisions that make it a drop-in rather than a new convention |
| Shipped the raw-NUL string literal into the source on the first write | Caught it only because `go vet` runs before every test pass; made "vet before anything" the mechanical rule for the day |
| Produced two assertions that contradicted the brief's own documented ceilings | Rejected both after the failing run named the contradiction — the fix was to the check, not the code |
| Suggested `-since_end` as the window-top flag | Rejected — the brief promised `-until`; flag names are contracts written before code |

*This table is the judgment evidence. If it's empty, either the build was trivial or I wasn't steering.*

## Shortcuts marked
- `ponytail:` single-file CLI, stdlib only, whole-file in memory — trigger: logs too big for RAM (two-pass then)
- `ponytail:` syslog year-less timestamps keep year 0 — trigger: an absolute-window user with mixed syslog
- `ponytail:` collapse fingerprint is exact text, no id/number normalization — trigger: a user asking for fuzzy grouping
- `ponytail:` stack dumps capped at 10 continuation lines — trigger: a user who needs the full 200-line trace
- `ponytail:` reorderArgs' arity map lists flags by hand — trigger: a second flag day
- `ponytail:` npm's counter-prefixed levels unrecognized (file reads as plain-inert) — trigger: someone asking for npm logs

## The one check
`loglens_test.go` — 19 stdlib-`testing` tests: parser tables (timestamps incl. zones/commas/ns-epochs, syslog+python numeric levels, JSON/apache/plain shapes), sniff+parse against the three fixtures, filter drop-accounting, collapse (incl. the space-join collision regression), `run()` exit trichotomy in-process, and a subprocess matrix on the real binary (exit codes, stdin, footer-on-stderr). `go test`.

## Real-run validation
- npm debug logs (`~/.npm/_logs`): read honestly as plain-inert — no fake levels invented; the collapse caught real ×2 duplicates from two interleaved npm-exec sessions in one file.
- `/var/log/install.log`, 10.6 MB of real macOS log: 42,622 records in 0.42s; `-since 24h` window resolved against the file's real +10:30 zone; `-level` correctly refused as cannot-check (that log carries no levels).
- 200k-line synthetic JSON flood (5,000 identical crashes with stacks): all 5,000 collapse to one group, 3 lines of stdout, 0.38s.
- Exit matrix, pipe-free: match 0 · no-match 1 · missing file 2 · unknown level 2 · bad -since 2 · unknown flag 2 · help 0 · empty stdin 1.

## Post-ship adversarial pass (day-01 pattern, fresh-context reviewer)
A second ZCode agent with no author bias attacked the shipped binary in a scratch dir, every finding reproduced twice: **11 findings, 0 crashes, exit trichotomy held on every single run** (all the 2s were the *message* being wrong, never the class). Ten fixed, each with a regression check (19 → 29 tests); one kept as a documented ceiling.

Fixed — the five wrong-result class first:
- **F1** `-level=error` after the file: `reorderArgs` looked up `"level=error"` in its arity map, missed, and the flag became a second positional — "one file at a time", exit 2. The flag-hoister defeated itself on the exact syntax Go's own flag docs show. Fix: name split on `=`.
- **F2** `+0530` zones (Python `%z`, Java `Z`, ISO basic) matched the time regex but no layout, so *every line in a file* went inert and `-level`/`-since` became cannot-checks. Fix: retry with the zone colonized; apache's own `-0700` parses on the first pass, untouched.
- **F3** a 1-line JSON log (the `tail -n 1 | loglens -` workflow) failed the `j > 1` sniff guard, and the sniffer was BOM-blind (parseLines strips the BOM; sniff voted on the raw line). Fix: only *log-shaped* JSON lines vote (must carry time or level — `{"a":1}` blobs can't capture plain files), `j*2 >= seen || j >= 2`, BOM stripped in the sniff too.
- **F4** mixed JSON+plain files: a plain ERROR line between JSON records glued onto the JSON record above it, and died with it under any filter — absent from output *and* from every footer stat. Fix: a line the primary format rejects retries as a plain anchor before becoming a continuation.
- **F5** stringified epochs (`"ts":"1793750400"`, Bunyan lineage) were invisible — `parseEpoch` only ran for JSON numbers. Fix: string time keys try layout, then epoch digits.
- **F6** an escaped `\n` inside a JSON msg printed a bare phantom stdout line. Fix: display escapes newlines.
- **F7** byte-sliced truncation could cut a multi-byte rune in half — invalid UTF-8 on stdout. Fix: rune-safe trunc.
- **F9** `?level=debug` inside a URL self-anchored a continuation line as a DEBUG record. Fix: `level=` counts only at start or after whitespace.
- **F10** 5-field short CLF lines (no bytes column) demoted whole access logs to plain-inert. Fix: bytes field optional.
- **F11** docker json-file lines carry the message under `"log"` — now in the msg keys (`{"log":"boom\n","stream":"stderr",…}` parses; the newline is real message data).
- Trivia in passing: `/dev/null` stdin message no longer claims "terminal"; `-level 3` (numeric syslog severity) now accepted at the flag like the parsers accept it.

Kept as documented ceiling:
- **F8** two consecutive records differing only past char 160 render as identical truncated lines with no `×N` — the fingerprint is exact by design, the display truncates; grep the shown line number for the full record. Plus apache requests with escaped quotes stay continuations (new `ponytail:` marker, ledger 29 → 30).

Verified-correct highlights from the same pass (the list that ships the tool): exit trichotomy on every run; CRLF, BOM, NUL, a `/dev/urandom` file, a 10MB single line, no-trailing-newline; ns through 1,2,4,5,7-digit fractions; exact window math in +05:30 and −0700 zones incl. newest-at-top anchoring; dup-keys last-wins, emoji, unicode escapes; `×N` ranges in the record's own zone; 15-line stack capped at 10 with the `+5 more` note; color only on TTY with `NO_COLOR` respected; footer always on stderr.

## Validation pass 2 (2026-11-04, fresh-context re-check)
Re-ran everything from a clean checkout: `gofmt`/`go vet` clean, 29/29 green, README sample outputs byte-identical to a fresh build, ledger count (30, 7 day-06) consistent. Then a second adversarial probe: **4 wrong-result findings, all fixed with a regression check (29 → 33 tests)**, README output still byte-identical.
- **V1** numeric JSON levels read on python's 10-50 ladder — but pino/bunyan are the encoders that actually emit `"level":50` by default (python's JSON formatters emit `levelname` strings). A pino log under `-level error` showed the *warn* (40) as ERROR, hid the real error (50) as FATAL, and dropped fatal (60) as level-less — exit 0. Fix: pino ladder 10 trace … 60 fatal. Fixture `app.jsonl` line 17 `lvl:40` → `lvl:50` (it was written as an error).
- **V2** float epochs were always seconds — zap's `EpochMillisTimeEncoder` (`1793750400123.456`) landed in year 58811 and `-since` resolved a nonsense window. Fix: floats take the same s/ms/µs/ns magnitude ladder as ints.
- **V3** a 1-line access log (`tail -n 1 access.log | loglens -`) failed apache's `a > 1` guard → plain-inert → `-level` cannot-check. F3's fix was applied to JSON only. Fix: apache takes the same share rule.
- **V4** a duplicate whose repeat carries no timestamp printed `×2 (… 00:00:00)`. Fix: only timed repeats move the range end.
- Housekeeping: the local `loglens` binary was built *before* the post-ship fixes (F1/F2 reproduced on it); rebuilt. README no longer calls it "static" — on macOS Go links libSystem dynamically.
- Not fixed, honest exit 2 (format gaps, not wrong results): nginx `error.log` (`2026/11/04 … [error]` — slash dates, lowercase bracketed level) and klog (`E1104 10:00:00.123456 …`, every Kubernetes component) both read as plain-inert.

