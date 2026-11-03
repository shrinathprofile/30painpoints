# RETRO — Day 05: todo-debt

> No retro, no post. The post is a byproduct of the work.

## What I learned
- **Technical:** header-vs-content in a diff is a POSITION fact, not a prefix fact. My first parser blacklisted `+++`-prefixed lines to skip file headers — and thereby rejected real content lines that start `++`. The fix is a lexer state machine: `--- a/x`/`+++ b/x` are headers only *outside* hunks, `+x`/`-x` are content only *inside*, and `diff --git` is a section boundary that resets the state — without which a following file's `--- a/TODO.ts` header line becomes "removed content" and a PATH false-fires as debt. Same shape as day-04's BOM lesson: real-world input trivia, crash-tested only against the real provider.
- **Technical 2:** the seam between the fake world and the real one is where bugs live. The CLI wiring handed spawnSync's raw result to a World that expects `{ok, stdout, stderr}` — `ok` was always undefined, every real git call "failed", and **21 scripted-world checks passed straight through it**. Fakes are well-formed by construction; only the real-git end-to-end crossed the seam. Fifth consecutive day of the same lesson (npm bin link, GitHub sort, mDNSResponder, import-crash-as-drift, now this): the real run IS the test suite's final member.
- **Meta:** six wrong assertions in one day — four caught by running, two by hand-recounting before they ever ran green — the code was right and its own tests were wrong (a hand-miscounted fixture, an escaped-pipe expectation, a stderr-vs-stdout guess, a "no FIXME" that forgot the header prints the marker list, a fixture mutation that dropped the sections it claimed to keep, one check asserting the opposite of its own fixture). Day-03's retro warned exactly this; knowing the failure mode didn't prevent producing six fresh examples. Checks get reviewed by EXECUTION, and fixtures get hand-counted, twice.
- **Meta 2 (process, kept):** the dogfood run is the demo. The tool's README screenshot is its own repo's ledger — day-04's commit failing the ratchet with net +14 `ponytail:` markers is the whole pitch in one terminal capture, and it cost nothing to produce because the validation was already the evidence.

## Reusable artifact
The parser pair: `parseDiff` (~30 lines, the hunk state machine with TAB-suffix and path-marker guards) + `parseBlame` (porcelain → line → {author, epoch}). Day-08 (standup-prep) and Day-11 (git-digest) both read git for a living — they inherit these two functions and the World adapter seam, which now has a regression check guarding its shape. Also carried: the exit-trichotomy + fail-fast flag-validation combo, two days old and already a series standard.

## Ponytail debt created
Five markers (see BUILD-LOG): parseArgs ceiling, 50-row summary cap, one page of PR comments, prose-mention indexing, per-file blame spawns. All low-severity with named triggers. Ledger updated (18 → 23).

## Numbers
- Time spent: ~2h 15m (light-day box, stretched by the adversarial pass — well spent)
- Token spend (est.): ~140k across brief + build + validation + docs + post
- Self-check passing: yes — 24/24 (23 at first green, +1 TAB-suffix regression from the adversarial pass); real-run matrix: index 53 items exit 0, drift net +14 exit 1, net 0 exit 0, bad ref / usage / path exit 2, all pipe-free

## Tomorrow
Day 06 (loglens, 🔵 build day): first Go on a deadline. Carry-overs: the real-format-first rule (JSON logs before cleverness, like asking git for the diff), and the "cannot check ≠ empty result" trichotomy — a malformed log line is a counted skip, not a silent drop and not a crash.

## Honest failures
- The zsh piped-exit-code trap, third offense, after day-01 and day-04 both logged it. The fix is mechanical: exit matrices run pipe-free, always.
- The spawnSync/World seam bug shipped green through 13 checks — the scripted world was a mirror that only reflected well-formed git. Every injected-world day after this adds one real-provider end-to-end, no exceptions.
- My `--post` fail-fast validation was originally AFTER the drift report — a misconfigured action would have printed "drift found, exit 1" and THEN died with exit 2. Caught by reading the flow, not by any test; some ordering bugs are review-shaped.
- The first version of the path-marker regression check asserted the opposite of its own fixture (the removed line really did contain the word TODO). Rewritten before it ever ran green — the temptation to write the assertion that flatters the fix is the check-authoring failure mode in its purest form.
