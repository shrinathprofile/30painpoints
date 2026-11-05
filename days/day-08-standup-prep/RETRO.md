# RETRO — Day 08: standup-prep

> No retro, no post. The post is a byproduct of the work.

## What I learned
- **Technical:** The seams multiply. Three separate two-system boundaries each produced a real bug today: epoch **seconds** (git `%at`) vs **milliseconds** (`Date.getTime()`) — every repo "had no commits"; a flag **validated with one parser and consumed with another** (`parseSince` local-midnight in main, raw `new Date` UTC-midnight in run) — the UTC trap shipped *despite being named in the brief*; and one **sanitize implementation behind every output path** — the commit subjects were picture-escaped while the LLM tone-pass printed raw until an adversarial probe repainted a terminal. Control pictures (Unicode U+2400 block) killed three findings at once: no raw control bytes, no mid-escape clip cuts, no escape impersonation.
- **Meta:** Guarding-against bullets are checklists for the CHECK suite, not armor for the code. The brief named the UTC-midnight trap explicitly; I still wrote the bug. Reading rules didn't save me — executing checks did (4 real bugs caught by Rung 1/2 + self-review, then 13 more by the fresh-context agent). Also: my "exit 1 mystery" during the re-smoke was my own shell cwd drifting — operator error, not tool error; verify the operator before debugging the tool.

## Reusable artifact
`parseLog`'s record format (NUL-prefixed, `\x1f`-joined, strict-epoch inert counting) + the two-pass identity filter (email authoritative when it matches anything, name only on zero email matches) + the pinned-clock knob (`STANDUP_PREP_FAKE_NOW`) as a reproducibility contract. Copy-idiom per D03 — but **day-11 is the named first importer** (`packages/git-digest`), and today's log-porcelain parser is the seed of that package. D09 also inherits the determinism lesson: pin locales when output must be byte-stable (today's manual formatters beat Intl for the byte-identity contract; tomorrow Intl IS the stack card — embrace it there, explicitly).

## Ponytail debt created
2 markers (`standup-prep.ts`): the 1000-commit fetch cap (note prints when hit) and the two-pass identity rule (mixed old/new-email histories lose the old side). Ledger 32 → 34. Full triggers in the rows.

## Numbers
- Time spent: ~2h 45m (inside the 3–4h build-day box, incl. ~30m of adversarial-agent wall time)
- Token spend (est.): ≈7.5M — **6.1M of it the adversarial agent** (the series' most expensive and most productive validation pass: 13 findings, every one reproduced twice)
- Self-check passing: yes — 41 checks, including one named regression per adversarial finding

## Tomorrow
Day 09 (overlap planner): lean INTO Intl.DateTimeFormat as the stack card — zero date libraries is the platform story — and pin locales explicitly wherever output must stay byte-stable (today's determinism-vs-native call, inverted on purpose).

## Honest failures
- **The brief predicted the worst bug and I shipped it anyway.** "Guarding against: … raw `new Date("2026-11-04")` would be UTC midnight — the classic off-by-hours trap" is in MY OWN parser comments — and `run()` still called `new Date(opts.since)`. Caught by self-review + the agent's Kolkata repro, fixed with a deterministic TZ=UTC+14 gap regression.
- **The unit-seam bug passed 11 checks before the first real-magnitude fixture ran.** Fabricated-timestamp fixtures had windows that were *expected* to be empty, so a seconds-vs-milliseconds comparison looked like a correct empty result. Only real-magnitude epochs blew up.
- **LLM real-network smoke: cannot-check.** No key in the environment; the failure paths are covered by fakes + the no-key fail-fast is real-env verified, but an actual `--llm` round-trip against a live endpoint is untested. Documented, not papered over.
- **Fixture-builder trap (D05's lesson, reproduced):** `rec(..., undefined)` joins as a *valid* empty-subject record — my "malformed 4-field" fixture was parseable for 3 checks before the hand-count caught the builder lying.
