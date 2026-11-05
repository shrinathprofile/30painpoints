# Ponytail Debt Ledger

Regenerated weekly via /ponytail-debt. Every shortcut names its ceiling and upgrade trigger.

| File:Line | Simplified | Ceiling | Upgrade trigger |
|-----------|------------|---------|-----------------|
| day-01/env-doctor.ts `parseVersion` | unparseable version → 0.0.0 | only fed strings we chose to trust | first third-party version string parsed |
| day-01/env-doctor.ts `satisfiesComp ^` | `^0.x` treated as "same major" | correct for runtime engines, wrong for package deps | reuse in a package-dependency context |
| day-01/env-doctor.ts `satisfiesRange` | PEP 440 exclusive ranges (`3.9-3.12`) unsupported | requires-python never uses them in the wild | first real-world sighting |
| day-01/env-doctor.ts `scanRepo` | `engines.npm` unchecked | ~500ms spawn for a version nobody pins | user report |
| day-01/env-doctor.ts header | single-file CLI, `parseArgs` over commander | one flag, one positional | a second subcommand |
| day-02/stale-pr.ts `createApi` | one page of PRs (oldest-activity-first) | covers every team in the complaint | a repo with >100 simultaneously-stale PRs |
| day-02/stale-pr.ts `lastPingDate` | any comment containing our exact HTML marker counts as ours | marker string is unguessable in practice | first spoofing report |
| day-02/stale-pr.ts `createApi` | no retry on 403 secondary rate limits | scheduled daily run, ~5 calls | a run that dies to rate limiting |
| day-02/stale-pr.ts `isStale` | approved-but-unmerged PRs read as "waiting" | still a stuck PR, nudge is fair | complaints about nudging approved PRs |
| day-02/stale-pr.ts header | single-file CLI, `parseArgs` over commander | one positional + 4 flags | a second subcommand |
| day-03/nuke-caches.ts header | single-file CLI, `parseArgs` over commander | two flags + one positional | a second subcommand |
| day-03/nuke-caches.ts `dnsFlush` + `realSh` | win32 branch (`ipconfig /flushdns`, `shell` for `.cmd` PM shims) untested | documented one-liner, no Windows box to verify | a Windows user report |
| day-03/nuke-caches.ts `realDirSize` | apparent bytes, symlinks skipped, no hardlink dedup | before/after deltas stay truthful | a wildly-off-total report vs `du` |
| day-03/nuke-caches.ts registry | pnpm hard-nuke not offered (`store prune` only) | prune is the safe official op | users explicitly asking to rm the whole store |
| day-04/docs_drift.py header | single-file stdlib CLI, argparse over click | one positional + one optional | a second subcommand or a second provider (non-FastAPI) |
| day-04/docs_drift.py `diff` | only paths/methods/params compared; schema, response-model and description drift invisible | param contracts are what break integrations | a user report asking for schema drift |
| day-04/docs_drift.py `load_documented_spec` | YAML accepted only if pyyaml already in the app's env | JSON is FastAPI's native export | a real repo whose only spec is YAML |
| day-04/docs_drift.py `load_documented_spec` | Swagger 2.0 rejected, not translated (basePath/definitions) | OpenAPI 3 is the standard FastAPI emits | a user report with a Swagger 2.0 spec |
| day-05/todo-debt.ts header | single-file CLI, `parseArgs` over commander | one positional + 4 flags | a second subcommand or a second VCS provider |
| day-05/todo-debt.ts `indexMarkdown` | summary table caps at 50 rows | console prints everything; summaries are for skimming | a summary someone needs to scroll |
| day-05/todo-debt.ts `createApi` | one page of PR comments (100) searched for our marker | update-in-place keeps our report near the top | a PR whose report lands off page 1 |
| day-05/todo-debt.ts `markerRegex` | marker words match in prose too (a doc mentioning "TODO-debt indexer" indexes) | grep has the same eyes | a user needing a code-only allowlist |
| day-05/todo-debt.ts `run` | one blame spawn per file-with-hits | fine at every sane repo size | a perf report on a huge repo |
| day-06/loglens.go header | single-file CLI, stdlib only, whole file buffered in memory | `-since` anchors to the newest timestamp, which needs the end of the file | logs too big for RAM |
| day-06/loglens.go `timeLayouts` | syslog year-less stamps keep year 0 | can't guess a year honestly | an absolute-window user with mixed syslog |
| day-06/loglens.go `collapse` | fingerprint is exact text, no id/number normalization | same crash + different request id = different crash | a user asking for fuzzy grouping |
| day-06/loglens.go `stackCap` | stack dumps capped at 10 continuation lines | the complaint is drowning, not missing data | a user needing the full trace |
| day-06/loglens.go `reorderArgs` | flag arity map listed by hand | three flags; a missed one stays Go-convention | a second flag day |
| day-06/loglens.go `parsePlainLine` | npm's counter-prefixed levels unrecognized (file reads plain-inert) | npm's format is its own dialect; shown, never guessed | someone asking for npm logs |
| day-06/loglens.go `apacheRe` | escaped quotes inside the request field are not parsed (line demotes to continuation) | rare producer; the rest of CLF is rigid | a user with such access logs |
| day-07/app `lib.ts` FRAME_H | fixed 40,000px frame height — pages taller are cut off at the bottom | inner page height is unknowable cross-origin; the tall-frame trick needs a fixed height | a real page whose tail matters |
| day-07/app `App.tsx` footer | blank-frame cause not detected (refused-embedding vs unreachable) | no cross-browser signal the parent can read; a guessed badge would sometimes point at the wrong cause | a reliable cross-browser detection API |
| day-08/standup-prep.ts `MAX_FETCH` | fetch capped at newest 1000 commits — an older window is silently short (the run prints a note when the cap is hit) | streaming `git log` complicates the injected-world seam for a case no sane repo hits | a real repo printing the cap note |
| day-08/standup-prep.ts `--me` two-pass | email-when-it-matches else name — a window MIXING old and new identities (pre/post-rebase emails) loses the old-email side | per-commit authorship needs mailmap (`%aN`/`%aE` + a real .mailmap), not heuristics | a user report of missing own commits with both identities in one window |

34 markers, all low-severity, all with named triggers.
