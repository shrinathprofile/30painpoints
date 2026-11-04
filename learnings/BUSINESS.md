# Business Learnings

> One entry per day, max. Actionable tomorrow or it gets cut. See [rules](README.md).
> Covers: content strategy, hooks, audience, positioning, distribution, inbound signals.
> Raw post numbers live in a private metrics log; this file is the *interpretation*.

<!-- Format:
### D01 — title
- what I did / what happened
- rule extracted
-->

## Week 1 — Developer pain

### D01 — Launch pattern: evidence numbers + one caught AI mistake
- Did: opened the series with a number-led hook (504 / 198, verbatim quote) — the top hook type in the benchmark corpus (31% of winners). Scored 39/50 on the fallback scorer.
- Rule: every daily post must contain (a) the complaint's evidence numbers, and (b) one honest "AI shipped this wrong, I caught it" moment. The second is the differentiator against generic build-in-public noise — it's the judgment signal recruiters actually read for.
- Rule: repo link goes in the first comment, never the body (LinkedIn deprioritises outbound links).
- Revisit (D10): once 10 posts have metrics logged, switch post-scorer from benchmark fallback to own-data scoring.

### D02 — Third-party repos are free proof
- Did: validated the tool read-only against denoland/deno and led the post assets with *their* numbers (PRs waiting 440 days) instead of my own demo fixture.
- Rule: when a tool reads public data, the demo IS the evidence — run it on a name everyone recognizes and screenshot the real output. Borrowed credibility beats manufactured demos.
- Rule (repeated, D01): the day's caught-mistake moment is the sort-order bug — "every test passed while the tool was useless on busy repos" is a better story than any feature list, and it's true.

### D04 — The caught-mistake streak is now the series' signature beat
- Did: validated read-only against TobikoData/sqlmesh (25 endpoints, in sync, exit 0 — on all three of their committed specs, including one from last September). The real run also produced the day's bug: their old code crashed at import and the tool exited 1, the drift code.
- Rule (D02 repeated): run it on a name the audience recognizes — "in sync on sqlmesh" says more about the tool than any fixture, and the streak sentence ("day 1 npm's bin link, day 2 GitHub's default sort, day 3 root's mDNSResponder, day 4 a broken import reading as drift") turns four bugs into one compounding judgment signal.
- Rule: when the evidence thread can't be re-fetched (Reddit bot wall), the post leans on the series' own numbers instead — never invent upvote counts; the honesty IS the brand.

### D07 — A deployed live link is the strongest launch asset so far
- Did: shipped the series' first deployed tool (GitHub Pages, orphan gh-pages branch from dist, verified on the live URL before posting). The demo needs zero setup: click the link, type any site, see five widths. Self-demoing hash links (`#https://…`) make shared URLs render the wall pre-loaded.
- Rule: on visual days, the live link leads the post assets and goes in the first comment with the repo — "try it now" beats "here's a screenshot". Verify the deployed artifact (not the dev server) before claiming it live — deployed-base-path bugs (asset 404s) only exist in production builds.
- Caught-mistake beat (the series' signature, D01): the selfcheck that was green in Node but false in the browser — "my own test suite certified behavior the real browser doesn't have" is the day's honest-AI-moment line.
- Meta: the root README index had silently missed day-06 (the D04 failure repeated). Fixed both lines with an annotation — the miss itself became index copy; the check changes from "add today" to "verify every prior day".
