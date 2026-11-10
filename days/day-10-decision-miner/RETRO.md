# RETRO — Day 10: decision-miner

> No retro, no post. The post is a byproduct of the work.

## What I learned
- **Technical:** The LLM trust boundary is a *set of small deterministic rules*, not a prompt: (1) evidence floor — a quote must fold to ≥8 chars before substring verification, because pure combining-marks fold to `""` and `"" in anything` is True; (2) verification and citation are different checks — a quote can exist in the joined text yet pin to no line, and an uncited item is a broken promise, so unpinnable claims drop; (3) merges are kind-scoped and pointer-transferring — an LLM *question* quoting a decision's line must not delete the decision, and when the model returns both sides of a reversal pointer-less, the dedup must carry the pointers or the strike-through story silently dies. Plus two platform facts: `str.splitlines()` breaks on `\r \v \f \x85`, not just `\n` — split on `\n` yourself, normalize CRLF, and treat a `\r`-only file as old-Mac; and BrokenPipeError fires at the interpreter-shutdown *flush*, where no handler lives — flush inside the try or `| head` tracebacks.
- **Meta:** The day's thesis graded itself: a fresh-context reviewer returned 23 findings and **zero were in the deterministic core — every HIGH/MED lived on the LLM seam** (the failure path, the vacuous quotes, the merge). When your tool's whole point is "don't trust the model," your bugs will be exactly where you trusted the model. Also: my wrong-assertion count hit four — an F8 regression test asserted over *all items* (decisions carry `owner=None`) while the tool was right; assertions get written by the same tired brain that wrote the bug.

## Reusable artifact
`llm_extract` + `merge_llm` in `decision_miner.py` (~90 lines) — the series' **verified-claims harness**: structured LLM output where every claim must carry verifiable evidence, unknown entities null out, items re-anchor to source position, failures exit named with the grounded fallback printed. D16 (etsy-tag forge) and D20 (review-responder) are the named Next.js importers (Zod-validated constrained output is the same rule in TS); D21's show-notes engine inherits it five-output-wide. The transcript parser (VTT voice tags, cue-ts inheritance, NOTE/STYLE blocks, SRT) rides along free.

## Ponytail debt created
7 markers (curated speaker stop-sets, reversal links most-recent-only, naive sentence split, curated due vocabulary, named-committer-must-speak refusal, cue-precision idioms, unvalidated `[99:99]` timestamps echoed) — ledger 38 → 45, all with named triggers.

## Numbers
- Time spent: ~3h 20m (inside the 3–4h build-day box, incl. ~19m adversarial-agent wall time)
- Token spend (est.): ≈8.2M — ~4.1M the adversarial agent (48 tool uses, 23 findings each reproduced twice), ~4.1M build + validation + this retro
- Self-check passing: yes — 63 checks (42 before the adversarial pass; +21 named regressions)

## Tomorrow
Day 11 (proof-of-work reporter): D08's git-digest extraction trigger fires — it is the named first importer of `parseLog`/identity-filter; carry today's rule whole: commits are evidence, every bullet cites one, "never invent work" is the quote-verification of git.

## Honest failures
- **The `--llm` path shipped with a lying exit code.** Endpoint failures escaped as tracebacks with exit 1 ("nothing decidable") — in the FIRST shipped commit's predecessor, caught by the adversarial pass, not by my 42 checks. My fakes were too polite: they returned well-formed JSON.
- **My verifier verified nothing for vacuous quotes** — the exact class of bug the tool exists to catch in models, present in the tool that catches it.
- **Wrong assertion No. 4** (F8 test): asserted over all items instead of actions; the tool was right, the check lied. Fixed by re-deriving from the fixture, not from the code.
- **Two edit artifacts in my own test file** (a half-deleted `if False else`, an eaten `def` line that silently re-parented a test) — caught by counting tests (41 ≠ 42), not by green checks. Green lies when the suite shrinks unnoticed.
- **No real-LLM smoke:** no key in env (session harness tokens are not for product use — D08 rule); the LLM seam is verified against scripted fakes + a real garbage HTTP endpoint. A real smoke needs a user-supplied key (flagged).
- **zsh `===`-expansion** ate two check chains before I noticed (`echo ===` is `=cmd` expansion in zsh); a failed separator silently skips the checks after it. Quote your separators.
