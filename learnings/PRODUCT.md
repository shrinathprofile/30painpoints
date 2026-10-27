# Product Learnings

> One entry per day, max. Actionable tomorrow or it gets cut. See [rules](README.md).

<!-- Format:
### D01 — title
- signal: what evidence said
- decision: the scope cut / build choice
- verdict will land: D+7 (revisit note)
-->

## Week 1 — Developer pain

### D01 — "Diagnose, don't touch" is the product
- Signal: 504 upvotes / 198 comments on r/webdev. A comment count that high means people *echoing* the pain, not solving it — a queue, not a discussion.
- Decision: diagnose-only CLI (no `--fix`). Tools that auto-fix your environment become their own debugging session; the trust boundary turned into the differentiator *and* a post section.
- Rule extracted: when the complaint is "setup dread", the MVP is clarity (what's wrong + the exact fix command), not automation.
- Verdict lands: watch Day-1 post comments for "does it fix it too?" — that's demand signal for a v2, not scope regret.

### D02 — Review latency is a visibility problem, not an enforcement problem
- Signal: r/ExperiencedDevs' top answer (571 pts) on "why does review take forever past 15-20 engineers" blames invisible waiting and unowned nagging — nobody's job is "look at the oldest PR first".
- Decision: a morning digest (oldest waiters, named rotation) + one nudge per window, read + comment only. No auto-assignment, no Slack escalation — bots that *force* process get muted; bots that *surface* age get answered.
- Rule extracted: when the complaint is "nobody notices", the MVP is a visible queue + a named owner per day, not workflow enforcement.
- Verdict lands: denoland/deno run (PRs waiting 440 days) is the post's proof — a stranger's repo, real numbers, no setup.
