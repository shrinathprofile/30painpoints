# RETRO — Day 09: overlap planner

> No retro, no post. The post is a byproduct of the work.

## What I learned
- **Technical:** Three platform facts I now own: (1) `encodeURIComponent` does NOT escape `~ ! * ' ( )` — unreserved marks — so a serialized format's separators must be chars the escaper *guarantees* to escape (`|` `,`), a rule you learn by roundtrip or not at all; (2) asking `Intl.DateTimeFormat` **per instant** makes DST someone else's problem — the June test band moved 09:00Z→08:00Z with zero DST code of mine — but DAY BOUNDARIES are the residue: local midnight doesn't exist in 5 zone/dates a year (DST swallows it), fixed-point iteration oscillates onto yesterday, and the fix is a bounded walk to the first instant on the target wall date; (3) `Intl.supportedValuesOf("timeZone")` is a SUGGESTION list, not the parser — it omits `UTC` and prefers `Asia/Calcutta` while Intl accepts both spellings. Ask the parser; treat the list as autocomplete (the D03 "ask the tool" rule, now in timezone form).
- **Meta:** The wrong-assertion pattern got me AGAIN (third series occurrence): my Kiritimati day-start expectation was hand-derived wrong while the tool was right — and only the shell-verified independent clock caught it. The lesson sharpens: an independent clock helps only if you RE-DERIVE the expected value from it; copying your own arithmetic just launders the bug into a green check. Also: roundtrip checks on any wire format pay for themselves before the UI exists — three real format bugs (separator injection, 24:00 asymmetry, name-cap drift) died pre-render today.

## Reusable artifact
`src/lib.ts` is the series' timezone kernel: `fold()` (NFD + mark-strip + lowercase — "São Paulo"/"İstanbul" hit ASCII aliases; İ folds to i *through* the combining-dot), the epoch-shift `zoneOffsetMin`, walk-forward `dayStart`, and the separator-guarantee rule for share-URL state. D13 (meeting-cost, shareable via URL params) is the named next importer of the hash-state pattern; D23/D24/D26/D28 inherit nothing here but the PWA shell comes later anyway.

## Ponytail debt created
3 markers (`daySlots` real-span DST-day ceiling, `CITY_ALIASES` hand-curated table, no date picker) — ledger 34 → 37, all with named triggers.

## Numbers
- Time spent: ~1h 45m (inside the 1–2h light-day box, incl. ~12m adversarial-agent wall time)
- Token spend (est.): ≈4.3M — ~3.5M build+validation, 0.75M the adversarial agent (6 findings, 5 fixed + 1 marked, each with an executed repro)
- Self-check passing: yes — 89 checks (76 + 13 named adversarial regressions)

## Tomorrow
Day 10 (decision-miner): Python + FastAPI + LLM — the RAG showpiece. Carry today's wire-format rule forward: the transcript input is a trust boundary too; validate shape at the edge, refuse loudly, never guess a decision.

## Honest failures
- **My assertion was the bug, again.** Kiritimati at +14 rolls to the NEXT wall date at 12:00Z; I "derived" yesterday. The tool was right, the check lied, and only `TZ=Pacific/Kiritimati date -r` settled it.
- **My F4/F6 fix introduced a double-encode** (`encName` pre-encoded, the shared field map encoded again) — caught by the roundtrip check 30 seconds later, names coming back as literal `%20%7C` strings. Fixes need their own check before they're fixes.
- **`tsc` caught me adding a duplicate `istanbul` alias** that already existed three sections up. The invisible-byte guard works both ways: it finds bytes I add AND keys I forget I wrote.
- **F1 (transition-day grid span) shipped as a marked ceiling, not a fix.** On the anchor zone's 2 DST days/year the grid's tail is off by the shift hour. Per-instant cell truth is unaffected, but a 23:00–24:00 worker on fall-back day won't see their last hour. Named, triggered, in the ledger — deliberately not rebuilt on a light day.
- **Playwright stale-ref misclick** deleted a teammate instead of adding one (refs reset on reload). Recovered instantly; noted so the next day reads the fresh snapshot first.
