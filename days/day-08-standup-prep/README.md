# standup-prep

**Day 08 of 30** · [Retro](RETRO.md) · [Build log](BUILD-LOG.md)

> "Is this your situation too with daily standups?" — 717 votes, 312 comments on r/ExperiencedDevs; composing the daily update is its own dread, 5–15 minutes before every call
> [thread →](https://www.reddit.com/r/ExperiencedDevs/comments/1lvo7fd/is_this_your_situation_too_with_daily_standups_do/)

A zero-dependency TypeScript CLI that turns your recent commits into the 30-second standup update **you edit before the call**:

- **Drafts, never invents.** The bullets come from real commit subjects — grouped by the area token your subjects already carry (conventional scopes `fix(auth):`, ticket keys `AUTH-12:`, repo prefixes `day-07:`), newest work first, honest `(N commits)` counts. "Today's plan and blockers" stay yours: git can only prove the done-list.
- **Window that means what it says.** Local-midnight math (`--days N` default 1 = yesterday 00:00 → now, `--since` for explicit dates — parsed as *local*, not the UTC-midnight trap), author-date based (a rebase doesn't hide the work), merges excluded, commits dated after now excluded **and counted** instead of silently mixed into a false window.
- **`--me` that respects identity.** Email is authoritative when it matches anything — a collaborator sharing your display name can't enter your draft; only when a rebase rewrote every address does the name do the filtering, and the header names the identity that actually matched.
- **`--llm` tone pass, wired honestly.** One call to any OpenAI-compatible endpoint (env-configured), injected as a world function, off by default. It polishes the bullets; it is prompted (and trusted) never to invent work. Failures exit 2 with the reason named and the base draft still printed — never a silent fallback. No key needed for the core tool.
- **Exit trichotomy (day-04/05 carry-over):** `0` draft · `1` no commits in window (honest empty) · `2` cannot check — not a repo, bare repo, git unavailable, bad flags, or `--llm` requested but undeliverable. Refusals name the *true* reason (git-missing ≠ not-a-repo ≠ bare).

## Run it

```bash
# needs Node ≥ 22.18 (native TypeScript type-stripping — no build step, no deps) and git
node standup-prep.ts                  # yesterday 00:00 → now, in the current repo
node standup-prep.ts ~/work/myrepo    # any repo path
node standup-prep.ts --days 3         # wider window
node standup-prep.ts --me             # only your commits (git config user.email/name)
node standup-prep.ts --since 2026-11-04
node standup-prep.ts --llm            # + one tone pass (needs STANDUP_LLM_KEY or OPENAI_API_KEY;
                                      #   optional STANDUP_LLM_URL / OPENAI_BASE_URL, STANDUP_LLM_MODEL)
```

## What it looks like

Real run on this series' own repo, pinned clock (`STANDUP_PREP_FAKE_NOW=1793767000` — the repro knob; every number below re-derives byte-for-byte):

```text
(1 commit dated after now excluded — clock skew or rewritten dates)
standup draft — 2026-11-04 (window Nov 1 00:00 → Nov 4 15:06 · 8 commits)

- day-07 — close — retro, learnings (D07 entries), debt ledger +2 markers (3 commits)
- day-06 — validation pass 2 — four more wrong-result leaks (pino levels read on python's ladder, flo… (3 commits)
- day-05 — post-ship validation fixes — four more "cannot check" leaks (2 commits)

git proves the done-list; today's plan and blockers are yours to say.
```

The grouping reads the area tokens the subjects already carry; the `…` clips at 90 code points, never mid-rune; and the note line is the window honoring its own "→ now" claim on real history. Stress-tested on a 413-commit real-world repo (PR refs, CJK subjects, emoji, `feat!:` shapes) with zero misreads.

## How it decides

| Decision | Rule | Why |
|----------|------|-----|
| Draft content | commit subjects only, bodies never read | the standup is a spoken summary; bodies are implementation notes — and tokens |
| Grouping | the subject's own leading token (scope / ticket / `day-NN:`) | the author already named the area; zero extra git spawns, no file-list parsing trivia |
| Window | JS filters `%at` (author date), not git's `--since` | git's flag filters COMMITTER date — a rebase would hide work; the seam decides, not the provider |
| Ordering | git returns newest-first; the draft leads with the freshest work | D02's rule: never inherit a provider's ordering — choose it |
| `--me` | email first, name only when email matches nothing | a rebase rewrites emails, not names — but a same-name stranger is worse than a missing commit |
| LLM | polish-only, base draft printed first, failure = exit 2 named | the LLM edits; it never authors. The done-list stays git-provable |
| Control chars | Unicode control pictures (␇ ␍ ␛), tab/newline kept | never print parsed control bytes raw; pictures can't be impersonated by typed `\u0007` text |
| Inert records | counted and noted, never guessed at, verdict still honest | a field-shifted record must not silently erase a commit — or silently fake one |

## Validate it works

```bash
npm run check    # 41 assert-based checks: parser fixtures (hand-counted twice), scripted-world
                 # run() paths, CLI subprocess matrix, real-git end-to-end, TZ-gap windows,
                 # and one named regression per adversarial finding (F1–F13)
```

Real-world validation before shipping: this repo (9 commits, grouping hand-verified against raw `git log` — 9/9), a 413-commit open-source repo (career-ops) parsed clean, a third repo, honest exit-1 on stale repos, full exit matrix pipe-free. Then a fresh-context adversarial pass (~90 probes, every finding reproduced twice) found **13 issues — 5 wrong-result, 3 wrong-reason, 5 cosmetic** — all fixed with named regressions: the UTC-midnight `--since` trap, an all-inert window lying "no commits", `--me` absorbing a same-name stranger, future-dated commits inside a window claiming "→ now", a suppressed cap note, false refusal reasons, an unsanitized LLM output path. See the [build log](BUILD-LOG.md).

## Deliberately not built

No calendar/Jira OAuth (ticket IDs surface from subjects via regex — a ticket *export* integration is a write into someone else's system), no Slack posting, no multi-repo org mode, no persistent state or caching, no interactive editor — one repo, one draft, **you edit it**. No `--with-bodies` (subjects are the raw material; a flag nobody asked for is scope creep). Every shortcut is marked in code with a `ponytail:` comment naming its ceiling and trigger.

## Files

- `standup-prep.ts` — the tool (477 lines, stdlib only)
- `self-check.ts` — the one runnable check (41 checks)
- `package.json` — `npm run check`, engines pin
