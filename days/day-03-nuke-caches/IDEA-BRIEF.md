# IDEA-BRIEF — Day 03: nuke-caches

> Written BEFORE any code. If any section is blank at build start, the build doesn't start.

## The complaint (evidence)
- **Subreddit:** r/webdev
- **Thread / quote:** In "What is a tool you wish existed?" (202 comments), the top-voted reply (**186 points**) is: "a single click 100% reliable way to nuke caches, regardless of OS."
- **Why I believe it's recurring:** cache junk is the canonical "why is my disk full / why is my build weird" genre — every dev accumulates multi-GB npm/pnpm stores and bundler caches, and the honest answer today is a blog post of per-tool commands (`npm cache clean --force`, `pnpm store prune`, `yarn cache clean`, `rm -rf node_modules/.vite`, `dscacheutil -flushcache`…) that nobody remembers under stress. The wish isn't a new capability; it's one command that finds every cache and clears it.
- **Source URL:** https://www.reddit.com/r/webdev/comments/17u929n/what_is_a_tool_you_wish_existed/

## Why this should exist (ponytail rung 1)
Every cache already has an official clear command; what doesn't exist is the one command that discovers which caches this machine actually has, shows the bytes, and runs the right clear for each — the aggregation IS the product.

## The people hurting
Any developer whose disk filled up or whose build went weird, and who today pastes five half-remembered commands from an old blog post — or worse, `rm -rf`s the wrong directory.

## Scope
- **30-minute floor (fallback):** clear the npm cache and one bundler cache, print bytes reclaimed. Done.
- **Today's target:** a zero-dependency TS CLI. Default run is a **plan**: it discovers every supported cache on the machine (npm / pnpm / yarn via each tool's own path lookup, Vite and webpack dirs under a project, DNS via platform command), prints bytes reclaimable per target. `--go` executes: the package manager's own clean command for PM caches (never a hand-rolled rm of a store), `rm -rf` only for the two documented-disposable bundler dirs, DNS flush per platform. Re-measures after each clear and reports actual bytes reclaimed. Exit 0/1/2 (ok / a clear failed / usage).
- **Deliberately NOT building:** no browser-cache clearing (sandboxed, per-browser rabbit hole), no Windows-specific service tricks, no bun/gradle/cocoa-pods ecosystems, no Docker image pruning, no "safe mode" heuristics beyond: plan-by-default, PM-owned commands for PM caches, rm restricted to the two bundler paths.

## Stack of the day
TypeScript CLI, native `node:child_process` calls — third zero-dep single-file CLI of the week (same harness discipline as Days 01–02: `node:util parseArgs`, native type-stripping, world injected for testability). Ponytail showcase: each cache is one stdlib call, no deps. Maps to TypeScript (#1 language demand) + the CI-able exit-code habit.

## Definition of done
A stranger can run `node nuke-caches.ts` in any project, see every cache on their machine with honest byte counts and what --go would do to each, then run `node nuke-caches.ts --go` and see actual bytes reclaimed — verified before shipping by a dry-run on this machine (real npm at 13 GB, real pnpm store at 2.9 GB), a full `--go` in a sandbox against the real npm with a disposable cache dir, and an assert-based self-check with a fake world that records every destructive call.
