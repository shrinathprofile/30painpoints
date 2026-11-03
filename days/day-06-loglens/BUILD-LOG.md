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
