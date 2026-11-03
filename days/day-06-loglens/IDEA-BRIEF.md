# IDEA-BRIEF — Day 06: loglens

> Written BEFORE any code. If any section is blank at build start, the build doesn't start.

## The complaint (evidence)
- **Subreddit:** r/devops
- **Thread / quote:** "Fresher here struggling with logs while debugging" — plus 5 separate r/devops threads about grep-ing logs by hand and the "Logging Sucks" crosspost genre; debugging-by-grep is the entry rite nobody enjoys.
- **Why I believe it's recurring:** every debugging session on a server starts with `grep ERROR app.log` and immediately hits the three walls this complaint names: mixed formats (one pipeline, JSON logs; the legacy service next door, plain text), duplicate stack traces burying the one unique error, and time windows that grep simply cannot express. The tooling that solves this (ELK, Loki, Datadog) all assume you can ship logs somewhere first — the person SSH'd into a box with a 2 GB log file is the underserved user.
- **Source URL:** https://www.reddit.com/r/devops/comments/1mv68bq/fresher_here_struggling_with_logs_while_debugging/

## Why this should exist (ponytail rung 1)
The intelligence needed is already in the log file — timestamps, level words, message shapes — but grep treats every line as an opaque string; a reader that *parses what's already there* (time, level, message, the multi-line stack that belongs to the record above it) cannot be replaced by `grep -E`, because grep's model has no records, only lines.

## The people hurting
Anyone debugging on a machine where the logs are: the fresher from the thread, the on-call engineer SSH'd into prod at 2am, the dev triaging a CI job's log dump — anyone without a log platform one `ssh` away from the problem.

## Scope
- **30-minute floor (fallback):** JSON logs only, `-level` + `-since` filters. That's it.
- **Today's target:** a CLI that reads a file (or stdin), auto-detects the format (JSON / apache CLF / plain incl. logfmt-ish `level=` lines), parses each line into a record with time + level + message, attaches following non-timestamp lines (stack traces) to the record above them, then prints the records that pass `-level error,warn` and a `-since`/`-until` time window — collapsing consecutive duplicate records (same message + stack) into one line with `×N`. Exit codes follow grep: `0` matched · `1` nothing matched · `2` cannot check (missing file, unparseable input, usage error) — a drop-in upgrade for existing grep pipelines.
- **Deliberately NOT building:** no ingestion agents, no log storage/indexing, no UI, no "smart" pattern learning, no remote sources (S3/syslog), no log *writing*. It reads a file and prints a smarter view than grep.

## Stack of the day
**Go** — the series' stretch day and first Go on a deadline. Stdlib only: `encoding/json`, `time`, `flag`, `bufio`. Maps to the highest-paid language tier (DevJobScanner) and the platform/infra remote-role monoculture; Go CLIs are also a single static binary strangers can run without installing a runtime.

## Definition of done
A stranger can run `loglens fixtures/app.log -level error -since 30m` and in under 5 seconds see error-level records inside the time window with duplicate stack traces collapsed to `×N`, a stats footer on stderr (shown / skipped-unparseable / collapsed), and exit code 0 — verified against a fixture log with planted duplicates, mixed formats, and junk lines.
