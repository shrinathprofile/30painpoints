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
