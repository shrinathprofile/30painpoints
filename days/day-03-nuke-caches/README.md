# nuke-caches

**Day 03 of 30** · [Retro](RETRO.md) · [Build log](BUILD-LOG.md)

> "a single click 100% reliable way to nuke caches, regardless of OS" — top-voted reply (186 points) in r/webdev's "What is a tool you wish existed?"
> [thread →](https://www.reddit.com/r/webdev/comments/17u929n/what_is_a_tool_you_wish_existed/)

A zero-dependency CLI that finds every dev cache on your machine — npm / pnpm / yarn (via each tool's **own** path lookup), Vite and webpack dirs in a project, DNS per platform — prints the bytes reclaimable, and clears them in one command.

**Plan by default.** A bare run touches nothing; `--go` clears. Package-manager caches go through each PM's own clean command (never a hand-rolled rm of a store), and `rm -rf` is restricted to the two documented-disposable bundler dirs. Bytes reclaimed are **re-measured** after each clear — never taken from the clean command's word.

## Run it

```bash
# needs Node ≥ 22.18 (native TypeScript type-stripping — no build step, no deps)
node nuke-caches.ts                 # plan: what's here, bytes reclaimable
node nuke-caches.ts --go            # actually clear it
node nuke-caches.ts --dir /path     # bundler caches of another project
```

That's the whole install. There is no `npm install`.

## What it looks like

Plan (real run — this machine, plus the bundled demo fixture):

```text
nuke-caches — fixtures/demo-project (darwin, dry-run)

 ✓ npm cache             12.5 GB  /Users/you/.npm
 ✓ pnpm store             1.3 GB  /Users/you/Library/pnpm/store/v10  (prune removes only unreferenced packages)
 · yarn cache           yarn not on PATH
 ✓ Vite optimize cache    1.0 KB  .../demo-project/node_modules/.vite
 ✓ webpack/babel cache    2.0 KB  .../demo-project/node_modules/.cache
 ✓ DNS resolver         flush

5 of 6 targets · 13.8 GB reclaimable — rerun with --go to clear
```

`--go` (real run — sandbox with the real npm pointed at a disposable cache):

```text
 ✓ npm cache             30.0 MB  /tmp/nuke-real/npm-home
 ✓ Vite optimize cache    100 KB  /tmp/nuke-real/proj/node_modules/.vite
 ✓ DNS resolver         flush

 ✓ npm cache            cleared 30.0 MB
 ✓ Vite optimize cache  cleared 100 KB
 ✓ DNS resolver         flushed (killall skipped: No matching processes belonging to you were found)

cleared 30.1 MB across 3 target(s)
```

The killall note is honest reporting, not an error: on macOS a non-root `killall` cannot signal root's `mDNSResponder`, so `dscacheutil -flushcache` (which works) is the flush and the HUP is best-effort.

Exit codes: `0` fine · `1` a clear failed · `2` usage error.

## Targets

| Target | Discovery | Clear | Bytes |
|--------|-----------|-------|-------|
| npm cache | `npm config get cache` | `npm cache clean --force` | re-measured |
| pnpm store | `pnpm store path` | `pnpm store prune` (only unreferenced — labeled as such) | re-measured |
| yarn cache | `yarn cache dir` | `yarn cache clean` | re-measured |
| Vite | `<dir>/node_modules/.vite` | rm (documented-disposable) | re-measured |
| webpack/babel | `<dir>/node_modules/.cache` | rm (documented-disposable) | re-measured |
| DNS | darwin / win32 / resolvectl / systemd-resolve | platform flush command | n/a |

Discovery instead of hardcoded paths is the "regardless of OS" part: this machine's pnpm store is `store/v10` — a versioned path a hardcoded `~/Library/pnpm/store` would have gotten wrong on the next pnpm major.

## Validate it works

```bash
npm run check    # 15 assert-based checks: plan/discovery/miss table, --go with a fake world
                 # that records every destructive call, dry-run-touches-nothing, CLI edges,
                 # and the day-01 symlink-bin regression
```

Self-checks are deterministic (world injected, `NO_COLOR` forced). Real-run validation before shipping: dry-run on this machine (npm 12.5 GB, pnpm store discovered), full `--go` with the **real** npm against a disposable cache dir (30 MB cleared, re-measured), real `pnpm store prune` against a disposable store, real DNS flush — details in the [build log](BUILD-LOG.md).

## Deliberately not built

No browser-cache clearing (sandboxed, per-browser rabbit hole), no Windows service tricks (beyond `ipconfig /flushdns`, untested — no Windows box), no bun/gradle/cocoapods ecosystems, no full pnpm store rm (prune is the safe official op; a hard-nuke flag is the upgrade trigger). Every cut is marked in the code with a `ponytail:` comment.

## Files

- `nuke-caches.ts` — the tool (273 lines, stdlib only)
- `self-check.ts` — the one runnable check
- `fixtures/demo-project/` — a project with planted Vite/webpack cache junk
