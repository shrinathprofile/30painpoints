# todo-debt

**Day 05 of 30** · [Retro](RETRO.md) · [Build log](BUILD-LOG.md)

> Devs in r/webdev's "tool you wish existed" thread mourned the dead npm package that collected TODO comments into one list (40-point reply) — "later never comes" is the perennial debt-talk underneath
> [thread →](https://www.reddit.com/r/webdev/comments/17u929n/what_is_a_tool_you_wish_existed/)

A zero-dependency TypeScript CLI + a 25-line workflow that makes marker-comment debt **visible and ratcheted**:

- **index** (default): walks *tracked* files (`git ls-files`), matches TODO/FIXME/HACK as whole words (or your own `--markers TODO,ponytail`), and lists every hit with **author and age from `git blame`** — never dates parsed out of comments. Sorted oldest first. Informational: existing debt exits 0.
- **ratchet** (`--base <ref>`): diffs marker lines added vs removed across `base...HEAD`. Net-new debt → **exit 1**; pay-down or net zero → exit 0. A rename moves debt without tripping the ratchet; a reformat adds-and-removes the same line and nets zero.
- **PR report** (`--post`, drift mode only): one living comment per PR — our marker comment is found and **updated**, never duplicated. Clean PRs get no comment; a previously-flagged PR that repays gets its comment flipped to ✅ repaid.
- Exit trichotomy (day-04 carry-over): `0` clean · `1` drift found · `2` cannot check (not a repo, bad ref, shallow clone, missing PR config) — a broken check never reads as "no debt" or as "drift".

## Run it

```bash
# needs Node ≥ 22.18 (native TypeScript type-stripping — no build step, no deps) and git
node todo-debt.ts <any-repo>                        # the debt index, oldest first
node todo-debt.ts <any-repo> --markers TODO,ponytail  # custom markers, case as-given
node todo-debt.ts <any-repo> --base HEAD~1          # did the last commit add net-new debt?
```

In your repo: drop `todo-debt.ts` anywhere, paste [`workflow-example.yml`](workflow-example.yml) as `.github/workflows/todo-debt.yml` — every PR gets the index in the run summary and the drift report as a PR comment.

## What it looks like

Real run, 2026-11-03, **on this series' own repo** with its own debt discipline as the marker (`--markers ponytail`) — the tool indexing the very `ponytail:` ledger it was built from:

```text
todo-debt — /Users/shrinathkhadake/Documents/linkedin30 (markers: ponytail · 59 tracked file(s))
    8d  Shrinath Khada ponytail PONYTAIL-DEBT.md:3          -debt. Every shortcut names its ceiling
    8d  Shrinath Khada ponytail README.md:7                 ** discipline (std-lib before dependenci
    8d  Shrinath Khada ponytail days/day-01-env-doctor/env-doctor.ts:30  unparseable → 0.0.0; only
    ...
 53 item(s) · 21 file(s) · oldest 8d
```

And the ratchet firing on this repo's own history — day-04's commit added 14 `ponytail:` markers:

```text
todo-debt drift — HEAD~2...HEAD (14 added · 0 removed · net +14)
 + days/day-04-docs-drift/docs_drift.py:73  ponytail  only paths/methods/params compared — schema, ...
 + days/day-04-docs-drift/docs_drift.py:141 ponytail  YAML only if pyyaml already exists in the app's ...
 ...
net +14 → this change adds debt → exit 1
```

## How it decides

| Decision | Rule | Why |
|----------|------|-----|
| Debt age/author | `git blame --line-porcelain -w`, author-time → days | git is the provider; dates inside comments rot the moment someone reformats the line |
| File set | `git ls-files` (tracked only) | respects .gitignore for free; a TODO enters the ledger when it's committed — that's when it becomes debt |
| New debt | marker lines on `+`/`-` sides of `git diff --unified=0 base...HEAD` | the diff is the provider; three-dot gives PR semantics (merge-base) even on diverged branches |
| Ratchet math | net = added − removed | pays down while spending; renames and reformats net zero by construction |
| Existing debt | exit 0, informational | a repo with 200 TODOs failing CI forever is how teams learn to ignore a tool |
| Uncommitted lines | shown as `uncommitted`, age `—` | staged debt hasn't been accepted yet — display it, don't guess a birthday |
| Blame failure / unreadable file | row with `?` + footnote, run continues | one bad file (gitlink, permissions) must never kill the report |
| Posting | marker-comment read-back, update-in-place (day-02 idiom) | state that isn't stored can't drift |

Exit codes: `0` clean/informational · `1` net-new debt in `--base` mode (or `--post`… see below) · `2` cannot check — bad ref, not a repo, or `--post` misconfigured (validated **before** diffing, so a broken action fails fast instead of reporting drift and dying half-delivered).

## Validate it works

```bash
npm run check    # 28 assert-based checks: marker/diff/blame tables, scripted-world run() paths
                 # (posting, exit trichotomy), real-git end-to-end (ratchet fires, repay passes)
```

Real-world validation before shipping: full index on this repo (53 `ponytail:` items, ages 3–8d, matching `PONYTAIL-DEBT.md`'s 18 code markers + prose mentions), drift vs `HEAD~1`/`HEAD~2` (net 0 / net +14 → exit 1), exit-code matrix pipe-free, and adversarial probes: CRLF files, no-trailing-newline files, spaces and ünicode in paths, a 100%-rename carrying debt (no trip), a whitespace-only reformat (net 0), empty repo, unborn HEAD, a gitlink entry. Post-ship re-run found four more (ünicode paths dropped from the index, `color.diff=always` faking a green ratchet, `@todo` never matching, `--post` without a token not failing fast) — see the [build log](BUILD-LOG.md#post-ship-validation-re-run).

## Deliberately not built

No issue-tracker sync (TODO→issue is a write into someone else's system), no dashboards, no "AI prioritization", no per-author leaderboard, no TODO auto-deletion, no pagination past 100 PR comments, no `-C` cross-file move attribution (blame's author is the last toucher — a moved line keeps its note but re-stamps its owner; that's git's semantics, not a bug to paper over). Every cut is marked in the code with a `ponytail:` comment — this tool's own markers are in its own report.

## Files

- `todo-debt.ts` — the tool (373 lines, stdlib only)
- `workflow-example.yml` — the copy-paste PR ratchet (this file is the "Action")
- `self-check.ts` — the one runnable check (28 checks)
- `fixtures/` — realistic `--line-porcelain` and `--unified=0` captures the parser tests run against
