# BUILD-LOG — Day 01: env-doctor

> Appended in real time, not written at the end. Honest beats tidy.

## Decisions
| Time | Decision | Why |
|------|----------|-----|
| 0:05 | Zero deps, not commander | The ideas doc said "commander, zero other deps" — but `node:util parseArgs` covers everything a one-flag CLI needs. Ponytail ladder rung 2 beats the plan. |
| 0:05 | Ship TypeScript with no build step | Node ≥22.18 strips types natively; this machine runs 22.23. `engines` field declares it honestly. |
| 0:10 | `scanRepo(dir, probe)` — runtime versions injected | Self-check must be deterministic. Reading the machine inside the scanner would make fixture assertions machine-dependent (flaky for strangers). |
| 0:15 | `.nvmrc` full version → `~` semantics | A pinned `20.11.0` should accept any newer patch, reject older minor. Bare `20` → major match. |
| 0:25 | `.env` comparison, not `process.env` | The floor spec said compare against process.env; the file is what the app actually loads, and it survives across shells. |
| 0:30 | Exit codes 0/1/2 | 1 = findings (CI-able), 2 = usage error. Cheapest possible CI integration story. |

## Rabbit holes
| Time lost | What happened | Lesson |
|-----------|---------------|--------|
| 10 min | First x-range parser used stacked regexes (`/^\d+[.\-]?x?\*?$/` + friends) — unreadable and wrong for compound cases | Splitting on "." and inspecting parts is 4 lines and obviously correct. Regex density is a smell. |
| 5 min | engines fix string produced `nvm install 1820` — a strip-dots regex ate the range separator | Caught by the real CLI run, not the self-check (pure-function tests covered the range logic, not the message builder). Always eyeball the rendered output. |
| 5 min | zsh `PIPESTATUS[0]` showed fake exit 0 (bash-ism; zsh wants lowercase `pipestatus`, 1-indexed) | Validate exit codes without pipes in the way. |

## AI vs me
| ZCode did | I did (chose / rejected / rewrote) |
|-----------|-----------------------------------|
| Wrote the whole scanner, range parser, self-check, fixtures | Chose the injectable-probe design after catching that fixture assertions would otherwise depend on the host's node/python |
| First draft of x-range matching (regex pile) | Rejected it — rewrote as parts-split; flagged it as the SHRINK finding |
| Drafted fix strings for findings | Caught `nvm install 1820` in the real run and replaced the regex-mangling with a first-version-token heuristic |
| Suggested JSON output flag | Rejected — exit code already covers the CI case; --json is scope creep on day 1 |

*This table is the judgment evidence. If it's empty, either the build was trivial or I wasn't steering.*

## Shortcuts marked
- `ponytail:` unparseable version → 0.0.0 — only fed strings we chose to trust; upgrade trigger: parsing third-party version strings
- `ponytail:` `^0.x` treated as "same major" — correct for runtime engines, wrong for package deps; trigger: reuse in a package manager
- `ponytail:` PEP 440 exclusive ranges (`3.9-3.12`) unsupported — vanishingly rare in requires-python; trigger: first real-world sighting
- `ponytail:` `engines.npm` unchecked — spawning npm costs ~500ms for a version nobody pins; trigger: a user report
- `ponytail:` single-file CLI, parseArgs over commander — trigger: a second subcommand

## The one check
`self-check.ts` — 11 assert-based checks: semver-range table, env-key parsing, and end-to-end fixture scans under a fixed probe. `npm run check`.

## Pre-push review fixes
An edge-case pass before the first push found six bugs the 11 checks never exercised. All six are fixed, and each now has a self-check case (18 total). Every new check fails against the old code.
- Run through a symlink (npm `bin`, `npx`, `npm link`), it printed nothing and **exited 0**: a silent CI pass. Fix: realpath `argv[1]` before the entry-point compare.
- `">= 18"` (space after the operator) was read as the bare major `18`, so Node 22 failed. The old test used `">= 22"` and passed by coincidence.
- PEP 440 `~=`, `==X.*` and `!=` in `requires-python` all gave false errors.
- Hyphen ranges (`18 - 24`) gave false errors.
- A malformed `package.json` crashed with a stack trace. It's now an error finding with a fix.
- `.nvmrc` aliases `node` and `stable` were reported as errors. They now warn, like `lts/*`.

Lesson: tests written alongside the code only cover the cases the code already handles. Probe with the inputs real repos actually contain.
