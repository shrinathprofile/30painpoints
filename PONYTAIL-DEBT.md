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

14 markers, all low-severity, all with named triggers.
