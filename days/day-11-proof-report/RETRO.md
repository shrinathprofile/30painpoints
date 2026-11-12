# RETRO — Day 11: proof-report

> No retro, no post. The post is a byproduct of the work.

## What I learned
- **Technical:** Extraction-as-deliverable works when the proof already exists: day-08's byte-precise 41-check suite passed with zero edits after ~120 of its lines moved to `packages/git-digest` — the strongest verification of the day cost nothing new. The rules that made it safe: move verbatim (no drive-by "improvements"), lift inline blocks into named functions only where the second importer needs them, keep the package's `World` free of tool concerns (the LLM stays in day-08's local extension), and no package self-check — the importers' suites pin it, and the second importer shipped in the same diff so the package never existed speculatively. And the day's hardest bug came from a platform fact I'd never met: **git C-quotes non-ASCII numstat paths** (`文献.md` → `"\346\226\207\347\214\256.md"`), which made every ASCII fixture structurally blind to a wrong docs count — only adversarial EXECUTION (real repos, real filenames) found it; the fix decodes at the parse seam so the stored path is the real path.
- **Meta:** When the check and the implementation disagree, recount before debugging — my expectations were wrong three times today (a 7-items-"= 6" hand-count, a 3-char string counted as 2, a fixture commit I misremembered the author of) and the tool was right every time. The fixture builder lied about hashes FIVE times (non-hex chars, `"f0".repeat(40)` = 80 chars); the day's best engineering decision was making the builder validate its own output, which then caught two more latent lies at build time instead of inside a count. D05's lesson keeps compounding: builders that can't lie beat counters that double-check.

## Reusable artifact
`packages/git-digest` itself — the series' first cross-day package (parse kernel, windows, identity, truthful refusals, display safety, adapters), pinned by two days' suites. Plus `dequotePath` (git C-quote decoder) and the self-validating `H40` fixture-builder idiom. Named next importer: the D29–30 finale, if a git tool wins the audience vote.

## Ponytail debt created
4 new markers (45 → 49): `probeRepo` matches git's stderr wording for the nonexistent-root reason; `tally` counts only `.md`-suffixed docs; `dequotePath` decodes non-fatally (U+FFFD on malformed bytes); the landed-span renders at minute precision. Two day-08 rows re-referenced to the package their markers moved into (D10's marker↔ledger rule, file-motion corollary).

## Numbers
- Time spent: ~2h 45m (a light-day card that extraction made build-day-shaped — the ideas doc's "40 minutes because Day 08 extracted a package" was aspirational; the honest split is ~1h extraction + ~40m tool + the rest checks/adversarial)
- Token spend (est.): ≈5M — 1.6M of it the fresh-context adversarial agent (9 findings, every one reproduced twice, 1 wrong-result that shipped through my own suite)
- Self-check passing: yes — 36 checks (25 built + 11 adversarial regressions), and day-08's 41 unchanged, both green across 5 timezones

## Tomorrow
Day 12 (parking-lot): first browser extension (MV3, `chrome.storage`) — a delivery target with its own seams; the package idles until D29, which is fine, that's what "extracted when the second importer shipped" means.

## Honest failures
- **The docs-count bug shipped through my whole build and suite.** I wrote the numstat parser, hand-counted the fixtures, ran real-git end-to-end — all in ASCII, all blind. The adversarial agent found it in ~9 minutes by creating files named `文献.md`. Fixtures made of the characters I type are not the world.
- **I pinned a timezone-dependent date assertion in-process** — the machine runs UTC+10:30, where `2026-11-05T15:00Z` is Nov 6. Day-08 named this rule; I paid for it again before moving exact-time assertions into the forced-TZ subprocess check.
- **My first exit-code shell check read `head`'s exit status, not the tool's** — D01's pipe-free rule, violated by the operator in the very session that documents it.
- **The ledger-marker grep-miss reproduced:** my carried-over filterMine marker said `ponytail (carried from day-08):` — invisible to the `ponytail:` scan; D10 found this exact class yesterday and I generated a fresh instance today. Normalized; count now verified 6 ↔ 6.
