# BUILD-LOG — Day 10: decision-miner

> Appended in real time, not written at the end. Honest beats tidy.

## Decisions
| Time | Decision | Why |
|------|----------|-----|
| 0:00 | fixtures written BEFORE the tool, expectations hand-counted twice (3 decisions / 6 actions / 4 questions on product-sync) | D05: the fixture is the contract; the tool's own output is never the oracle |
| 0:05 | stdlib-only core; heuristic cues are the product, `--llm` is an optional refinement — never the dependency | the complaint says Otter is paywalled; a key-gated answer to "free please" answers nothing |
| 0:05 | LLM injected as a world callable (`world.llm(env)`), env-config OpenAI-compatible endpoint — D08's `--llm` idiom verbatim | rung 2: the repo already has this seam shape; tests script it, no network |
| 0:10 | every LLM item must carry a verbatim quote that fold-matches a substring of the transcript, else dropped + counted | D09's handoff line: "validate shape at the edge, refuse loudly, never guess a decision" — hallucination is a trust-boundary problem, not a prompt problem |
| 0:10 | LLM items get line numbers by locating their quote in the parsed lines; report sorts by transcript position | D02: never inherit the provider's ordering — the model returns whatever order it likes |
| 0:15 | `Name: text` + `[HH:MM:SS]`/VTT/SRT parsing in one pass; cue-timing lines never vote on content but their timestamp is inherited by the text that follows | D06: decide who VOTES; timestamps are metadata, not lines |
| 0:20 | reversal = reversal-cue + decision-cue in one sentence → supersedes the most recent decision (both get pointers) | "forgets what was decided" is worst when the FIRST answer is the remembered one; grep shows both, none flags the flip |
| 0:25 | parking meta-talk ("take that offline", "table it") routes AROUND item-hood — it's talk about the discussion | first draft counted it as an action; re-read of the fixture killed it |
| 0:30 | FastAPI = one POST endpoint + one inline HTML page; no multipart (raw body: browser fetch and `curl --data-binary` share one path) | "drop a transcript file" is a browser action; python-multipart for one upload is a dep for nothing |
| 0:30 | output rendered with `textContent` into a `<pre>`, never innerHTML | zero-dep AND zero-XSS in one choice; a Markdown renderer lib would add an injection surface, not value |
| 0:35 | exit trichotomy 0/1/2 (report·honest-empty·cannot-check) including `--llm` undeliverable | D04/D08 carry-over; a linter whose "cannot check" looks like "nothing found" is a CI footgun |

## Rabbit holes
| Time lost | What happened | Lesson |
|-----------|---------------|--------|
| ~8m | first draft's `_QUESTION` used `[what|how|…]` — a CHARACTER class, so any sentence starting w/h/a/t/…? matched (the Thai-place smalltalk line was about to become an open question) | caught by hand-tracing before first run; regex char-class vs alternation is a re-read tax, always pay it before executing |
| ~6m | `str.splitlines()` breaks on lone `\r`/`\v`/`\f`/`\x85` — the hostile fixture's `sys\rtem` split into phantom lines and line numbers drifted from what an editor shows | split on `\n` only; stray controls stay in-line and get pictured. The PLATFORM's newline set is wider than yours |
| ~5m | `reversal = bool(cue) and decisions` aliased the same list `add()` appends to — truthy AFTER the add even when empty before (IndexError on a no-prior transcript) | `and list` doesn't snapshot; snapshot as `bool(list)`. Aliasing bugs look like logic bugs in the traceback |
| ~3m | `sanitize()` dropped `\r`/`\t` instead of picturing them; `_cite()` printed the speaker raw — raw BEL byte reached the terminal through the citation path | one sanitize must sit at EVERY render site; a second render path is a second leak |
| ~2m | zsh `echo ===` → `=cmd` expansion (`zsh: == not found`) silently ate my check chains | quote separators; a failed separator can skip the check that followed it |

## AI vs me
| ZCode did | I did (chose / rejected / rewrote) |
|-----------|-----------------------------------|
| drafted the full tool from the brief | rejected my own first draft before it ran: dead branch in `_owner_for`, char-class question regex, `PENDING_ID` pointer spaghetti in `render`, LLM merge deduping against summaries instead of quotes — rewritten before first execution |
| wrote fixtures + expectation table | hand-derived every expected count/cue match by tracing the regexes BY HAND first; that trace is what caught `we'll go with` missing from the decision alternation (D1 would have silently vanished) |
| wrote self_check.py | chose which 63 behaviors pin the contract (reversal pointers, alias-list regression, quote verification, order, exit matrix pipe-free, one named regression per adversarial finding) |
| ran the fresh-context adversarial pass (23 findings, each executed twice) | triaged ponytail-style: 18 fixed with named regressions, 5 marked as ceilings — refused the tempting "fix" of NER-grade owner detection; refusal already answers it |
| drove the browser + curl checks | chose the demo story: a reversal the tool flags, an action the LLM fabricates and gets dropped |

*This table is the judgment evidence. If it's empty, either the build was trivial or I wasn't steering.*

## Shortcuts marked
- `_NAME_STOPWORDS`/`_COMMIT_STOPWORDS` — curated stop-sets; misses demote to plain text (no wrong owner), add per report
- reversal links the most recent decision only — real subject matching needs semantics; trigger: a wrong-link report
- naive sentence split (abbreviations split early) — costs recall only; trigger: a report showing real misses
- `_DUE_VOCAB` — hand-curated date phrases; event anchors ("before the cutover") are not dates; trigger: a missed real due phrase
- LLM owner names null out when not transcript speakers — never shown wrong; trigger: reports wanting fuzzy owner matching
- a named committer who never speaks yields no owner at all (refusal > guess) — trigger: reports of missed cross-team actions
- curated cue precision (idioms/passives can false-positive) — the `--llm` pass is the precision path; trigger: a report of a misleading cue hit

## The one check
`python3 self_check.py` — 63 assert-based checks: hand-counted fixture expectations (twice), parser shapes (VTT voice tags, cue-ts inheritance, NOTE/STYLE blocks, SRT, BOM, lone-`\r`, CR-only files), sanitize/fold (C0 pictures + C1/bidi markers), reversal + alias regression, LLM quote-verification (fabricated/vacuous/duplicate claims dropped+counted, owners folded/normalized, fences tolerated, transcript-order kept, both-sides reversals), in-process exit matrix, subprocess matrix pipe-free, one named regression per adversarial finding below.

## Rung 3 — fresh-context adversarial pass (23 findings; every one reproduced twice by the reviewer before it counted)

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| F1 | HIGH | `--llm` failures (unparseable output, dead endpoint, non-JSON body) escaped as tracebacks with **exit 1** — the code that means "nothing decidable" | FIXED: `real_llm` wraps every endpoint failure in `LLMError`; `process_bytes` captures it into `rep.llm_error`; `run()` prints the grounded report + names the reason, exits 2. Verified against a real garbage HTTP server and a dead port |
| F2 | HIGH | vacuous quotes verified anything — pure combining-marks fold to `""` (`"" in anything`), a bare `Maya:` label too | FIXED: evidence floor — quote must fold to ≥ 8 chars and match |
| F3 | MED | `-o` to a directory/unwritable path → traceback, exit 1, report lost | FIXED: OSError → named exit 2 |
| F4 | MED | C1 controls (U+0080–9F) and bidi overrides (U+202E family) reached stdout raw | FIXED: sanitize marks the whole Cc/Cf class — C0 keep pictures, C1/bidi get explicit `<U+XXXX>` markers (no picture block exists) |
| F5 | MED | sanitize deleted `\n`, so a perfectly-copied multi-line quote failed verification | FIXED: `\n` → space; fold collapses both sides identically |
| F6 | MED | merge dedup was kind-blind — an LLM *question* quoting a line deleted the cue *decision* + *action* on it (a 4-char quote could wipe a decision) | FIXED: same-kind dedup only (+ F2's length floor) |
| F7 | MED | VTT NOTE comment blocks mined as speech ("we'll go with the legacy cluster" → decision D1 by phantom speaker "Discussion so far"); STYLE keyword mismatched case | FIXED: NOTE/STYLE are blocks skipped to the next blank line |
| F8 | MED | CR-only (old-Mac) transcripts: every turn bled into line 1, later speakers attributed to the first | FIXED: CRLF normalized; a `\r`-only file normalizes `\r`→`\n` (a lone `\r` inside an `\n` file still stays in-line — line fidelity kept) |
| F9 | MED | `NAME will` grabbed "Patel" out of "Maya Patel" and promoted "Security will review" to an owner | FIXED: multi-word names kept whole; a named committer who never speaks is refused (no owner), never guessed |
| F10 | MED | verified-but-unlocatable LLM items rendered with no citation at all | FIXED: `_locate` falls back to a first-4-words probe for multi-line quotes; still unpinnable → dropped + counted (no citation, no item) |
| F11 | MED | invented LLM owner survived on unlabeled transcripts (`speakers and …` guard bypassed the null-out) | FIXED: the guard is now unconditional — with no speakers, every owner is invented |
| F12 | MED | duplicate LLM claims rendered twice | FIXED: LLM dedup by (kind, folded quote) |
| F13 | MED | LLM returning both sides of a reversal pointer-less erased the supersede story | FIXED: pointers transfer to the LLM item that proved (deduped) its cue twin, then renumber+remap |
| F14 | MED | any line containing `-->` was silently dropped as a cue line ("A --> B mapping" decision vanished) | FIXED: a cue must START with a timestamp |
| F15 | LOW | `\| head` on a big report → BrokenPipeError traceback (at the shutdown flush, where no handler lives) | FIXED: flush inside the try; EPIPE → quiet exit 0 (the report WAS produced) |
| F16 | LOW | twin commitments by different speakers deduped to one | FIXED: speaker joins the dedup key |
| F17 | LOW | idiom/passive false positives ("dropping the ball", "budget will be approved") | MARKED — curated-cue precision ceiling; the LLM pass is the precision path |
| F18 | LOW | negated commitments became owned, dated actions ("I can't attend before Friday" → due Friday) | FIXED: negation guard on the action branch |
| F19 | LOW | mid-sentence "please click next" counted as an ask | FIXED: ask cues anchored to sentence start |
| F20 | LOW | "for Monday's standup" extracted as due Monday | FIXED: possessive lookahead in the due vocab |
| F21 | LOW | bare "instead" superseded an unrelated live decision | FIXED-ISH: "instead" removed from reversal cues (a real "actually/wait/scratch that" still fires); most-recent-only linking stays a marked ceiling |
| F22 | LOW | `Maya:We'll` (no space) and 40-char names lost their speaker label | FIXED: `:\s*` + 40-char cap + http/https/www stopwords |
| F23 | LOW | cosmetics: `[99:99]` echoed as a timestamp; questions without `?` missed; LLM `text` as array rendered repr; prose-before-JSON → LLMError | FIXED: text-must-be-str; others MARKED (GIGO on ts echo, cue precision, exit-2-with-report now honest) |

Reviewer's own sound-verification: exit matrix, byte-determinism across PYTHONHASHSEED, C0 hygiene end-to-end, reversal chains, SRT, server 413/400 paths, 2MB perf — all clean; every fixed finding above carries its named regression (`test_f1…test_f22` in self_check.py). 63 checks green after the pass (42 before).

**The pattern in one line:** the deterministic core held everywhere the reviewer probed it; every HIGH/MED finding lived on the LLM seam — which is the day's thesis wearing a test suite.
