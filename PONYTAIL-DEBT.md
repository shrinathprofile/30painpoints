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
| packages/git-digest/git-digest.ts `MAX_FETCH` (moved from day-08 on D11) | fetch capped at newest 1000 commits — an older window is silently short (the run prints a note when the cap is hit) | streaming `git log` complicates the injected-world seam for a case no sane repo hits | a real repo printing the cap note |
| packages/git-digest/git-digest.ts `filterMine` `--me` two-pass (moved from day-08 on D11) | email-when-it-matches else name — a window MIXING old and new identities (pre/post-rebase emails) loses the old-email side | per-commit authorship needs mailmap (`%aN`/`%aE` + a real .mailmap), not heuristics | a user report of missing own commits with both identities in one window |
| day-09/app `lib.ts` `daySlots` | 48 real half-hour slots — on the anchor zone's 2 DST days/year the local day is 23/25h: fall-back days lose the last local hour, spring-forward bleeds into tomorrow (per-instant cell truth unaffected) | the complaint is "which band today", not transition-day planning | a user planning a meeting on a DST-transition date (adversarial F1) |
| day-09/app `lib.ts` `CITY_ALIASES` | ~90 hand-curated city aliases, not a geocoding dataset — a missed city falls through to the searchable IANA list (refusal with guidance, never a wrong guess) | aliases cover the complaint thread's cities + majors | a report naming a missed city |
| day-09/app `App.tsx` footer | no date picker — the grid anchors to today only | comparing a DST-transition date is a different question than "when can we meet today" | someone needing to compare transition dates side by side |
| day-09/app `lib.ts` `fmts` | one `Intl.DateTimeFormat` per zone cached forever, never evicted | bounded by the ~420 IANA zones a browser knows | a zone count where the cache visibly matters (realistically never) |
| day-10/decision_miner.py `_NAME_STOPWORDS` | curated speaker-label stop-set; a miss demotes the line to plain text | no wrong owner is possible, only a missed label | a report naming a mis-parsed speaker label |
| day-10/decision_miner.py `mine` reversal | a reversal supersedes the MOST RECENT decision only — bare "instead" removed from cues entirely | most meetings flip the immediately-prior call | a wrong-link report where the flipped decision wasn't the latest |
| day-10/decision_miner.py `_SENT_SPLIT` | naive sentence split — abbreviations (e.g. / etc.) split early | costs recall/precision only; the LLM pass reads nuance | a report showing real misses from bad splits |
| day-10/decision_miner.py `_DUE_VOCAB` | hand-curated date phrases; event anchors ("before the cutover") are not dates | covers the complaint's real due shapes | a report of a missed real due phrase |
| day-10/decision_miner.py `_owner_for` | a named committer who never speaks yields NO owner (refusal > guess) — "Sarah will send it" from a transcript where Sarah never talks is not mined | an unverified name as owner is worse than a missing action | reports of missed cross-team actions |
| day-10/decision_miner.py cue lists | precision ceiling — idioms/passives can false-positive ("dropping the ball", "budget will be approved") | the LLM pass is the precision path; the core must never invent | a report of a misleading cue hit |
| day-10/decision_miner.py `_TS_LEAD` | timestamps echoed unvalidated (`[99:99]` cited as-is) | garbage-in-garbage-out on the ts field; citations stay honest to the file | a report where a garbage timestamp misled someone |
| packages/git-digest/git-digest.ts `probeRepo` | "cannot change to" (nonexistent root) matched on git's stderr WORDING — a git that rewords it falls back to the not-a-repo reason (still exit 2) | git's message has been stable for years; unmatched degrades safely | a git release whose message differs |
| day-11/proof-report.ts `tally` | docs = unique `.md`-suffixed paths only — `.mdx`/`.rst`/`.adoc` don't count | markdown is the series' doc format | a repo whose docs live in another suffix and a user who says so |
| day-11/proof-report.ts `dequotePath` | non-fatal UTF-8 decode — malformed escaped bytes become U+FFFD | paths feed suffix tests and Set keys, never re-encoding | a need for byte-exact recovered paths |
| day-11/proof-report.ts `renderReport` | landed-span rendered at minute precision — a sub-minute first→last span shows one time | cosmetic; localHM drops seconds | a user who schedules from the report |

49 markers, all low-severity, all with named triggers (D11: +4, and 2 D08 rows re-referenced to the package their markers moved into).
