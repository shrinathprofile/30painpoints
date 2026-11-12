# RETRO — Day 31: remote-job-radar

> No retro, no post. The post is a byproduct of the work.

## What I learned
- **Technical:** Multi-source aggregation stays honest with two primitives: an adapter-per-vendor seam pinned by one RECORDED real fixture each (field names read from the recording, never assumed — the probe paid for that lesson twice), and a receipt line per source where `ok N` / `failed: reason` / `no feed (named)` are the only possible states — a quiet list must never read as "nothing new" (D04/D08's truthful-refusal rule, now for networks). The namesake guard — print each feed's own `company_name`/sample job on first sighting — caught a REAL wrong company on its first live run (`greenhouse:remote` is General Assembly's board, not remote.com); a guard that makes the data auditable is cheaper than pre-verifying 56 slugs, and it turned a silent wrong-match into a one-minute data fix. Two regex/HTML platform facts for the collection: `re.escape` mangles multi-word patterns if you substitute `\s+` AFTER escaping (compiles to a literal backslash, matches nothing — caught by the suite, not by me), and `HTMLParser` splits `handle_data` AT tags so fragments must join with `""`, never `" "` (a space breaks `<b>Eng</b>ineer` into two words).
- **Meta:** The protocol says "no evidence → no build", and this day breaks it on purpose — the complaint is mine, n=1, no upvotes. The honest cost of a self-serving build is naming that everywhere (brief, README, post) AND keeping the discipline that makes an n=1 build trustworthy anyway: hand-counted fixtures, receipts for every source, never guessing locations into "open". The other side of that coin: a tool that audits its own input caught its first data error before the first coffee — checks on data you compiled yourself are not optional, they're the entire game.

## Reusable artifact
The 7 recorded fixture shapes + adapters (Greenhouse / Lever / Ashby / Eightfold / RemoteOK / Remotive / Himalayas) — a probe kit for any future job-board work; `companies.csv` with its `ats`/`slug` enrichment (56 proven feeds, one caught-and-removed namesake); and two idioms: the first-sighting namesake guard (store-backed, prints once per source) and the default-deny location verdict (curated closed-list before open-list, or-split most-permissive — the 16-string trap table predates the code).

## Ponytail debt created
4 new markers (49 → 53): himalayas first-page-only per run; `clean()` keeps raw text when HTML is malformed (control-char pass still applies); `word_re` keywords ending in punctuation never match; unknown transport errors collapse to `TypeName: reason`. All low-severity, all with named triggers.

## Numbers
- Time spent: ~2h (probe + fixtures 35m, tool + suite 50m, live runs + data fix 10m, shrink 10m, docs + post the rest)
- Token spend (est.): ≈1.3M, single build session, no subagents
- Self-check passing: yes — 23 checks offline; 4 live runs recorded, verdict counts byte-stable, timeout variance reconciling exactly to the source that dropped

## Tomorrow
Back to the 30 (day 12: parking-lot, first browser extension). For the radar: the 10-line GitHub Actions cron is a follow-up once a week of real daily runs proves the exit codes — not before.

## Honest failures
- **Probe v1 saved the body AFTER printing the shape — a print bug lost all seven recordings** (the `except` swallowed the crash and the writes never ran). Persist before you pretty-print; the analysis is cheap to re-run, the recording isn't.
- **The fixture picker churned twice** against the live Himalayas feed (two jobs fell off page one between fetches two minutes apart) before I picked by the stable property (`locationRestrictions`) instead of the volatile one (titles).
- **No fresh-context adversarial agent today** (D10 ran one, D11's found a shipped bug). The 23-check suite caught two real bugs and four live runs reconciled every delta exactly — execution-based checking did the adversarial work — but "would have" is not "did"; if this tool becomes the daily driver, the cron follow-up deserves one adversarial pass first.
- **A BUILD-LOG edit swallowed a section header** (new section pasted OVER the old one's title, leaving a table parentless) — caught on the next read; even the record-of-record needs its diffs re-read.
