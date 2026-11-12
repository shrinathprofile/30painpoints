# remote-job-radar

**Day 31 — bonus, outside the 30** · [Retro](RETRO.md) · [Build log](BUILD-LOG.md)

> "I want to earn in AUD or USD but be able to work from India, so annual leave goes to travel, not to visiting home — and I can't re-check 120 careers pages by hand every week." — **my own words** (2026-11-12). No subreddit, no upvote count, one user: the series author. Stated as such, per the rule that says a build needs evidence.

A zero-dependency Python CLI that asks **every free public jobs feed** on the companies list — the Greenhouse / Lever / Ashby / Eightfold boards behind 56 of the 123 researched companies, plus RemoteOK, Remotive and Himalayas — keeps roles **workable from India**, and shows **only what's new since the last run**. 59 sources, ~3,100 jobs, **under 12 seconds**.

- **The jobs were already public JSON.** Probed on 2026-11-12: no keys, no scraping, no ToS grey zone for the 56 feed-backed companies. What was missing is one command that asks all of them at once and remembers what you've seen.
- **Location verdicts never guess into `open`.** `open` (India / APAC / Asia / worldwide) · `unclear` (bare "Remote", blank, "London or Remote" — kept and labelled) · `closed` (named region that excludes India — dropped AND counted). Default-deny with a curated allow-list: "Anywhere in Europe" and "Indiana, US" read as closed, not open.
- **Every source gets a receipt line.** `ok 259 · GitLab` / `failed: timeout · Airalo` / `no feed (67): Automattic, Deel, …` — a quiet list must never read as "nothing new". One slow host is its own line, never a hang (10 s timeout, 16 workers).
- **The namesake guard caught a wrong company on its first live run.** The CSV's `remote` slug proved to be **General Assembly's board** — the feed's own `company_name` said so, printed by the first-sighting line that exists precisely for guessed slugs. Remote's row moved to the feedless list the same minute.
- **Exit trichotomy (day-04/05 carry-over):** `0` new matches · `1` ran clean, nothing new · `2` cannot check — no profile, unreadable CSV, or every source failed. Second run over a full store prints nothing and exits 1. That's the idempotence a daily cron needs.

## Run it

```bash
cp profile.example.json profile.json   # then edit keywords/exclude to your stack
python3 job_radar.py                   # all 56 feeds + 3 boards, new-since-last-run
python3 job_radar.py --priority high   # just the High-priority rows
python3 job_radar.py --all             # everything matching, seen or not
python3 self_check.py                  # 23 offline checks, zero network
```

Stdlib only (`urllib`, `json`, `csv`, `sqlite3`, `concurrent.futures`, `html.parser`). `profile.json` and `seen.sqlite3` are gitignored; `companies.csv` is the researched Master List with two added columns (`ats`, `slug`). Output links straight to each source board's own job page — RemoteOK/Remotive's attribution terms are satisfied by linking, nothing is republished.

## What it looks like

Real run on 2026-11-12 11:27, fresh store, 59 sources ([full screenshot](job-radar-run.png) — elided here to the load-bearing lines):

```text
job radar — 2026-11-12 11:27 · 59 sources (56 feeds + 3 boards) · priority: all

## first sightings (slugs are guessed — the sample proves whose jobs the feed carries)
- GitLab (greenhouse:gitlab) — feed says "GitLab": sample: AI Transformation Owner, CRO @ Remote, United States
- Canonical (greenhouse:canonical) — feed says "Canonical": sample: Accountant @ Home based - EMEA
  … 56 more first sightings …

## new since last run (135)

- **GitLab** — Intermediate Backend Engineer, India · `open` · Bangalore, India · https://job-boards.greenhouse.io/gitlab/jobs/8775507002
- **Canonical** — Golang Engineer · `open` · Home based - Worldwide · https://job-boards.greenhouse.io/canonical/jobs/5146709
  …
**135 new** — 110 open · 25 unclear · 0 flex-only · 331 dropped: closed location · 2612 skipped: keyword filter · 0 broken

## receipts
- ok 259 · GitLab (greenhouse:gitlab)
- failed: timeout · Airalo (lever:airalo)
- ok 20 · remoteok (remoteok) · board
  …
- no feed (67): Automattic, Deel, Remote, Doist, … — add ats+slug columns, or scrape (the named next step)
```

The immediate second run: `0 new`, exit 1, same counts — the store (SQLite, keyed on job URL) remembers every fetched job, including keyword-skipped and closed ones, so widening the profile next week doesn't flood old noise back as "new".

## How it decides

| Decision | Rule | Why |
|----------|------|-----|
| Location verdict | curated closed-region list BEFORE open list; split on " or " and "/" taking the most permissive piece; bare "Remote" → unclear | "Anywhere in Europe" must never read open; "EMEA or APAC" is open; a region that says nothing about India is `unclear`, never guessed |
| Himalayas locations | `locationRestrictions == []` → "Worldwide" → open | the field NAME says restrictions; empty = no restriction = the API's own semantics |
| Keywords | whole-word, case-insensitive, on title; optional exclude list | "java" must not match "javascript"; empty keywords = no filter |
| flex-only | Remote Model column lacks the whole word "remote" (e.g. "Hybrid") → open-verdict jobs labelled `flex-only`, never `open` | "4 weeks/year overseas" is not remote; the label is the honesty |
| Seen-store | SQLite keyed on job URL; records every fetched URL, not just shown ones | idempotent daily runs; profile changes must not resurrect seen jobs |
| Namesake guard | first successful fetch of a source prints a sample job (and the payload's own `company_name` when it has one) | slugs were guessed from company names — the feed is the only proof |
| Failures | per-request 10 s timeout; every failure is that source's receipt line; run dies (exit 2) only when EVERY source fails | one slow host ≠ a broken day; total failure ≠ "nothing new" |
| Fixtures | one recorded real response per source shape (trimmed, builder self-validates); suite is offline | the fixture is the contract (D05); per-job field names were unverified until recorded |

## Honest ceilings

- 67 of 123 companies publish no feed this tool can read — named in every run's no-feed line. Scraping them is the deliberately-not-built next step (Firecrawl), not a secret.
- Himalayas: first page only per run (~20 jobs) — cursor pagination when a day's postings overflow a page.
- Boards and feeds are live: Airalo timed out on run 3, Toptal on run 4 — each was a receipt line, each recovered next run. The tool reports the world; it doesn't pretend it's static.
- No salary parsing, no LLM fit-scoring, no auto-apply (LinkedIn scraping is against its terms). Listed in the brief's NOT-building section on purpose.

## Checks

`python3 self_check.py` — **23 assert-based checks, offline**: hand-counted adapter expectations per source shape (counted twice), RemoteOK's element-0 legal notice excluded, the 16-string verdict trap table, whole-word keyword traps, seen-store idempotence, exit matrix 0/1/2 incl. one-source-fails, malformed inputs named without tracebacks, feedless-67 on the real CSV, first-sighting lines, flex-only labelling, URL dedupe, display safety (HTML strip + control-character pictures, D08/D10 idiom). The suite caught two real bugs before ship: a multi-word keyword regex that never matched anything, and `clean()` splitting words at inline tags.
