# BUILD-LOG — Day 08: standup-prep

> Appended in real time, not written at the end. Honest beats tidy.

## Decisions
| Time | Decision | Why |
|------|----------|-----|
| 0:00 | `simple-git` rejected; raw `git` spawn via day-05 World adapter | plan never outranks the ladder (D01); zero deps, idiom already in repo |
| 0:00 | `packages/git-digest` extraction stays with day-11 | D08 parses `git log` porcelain — a different shape from D05's diff/blame; D11 is the named first importer (D03 copy-idiom rule) |
| 0:00 | "area" grouping = the subject's own leading token (conventional scope / ticket key / `day-NN:` prefix), not file lists | zero extra git spawns, one parser path; `--name-only` file grouping drags in quote/tab path trivia (D05) for marginal value |

## Rabbit holes
| Time lost | What happened | Lesson |
|-----------|---------------|--------|
| ~10m | probe of the shipped format caught a live parser bug BEFORE any check existed: `--pretty=format:` separates records with `\n` (terminates only *between* records), so every `\0`-split chunk but the last carried a trailing newline that would land in the subject field; fixed by stripping one trailing `\n` per chunk (`%s` itself can never contain one — exact, not heuristic) | D07's probe-the-primitive rule pays for itself: od the actual bytes before parsing them |
| ~5m | `parseSince` hand-rolled date parse silently rolled `2026-13-40` → Feb 2027 via JS Date rollover; hardened with get-back-verification | trust-boundary flags validate the calendar, not just isNaN |

## AI vs me
| ZCode did | I did (chose / rejected / rewrote) |
|-----------|-----------------------------------|
| wrote IDEA-BRIEF from the ideas card + series learnings | approved scope, flagged simple-git override before code |
| probed git format bytes, wrote the tool | rejected `--since` passthrough to git (committer-date vs author-date seam); JS owns the window on `%at` |
| | cut `%b` (commit bodies) entirely — subjects are the standup's raw material; bodies cost tokens for marginal value |
| | chose recency-first bullet order over chronological (D02's "make the ordering explicit" — git's newest-first was inherited, not chosen; a 30-second update leads with the freshest work) |
| | pinned-clock knob STANDUP_PREP_FAKE_NOW approved as a demo/repro feature (README byte-identity rule needs it — time-dependent output) |
| | |

*This table is the judgment evidence. If it's empty, either the build was trivial or I wasn't steering.*

## The one check (Rung 1 — executed green: 28 checks)
`node self-check.ts` — assert-based, no framework, fixed clock. Covers: parser (hand-counted 6/2, separator-newline strip), area/clean rules per real-world subject shape, rune-boundary clip, control-char display, local-midnight windows, rollover rejection, exit matrix on scripted worlds (2/1/2 paths), --me identity matching incl. the name-match path, grouping, cap note, all four --llm paths, CLI subprocess edges, and TWO real-git end-to-end repos with pinned dates.

**Caught by execution (the rung earns its keep):**
1. **Unit seam bug (real tool bug):** `parseLog` keeps git's `%at` in epoch SECONDS; `windowStart().getTime()` is MILLISECONDS — `c.ts >= startTs` compared seconds to ms. Every real run would have exited 1 on every repo. All earlier fake checks passed because they expected empty windows. Fix: `c.ts * 1000 >= startTs`.
2. **Identity-header leak (real tool bug):** `--me` header printed the config email even when the rebase-rewritten emails matched nothing and the NAME did the filtering — the draft claimed commits "by" an identity that wrote none. Fix: header names the identity that actually matched.
3. **Lying fixture (my check, not the tool):** the "malformed 4-field" record was built with `rec(..., undefined)` — Array.join turns undefined into an empty 5th field WITH its separator, producing a valid empty-subject record. The tool parsed it correctly; the hand-count was wrong. Fixture rebuilt raw. The exact D05 failure mode, reproduced and caught by execution.

## Rung 2 — real-run validation (≥2 real sources, pipe-free exit matrix)
- **linkedin30 (source 1, dogfood):** `--days 2` → 9 commits, grouped day-07 (4) / day-06 (3) / day-05 (2) — hand-verified against raw `git log --since` (9/9 exact). `--days 1 --me` → 7 commits by the noreply identity, count cross-checked against the unfiltered run.
- **career-ops (source 2, 413 real commits):** `--since 2026-04-01` → full history parsed, 70+ area groups, zero crashes; real-world subject shapes absorbed: PR refs `(#1243)`, parenthesized doubles `(#1175) (#1176)`, CJK/Ukrainian/Diacritics, `feat!/`-style, `Update README.md`, `10 bug fixes — …`. Cap note correctly absent (413 < 1000).
- **zcode-30 (source 3):** 2 commits parsed ✓.
- **Stale repos (career-ops/third default windows):** honest exit 1 naming window + merge rule — correct answers, not wrong ones.
- **Exit matrix, pipe-free (D01/D04):** 0 (three repos) · 1 (stale window) · 2 (not-a-repo `/tmp`, `--days 60`, `--llm` without key) — every documented code hit directly, no pipes in the way.
- **LLM real-network call:** cannot-check honestly — no key in env (session harness tokens are not for product use). Fake-LLM paths all covered in Rung 1; the CLI no-key fail-fast is real-env verified. A real smoke needs the user to supply a key (flagged at close).

## Self-review catch #3 (during the adversarial wait — grep-level re-read of my own flow)
**--since bypassed its own parser (real wrong-result bug):** `run()` re-parsed `--since` with raw `new Date(opts.since)` — UTC midnight, not the documented LOCAL midnight, the exact trap `parseSince` exists for. My own gap test had swallowed it: the 24h TZ margins made the 5.5h IST shift invisible. Fixed: `run()` routes through the shared parser (seam re-checks what main pre-validated). New deterministic regression: commit at 2026-11-02T18:00Z under `TZ=UTC+14` is local-date 11-03 but pre-UTC-midnight — a UTC parse would exit 1; local parse includes it. 29 checks green.

**Shrink candidates noted for Phase 3** (applied after adversarial findings land): `Commit.hash` parsed but never printed/used anywhere → cut `%H` from the format; `LOG_FORMAT` exported but never imported → un-export.

## Rung 3 — fresh-context adversarial pass (13 findings, each reproduced twice, ~90 CLI probes + parser suite + TZ matrix)
Findings list verbatim-in-spirit; fix order mandatory wrong-result first. F1 had already been fixed by self-review catch #3 (the agent tested the pre-fix scratch copy) — closed by re-running the agent's exact Kolkata repro against the live file.

| # | Class | Finding | Fix (all shipped with a regression check) |
|---|-------|---------|-------------------------------------------|
| F1 | wrong-result HIGH | `--since` date-only = UTC midnight, not local; commits ON the date silently dropped, tool says "no commits" | fixed pre-report (catch #3); agent's repro now a named regression (TZ=Asia/Kolkata 03:00 commit → in) |
| F2 | wrong-result HIGH | all-inert window exits 1 claiming "no commits"; the inert note printed only after the exit-1 return | fetch notes moved BEFORE any verdict |
| F3 | wrong-result MED | `--me` name-match absorbed a same-name/different-email stranger; header claimed them "by me@x" | two-pass identity: email authoritative when it matches anything; name only when email matches nothing; header names the pass that ran |
| F4 | wrong-result LOW-MED | no upper window bound — future-dated commits counted inside a header claiming "→ now" (FAKE_NOW=0: 1969 window with 2026 commits) | future-dated excluded AND counted, note printed; the header now honors its own claim |
| F5 | wrong-result LOW-MED | cap note keyed off parsed count, not fetched — 1001-commit repo with an inert record suppressed the note | note counts parsed + inert = fetched |
| F6 | wrong-reason LOW | bare repo refused as "not a git repository" (it IS one) | `--is-bare-repository` probe → truthful bare message |
| F7 | wrong-reason LOW | missing git binary conflated with "not a repository" (spawnSync ENOENT) | spawn errors marked "spawn failed — ENOENT"; refusal names git unavailability |
| F8 | wrong-reason LOW | garbage-but-numeric FAKE_NOW → Invalid clock → NaN window label + exit 1 lie | knob value must yield a valid Date or falls back to the real clock (same as non-digit garbage) |
| F9 | cosmetic/trust | LLM tone-pass output printed RAW — a hostile endpoint can repaint the terminal (ANSI/CR/BEL) | LLM output goes through the same sanitize as commit subjects |
| F10 | cosmetic | clip-after-sanitize could cut an escape mid-sequence | died structurally: sanitize now emits single-rune control PICTURES (U+2400 block) — nothing to cut |
| F11 | cosmetic | literal "\u0007" text rendered identically to an escaped real BEL | pictures vs typed text are now visually distinct (␇ ≠ `\u0007`) |
| F12 | cosmetic | swallowed token ("feat(scope):") rendered "(no message)" — the commit HAD a message | headline falls back to the whole subject before "(no message)" |
| F13 | cosmetic | raw CR passed sanitize into the draft (terminal rewrites the line) | CR in the escape range → ␍ picture |

**Sibling grep after fixes:** sanitize is the single implementation behind the draft, the LLM prompt subjects/bullets, and the polished output — no unsanitized output path remains. **Explicit no-finding categories (agent):** CLI flag surface (~22 probes), path surface (symlinks, worktrees, detached HEAD, plain files), window edge semantics (midnight boundary `>=`, header/filter agreement), merge handling, parseLog inertness discipline, subjectArea matrix (26 shapes), parseSince rollovers, --llm failure paths (refused/timeout-15s/non-JSON all exit 2 honestly, base draft intact).

Post-fix re-smoke: linkedin30 9 commits ✓, career-ops 413 ✓ exit 0, pinned-clock rerun ✓ (the one "exit 1 mystery" was my own shell cwd drifting into the day folder — MODULE_NOT_FOUND from a doubled relative path, not the tool).

## Rung 4 — pass-2 fresh re-verify
Fresh copy of all three files to a clean dir → **41/41 checks green from clean state** · invisible-byte scan (NUL/BOM) clean on both sources · tab-indent 0 · `node --experimental-strip-types --check` syntax OK (this stack's fmt/vet — no toolchain by design, zero-dep). README byte-identity re-checked on validation pass (2026-11-05): header + bullets identical; only the line-1 future-commit count drifted 1 → 3 as later commits landed — README wording corrected to say so.

## Shortcuts marked
- `standup-prep.ts` `MAX_FETCH` — fetch capped at newest 1000 commits; note prints when hit · trigger: a real repo printing the cap note
- `standup-prep.ts` `--me` two-pass — email-when-it-matches else name; mixed old/new-email windows lose the old side · trigger: a user report of missing own commits with both identities in one window

## The one check
`node self-check.ts` — 41 executed asserts (28 at Rung 1, 29 after self-review catch #3, 41 after the F1–F13 adversarial regressions): parser fixtures, scripted-world `run()` paths, CLI subprocess matrix, real-git end-to-end, TZ-gap windows. 41/41 executed green (re-run 2026-11-05).
