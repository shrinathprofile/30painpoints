# BUILD-LOG — Day 09: overlap planner

> Appended in real time, not written at the end. Honest beats tidy.

## Decisions
| Time | Decision | Why |
|------|----------|-----|
| 0:05 | scaffold copied verbatim from day-07 (configs, main.tsx, favicon, vite base:"./") | ladder rung 2 — the repo's own React+Vite idiom; only the port (5200) and title differ |
| 0:10 | `lib.ts` pure, zero DOM imports — all timezone math there; App.tsx renders | `node selfcheck.ts` executes the exact shipped logic (day-07 pattern); UI can't hide a math bug |
| 0:10 | gold values pinned from an INDEPENDENT clock (shell `TZ=… date -r`), never from Node's Intl, before lib.ts existed | D03: assertions verified against a source the implementation can't contaminate |
| 0:25 | resolve order: alias → exact zone → unique suffix → *anything Intl accepts* → refuse | probing showed Node's list omits `UTC` and prefers `Asia/Calcutta` while Intl ACCEPTS `UTC`/`Asia/Kolkata` — the parser is the authority, not the list; refusing "UTC" because a list forgot it would be wrong |
| 0:30 | `Person` DERIVED per render from row strings; no resolved-state stored | two copies of truth always drift (D02); a half-typed place simply renders as an invalid row |
| 0:35 | unresolved/broken rows are EXCLUDED from fair bands + a visible "N rows not counted" note — never guessed | an ignored row must announce itself or the band silently lies (the D08 "honest empty" family) |
| 0:40 | hash holds the last FULLY-valid team; updates via replaceState on change | a half-typed row must not nuke the URL someone is copying; decode failure → defaults, never a wrong team |
| 0:45 | grid anchored to TODAY in the viewer's zone; every cell asks Intl per-instant | DST becomes the platform's problem — June vs January band tests moved with zero DST code of ours |
| 1:00 | `24:00` accepted as end-of-day (ISO 8601) and nothing else | `fmtMin(1440)` writes `24:00`; the wire format must read back what it writes |

## Rabbit holes
| Time lost | What happened | Lesson |
|-----------|---------------|--------|
| ~4m | my first shell-verification loop used epoch **1780324800** where I'd computed **1780315200** — outputs were self-consistent but for the wrong instant; noticed because Kolkata came back +0530 but at a "12:00Z" that wasn't 17:30 | the independent clock only helps if you feed it the instant you think you fed it; re-ran with both epochs printed side by side |
| ~3m | stale Playwright ref after a reload clicked "remove teammate 2" instead of "+ add" — silently deleted Sam | refs reset on navigation; read the fresh snapshot before clicking (side observation: the hash live-synced to the smaller team exactly as designed) |
| ~2m | vision pass misread Shri's END time input as "06:30" while the same screenshot's row head read "09:30–18:30" | trust the DERIVED text over the native control rendering; state and derivation disagreed with the reader, not with each other |

## AI vs me
| ZCode did | I did (chose / rejected / rewrote) |
|-----------|-----------------------------------|
| probed Intl platform facts before code (supportedValuesOf list, acceptance matrix) | ordered probes-first after D06/D07: no platform claim unverified in the real run |
| wrote lib.ts + selfcheck.ts | rejected my own check design twice: the suffix test was self-referential (asserting output against output) → rewritten to assert semantics; the Kiritimati expectation was hand-derived wrong → corrected against shell |
| wrote App.tsx | caught `x.r()` (nonexistent) + a stray comma expression in review before first run; chose derived-Person, exclusion-note honesty, last-valid-hash policy |
| drove the browser session | chose the demo scenario (a pair WITH a band + a triad whose honest answer is "no window" — the product's actual point) |

*This table is the judgment evidence. If it's empty, either the build was trivial or I wasn't steering.*

## Caught by execution (the rung earns its keep)
1. **Separator injection (real format bug, roundtrip check):** `encodeState` joined rows with `~` — but `encodeURIComponent` does NOT escape `~ ! * ' ( )` (unreserved marks), so a name containing `~` still split rows after TWO encode passes. Fix: separators the escaper guarantees to escape — `,` (%2C) and `|` (%7C). Learned by execution, twice.
2. **24:00 asymmetry (real format bug, roundtrip check):** a 00:00–24:00 person encoded to `24:00`, which `parseHHMM` rejected → the whole share-link decode returned null. Fix: ISO 8601 `24:00` = end-of-day, exactly that pair.
3. **Wrong assertion of mine (D05/D08 pattern again):** expected Kiritimati day-start `Jan-14T10:00Z`; truth is `Jan-15T10:00Z` — at 12:00Z the wall date is ALREADY Jan 16 (+14). The tool was right; shell `date` confirmed; the check was the bug.
4. **Ambiguity branch unreachable + untestable as first written:** Node's 418-zone list has ZERO shared final segments (probed), and my injected-list test used "kolkata" — an ALIAS, so the alias branch answered before the suffix branch. Rewritten with a non-alias token ("tycho").

## Rung 2 — real-browser validation (vite preview of the built dist)
- **Viewer TZ = Australia/Adelaide (≠ dev machine):** default row booted as `You | Australia/Adelaide | 09:00–17:00`; hash self-populated on mount.
- **Preset-hash decode (the share promise):** `#v=1|Shri|Asia/Kolkata|09:30|18:30,Sam|Europe/London|09:00|17:00` → team reproduced, band chip **"19:30–23:30 for you (09:00–13:00 UTC) · Shri 14:30 · Sam 09:00"** — matches the hand-derived gold for an Adelaide-anchored grid (Kolkata∩London = 09:00–13:00Z; +10:30 ACDT → 19:30–23:30; the same band's UTC label honestly crosses UTC midnight when anchored elsewhere).
- **Refusal path:** typed "Narnia" → `"Narnia" isn't in the list — pick a suggestion`; bands degraded to the valid subset + "1 row not counted — fix the timezone/hours above; guessing would lie."
- **Alias path:** typed "SF" → resolved to `America/Los_Angeles` (visible in the hash).
- **Honest empty:** Kolkata+SF+London all 9–5 → "no window where everyone's hours overlap today" — structurally true, and the grid shows WHY at a glance (three green bands that never vertically align). That visible unfairness IS the product.
- **Now-marker:** rendered inside the anchored day; label collided with tick text → fixed with a 3-line background chip, rebuilt, re-verified.
- **Same-document hash navigation does NOT re-boot** (by design — no hashchange listener): sharing a new link opens it correctly on load; noted honestly rather than papered over.

## Rung 3 — fresh-context adversarial pass (6 findings, each with an executed repro; ~90 probes, 418-zone × 2026 fuzz)
Bounded to the light-day box (~12 min agent wall time). Fix order wrong-result first. No repo files touched by the agent; every fix shipped with a named regression.

| # | Class | Finding | Fix |
|---|-------|---------|-----|
| F1 | wrong-result (edge) | `daySlots` emits 24 real hours — on the anchor zone's 2 DST days/year the local day is 23/25h: fall-back days lose the last local hour, spring-forward days bleed into tomorrow | **marked, not rebuilt** — per-instant cell truth unaffected; `ponytail:` on `daySlots` names the exact behavior + trigger (planning on a transition day) |
| F2 | wrong-reason | swallowed-midnight spring-forward: Havana 2026-03-08, Santiago 2026-09-06, Azores 2026-03-29 anchored at **23:00 of the previous day** (the 2-round iteration oscillates and stops on the wrong side; my comment claimed "≤1h off") | dayStart rewritten: walk forward in 15-min steps to the first instant whose wall DATE is the target — lands 00:00 in the common case, 01:00 (first existing instant) for all 5 swallowed-midnight zone/dates in 2026 |
| F3 | wrong-reason | `decodeState` accepted `end <= start` rows — a share link could smuggle a team the validator refuses | decode rejects `end <= start` alongside zone/time checks |
| F4 | crash | `encodeState` THREW `URIError` on a lone-surrogate name (decode guards every step; encode guarded none) | `cleanName()`: strip lone surrogates (U+FFFD) before encoding |
| F5 | wrong-reason | "São Paulo" / "İstanbul" refused with "isn't in the list" though the ASCII aliases exist (İ.toLowerCase() = i+combining-dot, which never matches) | `fold()`: NFD + mark-strip + lowercase before lookup — İ folds to i automatically |
| F6 | cosmetic | decode capped names at 40 runes, encode didn't → a 41-rune name round-tripped to a DIFFERENT team | same `Array.from(...).slice(0,40)` cap in `cleanName()` — encode writes only what decode keeps |

**Post-fix self-catches:** my first F4/F6 fix double-encoded names (`encName` pre-encoded, then the shared field map encoded again — the roundtrip check caught it immediately: names came back as literal `%20%7C` strings) → `cleanName` returns the RAW well-formed capped name. Then `tsc` caught that my F5 alias addition duplicated an existing `istanbul` key — the type-checker as the invisible-byte guard, again.

**Probed clean by the agent (excerpts):** wall times/offsets at exact DST instants (NY/London/Lord Howe/Chatham/Samoa 2011 — the lib even beat macOS `date`, which printed an internally inconsistent +1400/Dec-29 at the Apia jump), dayStart convergence across 418 zones × all of 2026 (zero failures where midnight exists), exhaustive parseHHMM grid, fairBands boundary semantics, alias-zone correctness spot-checks, 100k-char inputs, ambiguity branch.

## Rung 4 — gates (final)
`tsc -b` 0 errors · `oxlint` 0 warnings · `vite build` ok · `node selfcheck.ts` **89/89 green** (76 + 13 adversarial regressions) · fresh-build browser re-verify: preset hash → same gold band chip.

## Shortcuts marked
- `src/lib.ts` `CITY_ALIASES` — ~90 hand-curated aliases, not a geocoding dataset; unknown cities fall through to the searchable IANA list · trigger: a report naming a missed city
- `src/lib.ts` `fmts` Map — one formatter per zone cached forever · trigger: a zone count where the cache visibly matters (never, realistically)
- `src/App.tsx` footer — no date picker; the grid answers "which band TODAY" · trigger: someone planning across a DST-transition date
- `src/lib.ts` `daySlots` — 48 real half-hour slots; on the anchor zone's 2 DST days/year the local-day tail is off by the shift hour (per-instant cell truth unaffected) · trigger: a user planning on a transition date (adversarial F1)

## The one check
`node selfcheck.ts` — 89 executed asserts: wall times vs shell gold (both DST seasons), offsets incl. Lord Howe's 30-minute DST, parse strictness, resolve matrix (aliases/case/diacritics/garbage/injected ambiguity), dayStart/daySlots anchors + all five 2026 swallowed-midnight zone/dates, hand-computed fair bands (incl. the June DST shift moving a band with zero DST code), honest-empties, validation refusals, share-format roundtrip incl. separator-hostile names + injectivity + hostile hashes + overnight-smuggling rejection, platform structural facts, and one named regression per adversarial finding (F2–F6; F1 is the marked ceiling).
