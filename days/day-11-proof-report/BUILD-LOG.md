# BUILD-LOG — Day 11: proof-report

> Written DURING the build. Decisions, rabbit holes, AI vs me.

## Pre-build (SCOPE)

- **Decision — the extraction is the first deliverable.** Day 08's brief deferred `packages/git-digest` to "day-11, the named first importer." Today: extract day-08's parsing core verbatim → `packages/git-digest/`, rewire day-08 onto it, and day-08's existing 41-check suite (byte-precise, unchanged) is the extraction's proof. The ideas card's "40 minutes because Day 08 extracted a package" gets the honest correction: Day 08 *seeded and named*; today pays the extraction hour, the reporter is the 40 minutes after, and the NEXT git tool starts at 40.
- **Decision — proof by old checks, not new ones.** No separate package self-check: day-08's 41 checks + day-11's checks both exercise the package through real imports. A third suite would re-assert what two already pin (ponytail: no redundant suites).
- **Decision — new porcelain stays local.** Hash + numstat is a DIFFERENT record shape (5 fields + indented stat block, blank-line-terminated). It lives in day-11 until a second importer exists; the package is a verbatim extraction, zero new behavior, so day-08's checks prove it byte-for-byte. Promote on the second importer.
- **Decision — no LLM pass.** Day 08 polishes a *draft*; day 11 prints *receipts*. Generated prose would weaken the one property the tool exists for (verifiability). Also the scope line that keeps this from being standup-prep-with-hashes.
- **Empirical probe before parser design:** `git log --pretty=format:%x00… --numstat` → record = `\0` + `\x1f`-joined header line + numstat lines + **blank line** before the next record; binary = `-  -  path`; exotic paths get C-quoted but keep the 3-tab-field shape (escaped `\t` inside quotes is two chars, not a tab). Parser can stay strict-shape-or-inert.
- **Evidence check:** Reddit bot wall blocked re-fetch (D04/D08 precedent) — brief cites the ideas doc's 2026-10-24 verified record, noted honestly.

## BUILD

### Phase A — the extraction (`packages/git-digest`)

- **What moved verbatim:** `parseLog` (+ FIELD/LOG_FORMAT/MAX_FETCH), `subjectArea`/`cleanSubject`, `clip`/`sanitize`, `parseSince`/`windowStart`, the local-time formatters (`localDate`/`localHM`), types (`GitResult`, `World`, `Commit`).
- **What was lifted out of day-08's `run()` into named functions** (mechanical, behavior pinned by day-08's checks): `probeRepo` (truthful refusal: git-missing ≠ not-a-repo ≠ bare), `readIdentity` + `filterMine` (two-pass email-authoritative identity), `windowFilter` (author-date window in JS + future-dated excluded-and-counted), `makeGit` (spawn adapter with spawn-failed marking), `envClock` (pinned-clock knob, env name now a parameter).
- **AI vs me:** ZCode proposed the package API and did the mechanical move; I decided the boundary — `World` in the package is git/now/log ONLY (no `llm` — a git kernel that knows about LLMs is the wrong dependency direction), day-08 extends it locally: `type World = GitWorld & { llm?… }`. One wording change: the bare-repo refusal said "standups are drafted from a checkout" — package-neutral "digests are drafted from a checkout" (day-08's F6 check asserts `bare repository`, not the tail; verified).
- **Proof:** day-08's self-check re-run after the rewire — **41/41 green, zero assertion edits**. The extraction deleted ~120 lines from a shipped day and its byte-precise suite couldn't tell.

### Phase B — proof-report (the 40 minutes)

- **One renderer, Markdown only.** No `--md` flag: the report's entire purpose is pasting somewhere a boss/team can read. Terminal markdown reads fine.
- **Receipts are verbatim.** Day 08 strips the grouping token for a spoken draft; day 11 keeps subjects RAW (sanitized, clipped at 100) — a receipt that's been edited is a weaker receipt. Hash prefix 7 chars (GitHub convention, `git show`-resolvable).
- **Stats from numstat, summed per in-window commit:** +I/−D (binary `-` lines count the file, contribute 0 lines), unique paths = files touched, `.md`-suffixed unique paths = docs count, tickets = global `[A-Z][A-Z0-9]{1,9}-\d+` scan (≠ package's leading-token TICKET match — harvesting finds `fix: AUTH-12 thing` too), areas = package `subjectArea` tally with unlabeled bucket.
- **The span line discipline:** "landed 09:41 → 18:42" = first→last commit timestamp, labeled `landed` — never hours, never "active". The tool answering presence-surveillance must not smuggle presence back in as a span-of-hours claim.
- **AI vs me:** ZCode wrote the first renderer draft with grouped-by-area sections (day-08 muscle memory); I rejected grouping — receipts list newest-first, areas collapse to one tally line. A proof document with collapsed entries proves less.
- **Rabbit hole (10 min):** assumed numstat blocks end with a blank line *always* — the LAST record's trailing newline differs (file ends without the blank). Parser treats blank lines as record-internal noise (strict `^\d+|-` shape or inert line), so both endings parse; the hand-count fixture includes a no-trailing-blank record on purpose.

### Phase C — the check suite (where the day's real lessons were)

- **The fixture-builder trap bit FIVE times, one face new:** hashes `g`/`h`/`z` (non-hex) and `"f0".repeat(40)`/`"f9".repeat(40)` (80 chars — repeat is ×40 of a TWO-char string) silently became "inert" records that rewrote my hand-counts. Day-05's rule now has a hash-shaped corollary: the builder VALIDATES its own output — `H40()` refuses any input but one hex char, loudly. After hardening, two more latent occurrences (`x`, `s`) failed at build time instead of lying in a count.
- **The tool was right, my expectations were wrong, three times:** (a) hand-count note listed 7 paths then said "= 6"; (b) `- \`` is 3 chars, I asserted 2 (113 vs 112); (c) bare `chore:` has no scope → unlabeled (the package's own subjectArea rule — I expected `chore ×1`), and the `side:` test commit was authored by dev@test too, so `--me` honestly returned 2, not 1. D09's rule holds: re-derive expectations from the independent source, and when tool and count disagree, FIRST recount.
- **TZ discipline caught a real assertion smell:** I pinned the header's local DATE of `15:00Z` in-process — the machine runs UTC+10:30 (Lord Howe offsets!), where that's tomorrow. Exact-time assertions now live only in the CLI check under forced `TZ=UTC` (D08's rule).
- **Zero-commit repos are exit 2, not exit 1** (git log itself fails: "does not have any commits yet") — no history AT ALL is "cannot check"; exit 1 stays reserved for an empty window OF existing history. Same call day-08 shipped; now it's pinned by a check.
- **Both suites × 4 timezones (UTC, Kolkata, LA, UTC+14): 66/66 green** (25 day-11 + 41 day-08 through the package).
- **Real-world validation:** this repo's full window — 27 receipts, hand-verified stats against an INDEPENDENT awk re-computation over the same numstat stream: **+15121 −143 · 142 files · 47 docs · 27 commits, exact match**. Byte-identical across two pinned-clock runs (determinism). Exit matrix re-verified pipe-free (my first shell check read `head`'s exit code, not the tool's — D01's pipe rule exists for a reason).

## SHRINK (ponytail-review on the diff)

- `proof-report.ts harvestTickets: shrink: while/re.exec loop → for..of subject.matchAll(re)` — applied, −1 line, both suites re-green (25 + 41).
- Everything else walked with the deletion lens: imports all used in every changed file (checked against each import list); every package function has two importers (day-08 + day-11) or is an internal helper of one that does; no dead flags, no config nobody sets, no single-implementation abstractions (the package is the extraction day-08 promised, not a speculative layer — its second importer shipped in the same diff).
- `net: −1 line. Lean already. Ship.`

## ADVERSARIAL (fresh-context agent, every finding reproduced twice by execution)

**9 findings: 1 wrong-result, 1 wrong-reason, 3 cosmetic, 4 test-gaps — all 5 code findings fixed, all 4 gaps pinned. Suite 25 → 36 checks; day-08's 41 still green through the package.**

- **F1 (wrong-result, REAL): git C-quotes non-ASCII/special paths** (`café.md` → `"caf\303\251.md"`) — quoted `.md` files missed the docs count; every ASCII fixture was blind to it (like the agent's first real repo, `文献.md` + `README.md` → "1 doc"). Fix: `dequotePath` (git's `\\ \" \a \b \f \n \r \t \v \NNN` escape forms → bytes → UTF-8, non-fatal) at the parse seam; pinned by fixture AND real-git non-ASCII filename checks.
- **F2 (wrong-reason): nonexistent root said "not a git repository"** — git's truth is `fatal: cannot change to '<path>'`. Fixed in the PACKAGE's `probeRepo` (inherited from day-08, whose suite never pinned this text — day-08 gains the truer reason too). Ponytail-marked: matched on git's stderr wording; a reworded git falls back safely.
- **F3 (cosmetic): email-only identity with zero matches** printed "no commits" with no `by <email>` — the header hid which filter ran. Fixed in the package's `filterMine` (`identity: id.name ?? id.email`).
- **F4 (cosmetic): `landed A → A`** when all commits share a timestamp — collapsed; sub-minute spans stay (minute precision, ponytail-marked).
- **F5 (cosmetic): always-plural `**tickets:**`** — now singular/plural like every other count.
- **F6–F9 (test-gaps, pinned):** quoted-path fixtures (+ rename/escaped-tab shapes), a run-twice determinism check, inert-record stats exclusion end-to-end, the UTC−12 local-midnight boundary both sides, ESC-in-subject end-to-end.
- **AI vs me:** the adversarial agent earned its tokens on F1 — my ASCII-only fixture imagination would have shipped the docs-count miss forever; the agent found it in ~9 minutes by creating repos with real non-ASCII filenames. My contribution was refusing to hand-wave the fix: decode at the parse seam (one place), not a suffix special-case in `tally` (two places, and the stored path stays a lie).
- Agent also diffed every extracted package function against the pre-extraction day-08 source at `f0ceb75`: only `export` keywords added — the extraction is behavior-preserving by inspection, not just by suite.

