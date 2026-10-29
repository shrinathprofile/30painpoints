# RETRO — Day 03: nuke-caches

> No retro, no post. The post is a byproduct of the work.

## What I learned
- **Technical:** permission boundaries are provider-side behavior — the third face of day-02's lesson. GitHub's API default ordering, the comments endpoint ignoring `sort`, and now `killall` refusing to signal root's daemon: all invisible to every fake in the test suite, all caught only by a real run. The local-command version adds a twist: the failure is *partial* (one command in a sequence), so the fix isn't "handle the error" but "know which commands are load-bearing and which are best-effort" — `required: false` is now a first-class field in the registry, not an exception handler.
- **Technical 2:** discovery beats hardcoding even for paths you "know". `~/Library/pnpm/store` is the answer today and `store/v10` is the answer on this machine — asking `pnpm store path` costs one subprocess and is never wrong. The same registry that renders the plan renders the discovery commands; a cache that can't be discovered is skipped with a reason, never guessed at.
- **Meta:** day-02's retro set a trigger: "third run of the zero-dep CLI harness with zero changes → extract to `packages/`." It fired and was overruled, on purpose: what repeats across days 01–03 is ~15 lines of idiom (parseArgs block, `paint`, realpath main-guard, `check()` helper). Extracting it turns three self-contained single-file demos — the thing a stranger can run with `node file.ts` and zero installs, which is the product story — into one package you must clone whole. The copy IS the interface. Re-armed trigger: the first day that must *import* another day's logic (day-11's git-digest reuse of day-08 is the likely first).

## Reusable artifact
The **recording fake world**: one factory scripting `sh`/`dirSize`/`exists`/`rm`/`onPath` and recording every destructive call (`cleaned`, `removed`, `flushed`), plus the PATH-stripped spawn pattern for deterministic CLI tests of a tool whose default world is the whole machine. Still copy-idiom per the decision above — `packages/` stays empty until an import actually happens.

## Ponytail debt created
Four markers (see BUILD-LOG): parseArgs ceiling, untested win32 DNS, apparent-bytes measurement, no pnpm hard-nuke. All low-severity with named triggers. Ledger updated.

## Numbers
- Time spent: ~2h (light day box, stretched by the killall fix + validation matrix)
- Token spend (est.): ~140k across brief + build + validation + docs + post
- Self-check passing: yes — 18/18 (15 at ship + 3 post-ship regressions), plus the real-run matrix in the build log (dry-run host, real-npm `--go` 30 MB, real pnpm prune, real DNS, exit codes 0/2)

## Tomorrow
Day 04 (docs-drift linter, 🔵 build day): Python + FastAPI — different ecosystem, same discipline. Concrete carry-overs: inject the world (FastAPI's route table is the provider — read it from the imported app, don't parse source), and validate against a real drifted repo, not just fixtures.

## Honest failures
- The first version of the tool exited 1 on a successful macOS DNS flush because `killall -HUP mDNSResponder` can't work without root. Every self-check passed. Shipped only because the real-run habit from days 01–02 (run the destructive path for real before calling it done) caught it in a sandbox.
- My own test assertions were wrong twice (a byte total, a rounding rule) while the tool was right both times. The adversarial pass that catches AI-authored bugs must review the *assertions*, not only the code under test — a wrong assertion is a bug wearing a green checkmark.
- Post-ship validation found three raw-stack crashes the 15 green checks never could: usage errors exited 1 (the "clear failed" code) instead of 2, an unreadable file in a cache (root-owned `~/.npm` after `sudo npm i`) crashed even the dry-run, and one EACCES `rm` aborted the rest of `--go` mid-run. The fake world's `dirSize` and `rm` can't throw, so nothing tested throwing. Plus the win32 PM spawn would have failed on `.cmd` shims. All fixed, each with a check verified red against the shipped code first.
