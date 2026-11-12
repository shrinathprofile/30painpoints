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

### D04 — When the complaint is "things silently drift", the product is the gate
- Signal: "How are DevOps teams keeping API documentation up to date?" recurs across 4 subreddits for years — not "docs are hard to write" but "nothing fails when they go stale". FastAPI users even believe it can't happen to them (auto-generated docs), because the *interactive* docs can't rot; the spec they hand to consumers can.
- Decision: lint and fail — no spec regeneration, no editing, no hosted UI. The MVP is a CI exit code plus a copy-paste fix command; the scope cut (the tool never writes) is the same trust boundary as D01's diagnose-don't-touch, now on the write side.
- Rule extracted: for drift complaints, ship enforcement, not repair — the fix is one `app.openapi()` re-export away and the user must be the one to run it.
- Verdict lands: watch Day-4 post comments for "can it regenerate the spec for me?" — that's v2 demand signal, not scope regret (same watch as D01).

### D07 — When the complaint names an expensive category, ship the slice the platform gives free
- Signal: "cross device testing is so much harder than I expected" — a decade of threads whose answers split into "open 6 windows" (free) and BrowserStack/Sizzy/Polypane (paid). Nobody's mid-tier need (see five widths at once, free, now) was served.
- Decision: ship exactly that slice — one engine, five widths, synced scroll — and name the cut IN the product's own footer ("responsive layout testing, not cross-browser engine testing"). The honest ceiling list (blocked frames, tall-page cutoff, pixel-sync) is part of the UI, not buried in docs.
- Rule extracted: for every "the real tool costs $X" complaint, ask what the browser/platform already does free (iframes + overflow + CSS zoom here) — the free slice with honest ceilings beats a fake mini-version of the paid lab.
- Verdict lands: watch Day-7 post comments for "can it screenshot/emulate Safari?" — that's the paid-tier demand signal, not scope regret (same watch as D01/D04).

### D08 — The tool edits; it never authors
- Signal: 717 upvotes / 312 comments on the daily-standup thread — and the same genre of threads across r/remotework where people can smell AI-written updates ("nobody reads the bot blurbs").
- Decision: the LLM is polish-only and OFF by default; the base draft is 100% git-provable, printed FIRST, and survives any LLM failure (exit 2 names the reason, draft intact). "Today's plan and blockers" is deliberately absent — git cannot prove it, so the tool refuses to fabricate it. That refusal is the product's trust boundary, the same family as D01's diagnose-don't-touch.
- Rule extracted: when the complaint is "writing this is dread", the MVP is a provable draft the user finishes in 30 seconds — not generation. The LLM is invited to the editing table, never the author's chair.
- Verdict lands: watch Day-8 post comments for "can it write the blockers too?" — that's the v2 demand signal AND the line to hold (git can't know blockers; inventing them is how AI standups become noise).

### D09 — When the complaint is "someone picked a slot blind", sell the eyes, not a scheduler
- Signal: 169 votes / 203 comments on "boss schedules meetings at 11pm my time because it works for HQ" + 7 sibling threads. The scheduler never SAW the local time — and the thread's free answers are world-clock tabs and mental math, while the paid answers (World Time Buddy, Calendly teams) want accounts or calendar OAuth.
- Decision: a stateless, account-free page that makes the blindness visible — cities in (not offsets), everyone's clock on one grid, fair windows computed and labeled per person, and an honest "no window where everyone's hours overlap today" when the geometry says so. No calendar integration, no invite sending: the tool informs the human who picks, it doesn't pick.
- Rule extracted: for visibility complaints, the MVP is the one-glance artifact the decision-maker can be sent (a URL that carries its own state) — automation of the next step is a different product and usually the paid tier's.
- Verdict lands: watch Day-9 post comments for "can it book the meeting too?" — v2 demand signal, and the line to hold (booking is where accounts/OAuth — the thing we cut — become mandatory).

### D11 — When the complaint is measurement-of-the-wrong-thing, make the right thing cheap to compile
- Signal: 8.8K upvotes / 479 comments on "My company tracks whether you open Slack within 15 minutes of start" — the series' largest thread by ~5×. Presence surveillance is measured because presence is CHEAP to measure; the output already exists (every commit in `git log`) but is compiled nowhere, so the cheap metric wins by default.
- Decision: a one-command compiler of receipts — every commit a line with a short hash and the verbatim subject, +/− stats, files, docs, tickets — Markdown that pastes anywhere a human reads. NO LLM pass (generated prose weakens the one property the product exists for: verifiability — also the scope line vs day-08). The landing span says when work LANDED, never hours-at-desk. Run it on yourself, share what it prints — no monitoring of others, no boss dashboard: a tool answering surveillance must not become the surveillance it answers.
- Rule extracted: for measured-wrong complaints, the MVP changes what's CHEAP (compile the receipts in 5 seconds), not what's measured (a counter-dashboard of activity scores is the same disease with better PR).
- Verdict lands: watch Day-11 post comments for "can my manager run this on the whole team?" — that's the demand signal AND the line to hold (the tool has one direction: you, on you).

### D31 — The bonus-day rule: build for yourself, but pay the honesty tax in public
- Signal: n=1 — my own complaint ("can't re-check 120 careers pages weekly"), no thread, no upvotes. The protocol's evidence rule exists to stop building for imaginary users; the one exemption that stays honest is BEING the user — and saying so in the brief, the README, and the post, with the numbers that would have been the evidence replaced by the numbers of the build itself (56 feeds probed, 3,100 jobs, one wrong slug caught).
- Decision: the tool audits its own input — every source reports, first sightings prove identity, locations never guess into "open". A self-serving build earns an audience exactly the same way an evidence-backed one does: receipts. First run surfaced 135 India-workable roles (110 open) in 12 seconds, including GitLab Bangalore and Canonical Worldwide — the complaint answered on day one is the best post proof available.
- Rule extracted: "build for yourself" is allowed only when (a) you are provably in the affected population, (b) the tool's honesty primitives check YOUR data as hard as a stranger's, and (c) the self-interest is disclosed at every layer. Otherwise it's the same speculative build the evidence rule exists to kill.
- Verdict lands: does a personal-need post outperform or underperform complaint-driven ones? Watch comments for "can I point this at MY list" — that's the productization signal (the CSV columns and profile are already generic).
