# IDEA-BRIEF — Day 31: remote-job-radar

> Written BEFORE any code. If any section is blank at build start, the build doesn't start.

## The complaint (evidence)
- **Subreddit:** none — **bonus day, outside the 30.** This is the series author's own need, not a Reddit thread.
- **Thread / quote:** "I want to earn in AUD or USD but be able to work from India, so annual leave goes to travel, not to visiting home — and I can't re-check 120 careers pages by hand every week." (own words, 2026-11-12)
- **Why I believe it's recurring:** the author already spent a research pass (2026-10-20) compiling 122 remote-first companies into a spreadsheet; its own README says "refresh this research quarterly" and "re-verify a company's careers page before applying". The list exists; the re-checking is the unbuilt part.
- **Source URL:** `~/Downloads/ShrinathDaily/remote-job-research/` (private research folder; the Master List is the input).
- **Note (honest):** the protocol says "no evidence → no build". This day breaks that rule on purpose and says so: no upvote count, no thread, one user. If a Reddit thread is wanted for the post, find it before the post, not before the build. No numbers invented.

## Why this should exist (ponytail rung 1)
The jobs are ALREADY published as free JSON: probed on 2026-11-12, 57 of 123 listed companies (17 of the 31 High-priority) answer on a public Greenhouse / Lever / Ashby / Eightfold endpoint with no key, and 6 remote boards publish open feeds. Nothing needs scraping for those — what's missing is one command that asks all of them, keeps only roles workable from India, and shows only what's new since yesterday.

## The people hurting
One early-career engineer in Adelaide job-hunting for remote AUD/USD roles, who today opens careers pages one at a time and cannot tell a new posting from one seen last week.

## Inputs already in this folder
- **`companies.csv`** — 123 rows: the 122-company Master List (7 of its 19 columns kept) plus Insight, with two added columns `ats` and `slug`. 57 rows have a feed; 66 are blank.
  - **Slugs are GUESSED from company names and only proven to return jobs — not proven to be the right company.** Short names (`remote`, `kit`, `float`, `ghost`, `render`, `contra`, `constructor`, `turing`) are the namesake risk. The build must print each feed's own company name / a sample job on first run so a wrong match is visible.
  - Insight's row: `eightfold`, `apaccareers.insight.com|insight.com`. Its "4 weeks/year overseas" cell is the author's statement, not verified from the careers page.

## Endpoints (each returned HTTP 200 with jobs on 2026-11-12, no key)
| Source | URL shape | Record list |
|---|---|---|
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs` | `.jobs[]` |
| Lever | `https://api.lever.co/v0/postings/{slug}?mode=json` | top-level array |
| Ashby | `https://api.ashbyhq.com/posting-api/job-board/{slug}` | `.jobs[]` |
| Eightfold (Insight) | `https://apaccareers.insight.com/api/apply/v2/jobs?domain=insight.com&start=0&num=10` | `.positions[]` (has `work_location_option`, `t_create`, `canonicalPositionUrl`) |
| RemoteOK | `https://remoteok.com/api` | array; **element 0 is a legal notice, not a job** |
| Remotive | `https://remotive.com/api/remote-jobs` | `.jobs[]` (response also carries warning/legal keys) |
| Himalayas | `https://himalayas.app/jobs/api?limit=N` | `.jobs[]`, cursor-paged |
| Jobicy | `https://jobicy.com/api/v2/remote-jobs?count=N` | field name unverified — read the response |
| Working Nomads | `https://www.workingnomads.com/api/exposed_jobs/` | top-level array |
| We Work Remotely | `https://weworkremotely.com/remote-jobs.rss` | RSS, 2.2 MB |

Only status, size and top-level keys were checked. Per-job field names beyond those listed are unverified — the build records a fixture per source and reads it.

## Scope
- **30-minute floor (fallback):** one script, three adapters (Greenhouse, Lever, Ashby) over the High-priority rows of `companies.csv` that have a slug; title keyword match from a `profile.json`; print Markdown lines `company · title · location · url`. No dedupe, no boards. Done.
- **Today's target:** the floor plus —
  - Eightfold adapter (Insight) and the three simplest boards (RemoteOK, Remotive, Himalayas); all 57 feed rows, `--priority high|medium|all`.
  - **Location verdict per job, three buckets:** `open` (worldwide / anywhere / APAC / India / Asia) · `closed` (named region that excludes India: "US only", "Remote - EMEA", "Canada") · `unclear` (bare "Remote", blank, multi-location). `closed` is dropped AND counted; `unclear` is kept and labelled — never guessed into `open`.
  - **Seen-store:** one SQLite file keyed on job URL; default output is only jobs not seen before, `--all` shows everything.
  - **Per-source receipt line:** every source reports `ok N jobs` / `failed: <reason>` / `no feed (66 companies)`. A failed or feedless company is named, never silently absent — a quiet list must not read as "nothing new".
  - Exit trichotomy (series convention): 0 new matches · 1 ran clean, nothing new · 2 cannot check (no profile, unreadable `companies.csv`, or EVERY source failed).
- **Guarding against:**
  - Namesake slugs (above).
  - RemoteOK's element-0 notice counted as a job.
  - Each board's terms: RemoteOK and Remotive ask for a link back / attribution — output links to the source's own URL, and nothing is republished.
  - One slow source hanging the run — per-request timeout, and a failure is that source's receipt line, not a crash.
  - HTML in descriptions reaching the terminal — strip tags, and reuse the series' control-character display safety (D06/D08) before printing third-party text.
  - Keyword match on substrings ("java" matching "javascript") — whole-word match.
  - Treating "4 weeks from overseas" as remote: Insight rows are labelled `flex-only`, a separate tag from `open`.
- **Deliberately NOT building:**
  - Firecrawl for the 66 feedless companies — the named next step, add when the feed list stops surfacing enough roles. Listed by name in the output until then.
  - Tavily policy discovery, Apify actors for Seek / LinkedIn (LinkedIn scraping is against its terms).
  - LLM fit score — keywords first; add when the daily list is too long to read.
  - Auto-apply, a UI, notifications, the GitHub Actions cron (a workflow file is a 10-line follow-up once the CLI's exit codes exist).
  - Salary parsing, Workday / custom ATS adapters, Jobicy / Working Nomads / WWR adapters.

## Test plan (what `self_check.py` must cover — offline, no network)
1. **One recorded fixture per source shape** (Greenhouse, Lever, Ashby, Eightfold, RemoteOK, Remotive, Himalayas), trimmed to 2–3 jobs, hand-counted — each adapter returns exactly the hand count, with title / location / URL populated.
2. RemoteOK fixture keeps its element-0 notice → count excludes it.
3. Location verdict table: at least 4 strings per bucket, including the traps "Remote - US", "Remote (India)", "Remote", "", "London or Remote", "APAC".
4. Keyword filter: whole-word hit, substring non-hit ("java" vs "javascript"), case-insensitive.
5. Seen-store: second run over the same fixtures yields zero new and exit 1; `--all` still lists them.
6. Exit codes: 0 / 1 / 2 each reached, including "one source fails, others succeed" → still 0 or 1, with the failure on its receipt line.
7. Malformed input: non-JSON body, JSON of the wrong shape, missing `companies.csv`, missing `profile.json` → named reason, no traceback.
8. Feedless companies appear in the receipt count (66 with today's CSV).
9. One live smoke run against the real endpoints, recorded in BUILD-LOG — not part of the self-check.

## Stack of the day
Python 3, standard library only — `urllib.request`, `json`, `csv`, `sqlite3`, `concurrent.futures`, `html.parser`. Zero dependencies, same as D04/D10. Teaches: multi-source API aggregation with honest partial-failure reporting, the adapter-per-vendor seam, and idempotent runs over a local store — the "integrations" line on remote backend job descriptions. `profile.json` (keywords, excluded words, priority) is gitignored; a `profile.example.json` is committed.

## Definition of done
With `profile.json` in place, `python3 job_radar.py` prints a Markdown list of jobs not seen before — company, title, location verdict, link — from the feed-backed companies in `companies.csv` plus three remote boards, with one receipt line per source, in under 60 seconds, exit 0; an immediate second run prints no jobs and exits 1; with no profile or every source unreachable it names the reason and exits 2 — verified by the offline self-check and one recorded live run.
