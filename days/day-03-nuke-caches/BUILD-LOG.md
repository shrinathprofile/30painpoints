# BUILD-LOG — Day 03: nuke-caches

> Appended in real time, not written at the end. Honest beats tidy.

## Decisions
| Time | Decision | Why |
|------|----------|-----|
| 0:05 | Plan by default, `--go` clears | Day 01's tool never touched anything; this tool's whole job is touching. The trust boundary moves, not disappears: show the blast radius (paths + bytes) first, act only on explicit consent. A "single click nuke" you can preview is more reliable, not less. |
| 0:10 | Discover cache paths from each PM (`npm config get cache`, `pnpm store path`, `yarn cache dir`) — no hardcoded paths | Day 02's lesson (provider-side defaults are correctness decisions) applied to filesystems. Validated the same day: this machine's pnpm store is `store/v10` — a versioned path the "obvious" hardcode gets wrong on the next major. |
| 0:15 | PM caches cleared via the PM's own command; `rm -rf` restricted to `node_modules/.vite` and `node_modules/.cache` | A store's internal layout is the PM's business; the two bundler dirs are disposable by documented contract. That split is the entire safety story. |
| 0:20 | Bytes reclaimed = re-measure after each clear, `max(0, before − after)` | The filesystem is the truth; clean commands underreport (pnpm), over-promise, or print nothing. A cache that *grew* during a clean (concurrent install) reports 0, never a negative. |
| 0:25 | pnpm line carries "prune removes only unreferenced packages" | `pnpm store prune` is honest-safe, not maximal: without the label, a 1.3 GB store that clears 0 B looks like a bug. With it, it's a feature. |
| 0:30 | Exit codes 0/1/2 (ok / a clear failed / usage) | Same CI-able convention as Days 01–02. |
| 0:35 | Byte totals are apparent bytes (file sizes), not `du` blocks | Consistent before/after deltas without spawning `du`; the delta is what's reported. Marked as debt: no hardlink dedup, symlinks skipped. |

## Rabbit holes
| Time lost | What happened | Lesson |
|-----------|---------------|-------|
| 15 min | **The killall bug (caught by the first real `--go`, not the self-check):** `killall -HUP mDNSResponder` exits 1 for non-root users — "No matching processes belonging to you were found" — because mDNSResponder belongs to root. Every fake-world test passed (fakes answer 0 for every dns call); the real run failed the whole DNS target and the tool exited 1. Fix: `required: false` on that command — a best-effort command's failure demotes to a note (`flushed (killall skipped: …)`), never fails the flush that worked (`dscacheutil`). Regression check added. | Day 02's lesson in local-command form: permission boundaries are provider-side behavior too. Fake worlds return status 0 for anything you didn't script to fail. |
| 15 min | **Post-ship validation (three crashes, all raw stacks + exit 1):** (1) unknown flag / `--dir` with no value / stray positional threw from `parseArgs` → exit 1, which the README reserves for "a clear failed" — now exit 2 with a one-line message. (2) An unreadable file inside a cache (root-owned files from `sudo npm i` — the classic) crashed the **dry-run** with EACCES; `realDirSize` now skips unreadable entries. (3) An `rm` hitting EACCES mid-`--go` crashed before DNS and the summary ran; each clear is now isolated, the failure is reported per target, exit 1. Also: win32 `spawnSync` refuses `.cmd` shims without a shell, so every PM would have read "not on PATH" on Windows — `shell` on win32 only (untested). Each fix has a check proven to fail against the shipped code. | The fake world's `dirSize`/`rm` never throw, so no check could see a throw. A recording fake proves *what* you called, not *that the call can't blow up* — script the failure modes of the real syscalls, not just of the commands. |
| 5 min | The first fake world auto-added discovered PM dirs to its exists-set, making the "reported a dir that doesn't exist → already empty" path unreachable in tests | Fakes must be faithful, not convenient — a fake that quietly repairs the world hides the branch that handles the world being broken. |
| 5 min | Two self-check assertions were wrong while the tool was right: the cleared-bytes total (wrote 15.3 GB, real sum 13.5) and the rounding of 214748365 B (wrote "204.8 MB", the tool's own ≥100-drops-decimal rule says "205 MB") | Tests written by the same author that wrote the bug also inherit the bug's arithmetic. The failures were honest: assert what the output IS, then check that's what it should be — in that order, or never. |

## AI vs me
| ZCode did | I did (chose / rejected / rewrote) |
|-----------|-----------------------------------|
| Wrote the tool, the fake world, self-check, fixtures, docs | Set the rule up front: "same logic as day 1" — brief-before-code, registry-as-data, injected world, assert checks, real-run validation, ponytail markers |
| First darwin DNS spec ran dscacheutil and killall as equal required commands | Chose the `required: false` demotion over the two alternatives: dropping killall entirely (loses the root-user case where it DOES work) or prepending sudo (interactive prompt inside a CLI — never) |
| Self-check summed reclaimed bytes to 15.3 GB and asserted it | Rejected my own arithmetic — recomputed by hand, the tool's 13.5 GB was right. Assertions fixed, not the tool |
| Measured fixture sizes via a zsh printf loop → a 53 KB "1 KiB" file | Rewrote the fixture with an exact-byte pad; byte-exact tests get byte-exact fixtures |

*This table is the judgment evidence. If it's empty, either the build was trivial or I wasn't steering.*

## Shortcuts marked
- `ponytail:` single-file CLI, parseArgs over commander — trigger: a second subcommand (same as days 01–02)
- `ponytail:` win32 DNS branch (`ipconfig /flushdns`) untested — no Windows box in this series yet — trigger: a Windows user report
- `ponytail:` dirSize = apparent bytes, symlinks skipped, hardlink dedup not done (du dedupes inodes) — totals can exceed `du`'s; the before/after delta stays truthful — trigger: a wildly-off-total report
- `ponytail:` no hard-nuke flag for the pnpm store (prune only) — trigger: users explicitly asking to rm the whole store

## The one check
`self-check.ts` — 18 assert-based checks: formatBytes table, dnsFlush per-platform, plan hits and all four miss modes, `--go` against a fake world that **records every clean/rm/flush** (proves PM cleans use their own commands, rm touches only the two bundler dirs, dry-run touches nothing), best-effort killall regression, negative-reclaimed clamp, CLI usage errors (bad `--dir`, unknown flag, missing value, stray positional → 2), throwing-target isolation, unreadable-dir plan, real sandbox dry-run + `--go` (PATH stripped of PMs → deterministic), and the day-01 symlink-bin regression. `npm run check`.

## Real-world validation (before shipping)
- Dry-run on this machine: npm **12.5 GB** discovered via `npm config get cache`, pnpm store **1.3 GB** at `store/v10` via `pnpm store path`, yarn correctly "not on PATH", DNS hit. Read-only, exit 0.
- Full `--go` in a sandbox with the **real npm** pointed at a disposable cache via `npm_config_cache`: 30.0 MB planned → `npm cache clean --force` → re-measured 30.0 MB cleared, exit 0.
- Same run, real `rm`: `node_modules/.vite` gone, `src/keep.me` intact.
- Real `pnpm store prune` against a disposable store: exit 0, reported **cleared 0 B** on a store holding unindexed junk — the note ("prune removes only unreferenced packages") is not decoration, it's pnpm's actual semantics, demonstrated.
- Real DNS: `dscacheutil -flushcache` ran; `killall` failed as root-owned → surfaced as note, target still ✓, exit 0.
- Bad `--dir` → exit 2.
- The host's real 13 GB npm cache was deliberately NOT cleared (validation used disposable dirs); running `--go` for real is the owner's call, not the builder's.
