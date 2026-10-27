# RETRO — Day 02: stale-PR wrangler

> No retro, no post. The post is a byproduct of the work.

## What I learned
- **Technical:** the API default you don't specify is a correctness decision you didn't make. The pulls list defaults to newest-created-first, which silently inverted the tool's purpose on busy repos (page 1 = the only PRs that *can't* be stale). No unit test can catch a provider-side default — only a real run can. Second: idempotency without state is possible if you mark your own outputs (dated HTML comment = the memory).
- **Meta:** Day 01's retro predicted this build ("inject the world — same pattern, bigger stage") and it held: `run(opts, api, io)` cost nothing to design because the decision was already made. The series compounding is real — day 2 moved faster *because* day 1 wrote down its rule.

## Reusable artifact
The **injectable-API harness**: `run(opts, api, io)` + a fake API that records every POST + a fixed clock (`now` parameter). Any future scheduled/GitHub-API day (Day 05's TODO indexer Action, Day 11's git digest) inherits it verbatim. Extract `createApi` + the fake into `packages/gh-harness` on the second consumer — not before.

## Ponytail debt created
Five markers (see BUILD-LOG) — pagination, marker trust, no 403-retry, approved-unmerged reads as waiting, parseArgs ceiling. All low-severity with named triggers. Ledger updated.

## Numbers
- Time spent: ~2.5h (build day, within the 3–4h box)
- Token spend (est.): ~160k across brief + build + validation + docs + post
- Self-check passing: yes — 17/17, plus 5 real-world paths (own repo, deno ×2, 404, summary writer) with exits 0/0/0/1/0

## Tomorrow
Day 03 (nuke-caches, light): third run of the zero-dep CLI harness — if the harness needs zero changes again, extract it to `packages/` (that's the two-consumer trigger firing).

## Honest failures
- The first version of the tool told me denoland/deno had no PRs older than 90 days. It actually had PRs waiting **440 days**. The bug was one query parameter — and every unit test passed while the tool was useless on exactly the repos it exists for. Real-run validation isn't a nice-to-have; it's the only test that catches provider-side lies.
- Day-01's `check()` helper, reused unmodified, would have false-passed async assertions. Caught at write time, but it's a reminder: inherited harnesses carry inherited assumptions.
