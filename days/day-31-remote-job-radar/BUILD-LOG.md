# BUILD-LOG — Day 31: remote-job-radar

> Appended in real time, not written at the end. Honest beats tidy.

## Decisions
| Time | Decision | Why |
|------|----------|-----|
| 0:00 | probe before code: one live call per source shape, bodies saved raw, THEN fixtures trimmed from the recordings | the brief pinned URLs and record-list keys only; per-job field names were unverified ("the build records a fixture per source and reads it") |
| 0:05 | fixtures = real recordings, trimmed to 2–4 jobs; builder validates its own output (every job carries its adapter's fields) | D05: the fixture is the contract; D11: builders that can't lie beat counters that double-check |
| 0:10 | slim pass: keep every recorded field name, truncate long text blobs at 120 chars (visible `…`) | 250 KB of descriptions pinned nothing the adapters read; shape kept, bulk cut |
| 0:15 | adapters = plain module functions at the vendor seam (one per ATS + one per board), no Adapter class | 7 functions, one dict dispatch; a base class with one implementation each is D01's anti-pattern |
| 0:20 | location verdict is default-deny: a curated closed-region list checked BEFORE the open list, or-split takes the most permissive option, anything named falls to closed | "Anywhere in Europe" and "Global - US only" must never read as open; brief: never guessed into open |
| 0:20 | bare "Remote"/"Hybrid"/"" → unclear (kept, labelled); "EMEA or APAC" → open; "London or Remote" → unclear; "Indiana, US" → closed (word boundaries, not substrings) | the brief's own trap table, verbatim |
| 0:25 | himalayas `locationRestrictions == []` → "Worldwide" → open | the field NAME says restrictions; empty = no restriction = the API's own semantics, not a guess |
| 0:30 | seen-store records EVERY fetched job URL (keyword-skipped and closed ones too), not just shown ones | widening the profile next week must not flood yesterday's noise back as "new" |
| 0:30 | store's `sources` table doubles as the namesake guard: first successful fetch of a source prints its sample job (and greenhouse's own `company_name`) | slugs were guessed from names — the feed's payload is the only proof of whose jobs it carries |
| 0:35 | flex-only = Remote Model without the whole word "remote" (Insight's "Hybrid") — such companies' open-verdict jobs are labelled, never shown as `open` | "4 weeks/year overseas" is not remote; a separate tag from open, per the brief |
| 0:40 | ThreadPoolExecutor(16), 10 s per request; a failure is that source's receipt line, never a crash | DoD: all 60 sources in under 60 s; one slow host must not hang the run |
| 0:45 | every-source-failed → exit 2 with the count named; per-source reasons stay in that run's receipts when any source succeeds | "cannot check" must be distinguishable from "nothing new"; a 63-line stderr wall helps no one |
| 0:50 | profile carries keywords/exclude/priority; `--priority` overrides; invalid profile priority → exit 2 named | keywords are personal, the profile is gitignored, the example is committed |

## Rabbit holes
| Time lost | What happened | Lesson |
|-----------|---------------|--------|
| ~10m | probe v1 printed the shape BEFORE saving the body; a dict-comprehension bug (`v` vs `j[k]`) crashed the print, the `except` swallowed the source, and all seven saved bodies were never written — one probe run lost | persist BEFORE you pretty-print; analysis is cheap to re-run, the recording isn't |
| ~6m | himalayas feed churned between two fetches two minutes apart — "Accounting Intern" fell off page 1 mid-build and the fixture picker asserted | pick fixtures by the stable property (locationRestrictions), not the volatile one (today's titles) |
| ~3m | fixture builder assumed a `title` key on every source; remoteok uses `position` — KeyError mid-build | per-source dialects come from the recording, not from assumption; the builder's self-validation is what makes that stick |
| ~2m | first eightfold trim deduped by location into 1 job (both picks shared a substring) | dedupe + "pick first match" interact; assert the FINAL count, not the picker |

## AI vs me
| ZCode did | I did (chose / rejected / rewrote) |
|-----------|-----------------------------------|
| probed all 7 shapes and drafted the fixture builder | chose the fixture jobs by hand for verdict coverage (one open / one unclear / one closed per source where the live feed offered them); rejected my first himalayas picker (title-based) when the feed churned under it |
| drafted job_radar.py whole | caught four sins on read-through BEFORE first run: a duplicated CSV read zipped against a re-read, per-job regex compilation, a profile priority that would KeyError, a convoluted count expression — all rewritten before the tool ever executed |
| wrote the verdict engine | hand-derived the 16-string trap table (incl. "Indiana, US" and "Anywhere in Europe") from the brief's rules BEFORE running it; the tool matched 16/16 on first execution |

*This table is the judgment evidence. If it's empty, either the build was trivial or I wasn't steering.*

## Shortcuts marked
- himalayas: first page only per run (`limit=100`, API caps at 20) — cursor pagination when a day's postings overflow a page
- `word_re`: keywords ending in punctuation ("c++") lose the trailing `\b` and never match — no such keyword in the example profile
- flex-only heuristic reads one CSV column's whole word "remote" — a richer remote-model taxonomy when a second non-remote company joins the list
- `except Exception` on the transport → receipt line `TypeName: reason` — unknown failures are named, never traced

## SHRINK — /ponytail-review on the diff
5 findings, all applied (net −13 lines, 465 → 452):
- `delete:` Company dataclass — priority and name fields never read (label already lives on Source); only the flex test survived, inlined as `Source.flex_only`
- `shrink:` BOARDS + BOARD_ADAPTERS double dict + nested genexpr → one dict `{name: (url, parser)}`
- `shrink:` RANK/_RANK_NAME mirror dicts → `["closed","unclear","open"][best]` (index order IS the permissiveness order)
- `delete:` dead fallback `j.feed_name or j.company` behind an `if j.feed_name` guard
- `shrink:` docstring still said "57 of 123 rows" — the guard's own catch had moved it to 56

Proof the shrink changed nothing: suite 23/23; live run 4's verdict counts byte-identical to run 3 (110 open · 25 unclear), and the two deltas that DO exist reconcile exactly to Toptal timing out (−31 jobs: +1 closed, +20 kw-skipped) while Airalo recovered — the feeds moved, not the code.

## Live smoke runs (recorded, not part of the self-check)
| Run | Result |
|-----|--------|
| 1 · 11:26, fresh store | **11.8 s wall, exit 0** — 60 sources, 0 failed, 3,105 jobs: **135 new** (110 open · 25 unclear · 0 flex-only), 332 dropped closed, 2,625 keyword-skipped, 0 broken. And the namesake guard caught a REAL wrong slug on its first ever run: `greenhouse:remote`'s feed says **"General Assembly Remote Jobs"** — not remote.com. |
| 2 · 11:26, same store | **6.1 s, exit 1** — 0 new, counts identical. The DoD's "immediate second run prints no jobs and exits 1", verified live. |
| — | acted on the guard's catch: Remote's row moved to feedless (ats/slug blanked) — 56 feeds + 67 no-feed from here; self-check updated to pin 67. |
| 3 · 11:27, fresh store, fixed CSV | **exit 0**, 135 new, 331 closed / 2,612 skipped (General Assembly's 2 jobs gone — counts moved exactly with the data change), and Airalo timed out: `failed: timeout · Airalo (lever:airalo)` on its own receipt line while the run stayed green — the partial-failure design demonstrating itself live. |
| 4 · post-SHRINK, full store | **exit 1, 0 new** — verdict counts byte-identical to run 3; the shrink's proof run (see above). |

## The one check
`python3 self_check.py` — 23 checks, assert-based, offline, fixtures only: adapter counts per shape (hand-counted twice), RemoteOK's element-0 notice excluded, the 16-string verdict table, whole-word keyword traps (incl. the multi-word regex bug it caught), seen-store second-run emptiness, exit matrix 0/1/2 incl. one-source-fails, malformed inputs named (no traceback), feedless 67 counted on the real CSV, first-sighting namesake lines, flex-only labelling, URL dedupe, display safety.
