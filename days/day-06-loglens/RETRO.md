# RETRO — Day 06: loglens

> No retro, no post. The post is a byproduct of the work.

## What I learned
- **Technical (Go, day one):** the language hands you three silent traps in exactly the places a log parser lives. `json.Unmarshal` into `any` makes every number a float64 — a 19-digit nanosecond epoch comes back with its last digits *confidently wrong* (...456768, not ...456789); `json.Decoder.UseNumber()` + `ParseInt` is the exact path. The `flag` package stops parsing at the first positional — "flags first" is a Go convention the whole world outside Go doesn't share, so a grep-replacement CLI needs a hoister. And `flag.ExitOnError` calls `os.Exit` from inside `run()`, which kills an in-process test runner — `ContinueOnError` + `ErrHelp → 0` keeps the wiring testable.
- **Technical 2 (detection):** a format sniffer must decide who gets a *vote*, not just who wins. Stack-trace lines are continuations in every format, so counting them against JSON rejected the tool's core case; but a bare `{"a":1}` blob can't be allowed to capture a plain file either. The rule that holds both: only *log-shaped* lines vote (time or level present), continuations never vote, and one log-shaped line is enough (`tail -n 1 | loglens -`) while non-log blobs are not. Same shape as day-05's header-vs-content lesson: position and role decide, not prefixes.
- **Meta:** the adversarial reviewer out-earned its cost by an order of magnitude — 11 real findings in ~9 minutes (flag `=` syntax, `+0530` zones, one-line sniff, mixed-file swallowing, stringified epochs, `\n` in msgs, mid-rune truncation, `?level=` in URLs, short CLF, docker's `log` key), every one of them *real-world format trivia my 19 tests and my real runs both missed*. My fixtures were built from formats I knew; the world's logs are written by encoders I've never read. Sixth consecutive day the post-ship pass pays; the adversarial agent is now a series standard, not a step.
- **Meta 2:** I wrote the *same invisible-byte bug twice in one session* — a raw NUL in a string literal at build time, then a raw BOM in the sniffer fix (while fixing BOM handling!). Generated source needs `go vet` before anything else runs; invisible bytes are this stack's trailing-whitespace. And the wrong-assertion lesson ran in BOTH directions in one day: the epoch check was right while the code was wrong (float64), and two other checks were wrong while the code was right (my own documented ceilings). Execution adjudicates both directions; the documentation is the tiebreaker.

## Reusable artifact
The parser pair at the heart: `parseTimeStamp` (layout ladder + colon-normalizing retry for Python `%z`/Java `Z` zones) + `parseEpoch` (string-in, int64-exact, s/ms/µs/ns heuristics), plus the sniff-share rule and the plain-anchor fallback for mixed files. Day 29's rebuild candidate if loglens draws demand. Also carried: `reorderArgs` (flag hoisting) and the ContinueOnError testable-wiring idiom — every future Go CLI day starts with these two.

## Ponytail debt created
Seven markers (see BUILD-LOG): in-memory whole-file, syslog year-0, exact-text collapse fingerprint, 10-line stack cap, hand-listed flag arity map, npm counter-prefixed levels, escaped-quote apache requests. All low-severity with named triggers. Ledger updated (23 → 30).

## Numbers
- Time spent: ~3h (🔵 build-day box)
- Token spend (est.): ~1.9M total — ≈350k brief+build+checks+docs, ~1.5M the adversarial reviewer. The validator out-spent the builder ~4:1 and it was worth every token: 11 findings for the price of one fresh pair of eyes.
- Self-check passing: yes — 29/29 (19 at ship + 10 post-ship regressions); exit matrix pipe-free: match 0 · no-match 1 · missing/bad-level/bad-since/unknown-flag 2 · help 0; real runs: npm logs (honest plain-inert), 10.6 MB install.log → 42,622 records in 0.42s with a +10:30-zone window, 200k-line flood → 5,000 crashes collapsed to 1 group

## Tomorrow
Day 07 (viewport-wall, 🟢 light day + weekly carousel): React + Vite device-grid with synchronized scroll. Carry-overs: the "vote among candidates that can vote" rule (applies to which viewports render vs error), and Sunday's weekly extras — `/ponytail-audit` over six shipped tools, ledger regeneration (now 30 markers), metrics update.

## Honest failures
- The raw-NUL and raw-BOM source corruption, twice, one session — and the second instance was inside the fix for the first one's *cousin*. `go vet` before anything else runs is now mechanical, not optional.
- Two checks asserted the opposite of my own documented design (syslog year-0, mid-line level words). Day-05's retro warned exactly this; knowing the failure mode did not prevent two fresh examples. Checks are reviewed against the WRITTEN decisions.
- The brief's "floor" listed JSON-only filters; the formats that actually broke the tool (docker json-file, Bunyan string-epochs, Python `%z`) are all *named, documented formats* a better brief would have listed on day one. Fixture-first design narrows the field of vision; the adversarial pass is the corrective.
