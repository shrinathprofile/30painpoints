# loglens

**Day 06 of 30** · [Retro](RETRO.md) · [Build log](BUILD-LOG.md)

> "Fresher here struggling with logs while debugging" — r/devops, plus 5 sibling threads on grep-ing logs by hand
> [thread →](https://www.reddit.com/r/devops/comments/1mv68bq/fresher_here_struggling_with_logs_while_debugging/)

A zero-dependency Go CLI that reads a log file (or stdin) and prints the **records** grep can't see. It auto-detects the format (JSON / apache CLF / plain incl. logfmt), parses each line into a record with time + level + message, attaches following non-timestamp lines — stack traces — to the record above them, filters by level and time window, and **collapses consecutive duplicate records to ×N**.

Exit codes follow grep, so existing pipelines swap over unchanged: `0` matched · `1` nothing matched · `2` cannot check (missing file, no timestamps for `-since`, no levels for `-level`, usage error). Records go to stdout, the stats footer to stderr — `loglens -level error app.log | wc -l` counts records, not report noise.

## Run it

```bash
# needs any recent Go (built here on 1.27) — or nothing at all: the 4MB static
# binary in this folder runs on a bare machine
go run loglens.go app.log -level error,warn        # errors and warns, stacks attached
go run loglens.go app.log -since 30m -level error  # last 30 minutes OF THE LOG
go run loglens.go access.log -level error          # apache: 5xx are errors, 4xx warns
kubectl logs pod/api | go run loglens.go -level error -   # stdin works too
```

Time windows: a duration (`30m`, `2h`) counts back from the log's **newest** timestamp — the right semantics for archived files, where "30 minutes ago" from *now* is nothing. An RFC3339 stamp (`2026-11-04T10:00:00Z`) is absolute. `-until` bounds the top of the window the same way.

## What it looks like

Real run on `fixtures/app.jsonl` — a JSON log with a repeated crash, mixed timestamp styles (RFC3339, epoch-ms, numeric levels), a junk line, and a record with no timestamp:

```text
ERROR      4 db query failed ×3 (… 10:04:13)
       goroutine 1 [running]:
       main.queryDB()
        /usr/src/app/main.go:42 +0xf8
WARN      16 retry scheduled
ERROR     17 payments worker crashed
ERROR     18 db query failed
       goroutine 1 [running]:
       main.queryDB()
        /usr/src/app/main.go:42 +0xf8
WARN      22 heartbeat missed
WARN      23 disk usage 91%
ERROR     25 upstream returned 502 (syslog sev 3)
```

The footer (stderr) explains every drop, grep-accounting style:

```text
loglens — fixtures/app.jsonl (json format) · 12 record(s) · 7 shown · 2 duplicate(s) collapsed (1 group(s)) · 3 filtered · 0 timeless · 0 level-less · 1 junk line(s) before the first record
```

Same idea on an apache access log — 5xx are errors, 4xx warns, repeats collapse:

```text
ERROR      3 GET /shutdown HTTP/1.0 ×3 (… 10:01:13)
ERROR      6 POST /upload HTTP/1.0
ERROR      9 DELETE /session/9 HTTP/1.0 ×2 (… 10:03:42)
ERROR     13 POST /payments/4411 HTTP/1.0
```

At scale: a 200k-line synthetic app log with 5,000 identical crashes collapses to **3 lines of stdout** (one record + its 2-line stack) in 0.4s; this machine's real 10.6 MB `/var/log/install.log` parses to 42,622 records in the same time.

## How it decides

| Decision | Rule | Why |
|----------|------|-----|
| Format | first 50 lines vote — but only lines that anchor in *some* format get a vote | a JSON log whose errors carry stack traces is half non-JSON lines; counting those against JSON rejected the tool's own core case on day one |
| Records vs lines | a line anchors by leading timestamp or level word; everything else attaches to the record above | stack traces are continuations in every format — that's the thing grep cannot model |
| Levels | JSON: `level`/`severity`/`lvl` (string or numeric — syslog 0-7, python 10-50); apache: 5xx/4xx; plain: leading level word or `level=` key | normalize, never invent: a line with no level counts as level-less in the footer, it doesn't guess INFO |
| Time window anchor | durations count back from the file's **newest** timestamp | `-since 30m` on a 3-day-old incident log must mean the log's last half hour, not an empty window |
| Duplicate collapse | consecutive records with identical level + message + continuation lines fold to `×N` with a time range | the 500-line wall of one crash is one record; the *same* crash at a different time keeps its place — context is information |
| Drops | every filtered record counted in the footer (`filtered`/`timeless`/`level-less`) | day-05 carry-over: a drop you can't account for is a silent lie |
| No levels / no timestamps + the matching filter | exit 2, one-line reason | a missing dimension is a cannot-check, never a fake "nothing matched" (exit 1) |
| Exit codes | `0` matched / `1` nothing / `2` cannot check | grep's own contract — drop-in replacement, not a new convention |

## Validate it works

```bash
go test    # 19 checks: parser tables (timestamps, epochs incl. ns-precision, levels),
           # sniff+parse on the fixtures, filter/collapse counting, run() exit
           # trichotomy in-process, subprocess matrix on the real binary
```

Real-world validation before shipping: this machine's npm debug logs (read honestly as plain-inert — npm's counter-prefixed levels are a documented non-goal), 10.6 MB `/var/log/install.log` (42,622 records, 0.4s, `-since 24h` window with real +10:30 zones), a 200k-line JSON flood (5,000 crashes → 1 group), pipe-clean stdout, and the full exit-code matrix pipe-free.

## Deliberately not built

No ingestion agents, no storage/indexing, no UI, no fuzzy duplicate grouping (same crash + different request id = different crash), no npm-style counter-prefixed level parser, no multi-file globbing, no follow/tail mode. Every cut is marked in the code with a `ponytail:` comment.

## Files

- `loglens.go` — the tool (718 lines, stdlib only)
- `loglens_test.go` — the one runnable check (19 tests, stdlib `testing`)
- `fixtures/` — `app.log` (JSON+stacks+duplicates), `access.log` (apache CLF), `plain.log` (python/logfmt/log4j/syslog styles)
