# proof-report

**Day 11 of 30** · [Retro](RETRO.md) · [Build log](BUILD-LOG.md)

> "My company tracks whether you open Slack within 15 minutes of start" — **8.8K upvotes, 479 comments** on r/remotework; presence surveillance is remote work's hottest wound
> [thread →](https://www.reddit.com/r/remotework/comments/1t2focv/my_company_tracks_whether_you_open_slack_within/)

A zero-dependency TypeScript CLI that compiles your day's commits into a **shareable proof-of-work report** — one receipt line per commit with a short hash, headline stats, tickets and areas. The counter-argument to the green dot: **output, not online-status.**

- **Receipts, not prose.** Subjects print VERBATIM (sanitized, clipped at 100 runes) with 7-char hash prefixes — every line is one `git show <hash>` away, for you or anyone you share it with. No LLM pass, deliberately: a proof report with generated narrative is a weaker proof.
- **Stats that argue the case.** Commits, files touched, +insertions −deletions (binary files count, contribute no phantom lines), doc files, ticket keys harvested from anywhere in subjects, area tally. Summed over the window you choose.
- **The span line stays honest.** `landed 09:41 → 18:42` is when work LANDED (first→last commit) — never hours-at-desk. A tool answering presence surveillance must not smuggle presence back in.
- **The reuse story is the point.** Window math, identity filtering, truthful refusals, and display safety all come from [`packages/git-digest`](../../packages/git-digest/) — extracted verbatim from day-08 **today** (day-08's brief named day-11 "the first importer"). The extraction deleted ~120 lines from a shipped day; day-08's byte-precise 41-check suite passed unchanged, and that suite now pins the package.
- **Exit trichotomy (day-04/05 carry-over):** `0` report · `1` no commits in window (honest empty) · `2` cannot check — not a repo, bare repo, git unavailable, zero-commit repo, bad flags. Refusals name the *true* reason.

## Run it

```bash
# needs Node ≥ 22.18 (native TypeScript type-stripping — no build step, no deps) and git
node proof-report.ts                    # yesterday 00:00 → now, in the current repo
node proof-report.ts ~/work/myrepo      # any repo path
node proof-report.ts --days 3           # wider window
node proof-report.ts --me               # YOUR proof (git config user.email/name, two-pass identity)
node proof-report.ts --since 2026-11-04 # explicit local-midnight start
```

Paste the Markdown anywhere a human reads. Run it on yourself; share what it prints.

## What it looks like

Real run on this series' own repo, pinned clock (`PROOF_REPORT_FAKE_NOW=1794270342 node proof-report.ts --days 2` — the repro knob; output re-derives byte-for-byte):

```text
proof of work — 2026-11-10 (window Nov 8 00:00 → Nov 10 10:55 · 6 commits)

**6 commits · 36 files · +4726 −5 · 12 docs** · landed Nov 9 12:19 → Nov 10 10:55

- `39f85e7` day-10: validation pass — root README index +D10 line (missing, same miss as D06); 2 ledger rows had…
- `1599b12` day-10: close — retro, learnings (D10 entry: verified-claims harness, evidence floor, splitlines/brok…
- `69523dd` day-10: decision-miner — 'Is there anyone else who forgets what was decided in the meetings?' (r/rem…
- `64cef9b` day-09: validation pass — debt ledger +1 (fmts formatter cache marker was in code but missing fro…
- `633a3b0` day-09: close — retro, learnings (D09 entries), debt ledger +3 markers; LINKEDIN-POST.md drafted…
- `32976d5` day-09: overlap-planner — 169 votes for 'boss schedules meetings at 11pm my time because it works…

**areas:** day-09 ×3 · day-10 ×3

every line is one `git show <hash>` away — output, not online-status.
```

(No ticket line in this window — day-NN prefixes are lowercase, not ticket keys; absence is honest.) Validated against this repo's full 30-day window too: 27 receipts, stats matching an independent re-computation of the same numstat stream exactly (+15121 −143 · 142 files · 47 docs).

## How it decides

| Decision | Rule | Why |
|----------|------|-----|
| Receipts | verbatim subjects + `hash.slice(0,7)` | a receipt the tool edited is a weaker receipt; 7 chars resolves in `git show` |
| Stats | `--numstat` summed per in-window commit; binary `-` counts the file, not lines | git's own numbers, no invented precision |
| Merges | excluded (`--no-merges`) | a merge's combined diff would double-count its parts |
| Window | package `windowFilter`: JS filters author date (`%at`), future-dated excluded AND counted | git's `--since` filters committer date — a rebase must not hide work (D05/D08) |
| `--me` | package `filterMine`: email authoritative when it matches anything, name only on zero email matches | a same-name stranger must not enter your proof (D08 F3) |
| Sorting | newest first; areas count-desc then codepoint asc, "unlabeled" last | chosen, not inherited; byte-stable, no locale (D02/D08) |
| Corrupt records | strict-shape-or-inert: header must be 5 fields / digit ts / 40- or 64-hex hash; stat lines must match `ins\tdel\tpath` | counted and named, never guessed at — a shifted record can't silently erase or fake a commit |
| Control chars | package `sanitize`: Unicode control pictures (␇ ␍ ␛) | a hostile commit subject can't repaint a terminal (D06/D08) |
| Empty day | exit 1, "no output to report is an honest sentence" | the tool must not pad — that's the green dot's lie |

## Validate it works

```bash
npm run check    # 36 assert-based checks: hand-counted porcelain fixtures (counted twice),
                 # scripted-world run() paths, CLI exit matrix, real-git end-to-end (binary files,
                 # renames, merges, SHA-256 object format, C-quoted non-ASCII paths, UTC-gap and
                 # UTC−12 --since boundaries, determinism), TZ-safe epochs
```

Cross-verified: day-08's 41-check suite (unchanged) passes against the extracted package — both suites green under TZ=UTC, Kolkata, Los Angeles, UTC+14, UTC−12. Then a fresh-context adversarial pass (every finding reproduced twice): **9 findings — 1 wrong-result (git C-quotes non-ASCII paths, so quoted `.md` files missed the docs count — fixed at the parse seam), 1 wrong-reason (nonexistent root said "not a git repository"), 3 cosmetic, 4 test-gaps — all fixed or pinned, one named regression each.** Findings and fixes in the [build log](BUILD-LOG.md).

## Deliberately not built

No LLM pass (receipts, not narrative — also the scope line vs day-08), no Slack posting, no boss-facing dashboard, no monitoring of anyone else, no multi-repo org mode, no HTML output (Markdown pastes everywhere), no repo-name inference (a subdir basename would name the wrong thing). Every shortcut is marked in code with a `ponytail:` comment naming its ceiling and trigger.

## Files

- `proof-report.ts` — the tool (stdlib + `packages/git-digest` only)
- `self-check.ts` — the one runnable check (36 checks)
- `package.json` — `npm run check`, engines pin
- [`../../packages/git-digest/`](../../packages/git-digest/) — the day's other deliverable: day-08's parsing core, extracted verbatim, pinned by two days' suites
