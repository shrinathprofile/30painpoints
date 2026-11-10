# 30 Days, 30 Reddit Problems, 30 Shipped Tools

**Every day: one real, evidenced Reddit complaint → one small, genuinely useful tool — built and documented in public.**

Not tutorial rehashes. Not to-do apps. Problems people are *actually* complaining about right now, each traced to a thread, each answered with the smallest tool that helps.

Built with [ZCode](https://zcode.dev) and the **ponytail** discipline (std-lib before dependencies, native before custom, the smallest working diff wins — every deliberate shortcut marked in the code with a `ponytail:` comment).

## How each day works

Every day follows the same fixed protocol, and every day-folder is self-contained:

```
days/day-NN-slug/
├── IDEA-BRIEF.md     # written BEFORE building: the Reddit problem, source, scope cut
├── BUILD-LOG.md      # written DURING: decisions, rabbit holes, what AI did vs what I did
├── RETRO.md          # written AFTER: what I learned, reusable artifact, numbers
└── ...               # the tool itself
```

Nothing gets built without the brief. Nothing gets posted without the retro. That's the whole system.

## The calendar

| Week | Focus | Days |
|-----|-------|------|
| 1 | Developer pain points (r/webdev, r/SideProject, r/ExperiencedDevs) | 01–07 |
| 2 | Remote work & productivity (r/remotework, r/productivity, r/ADHD) | 08–14 |
| 3 | Indie hackers & creators (r/Entrepreneur, r/newTubers, r/content_creators) | 15–21 |
| 4 | Everyday life (r/personalfinance, r/Frugal, r/EatCheapAndHealthy) | 22–28 |
| Finale | The 2 best problems the audience picked, rebuilt properly | 29–30 |

Light days (1–2h): micro-tools and scripts. Build days (3–4h): small complete apps.
The stack rotates through what remote job descriptions actually ask for in 2026.

## Learnings

Every day feeds `learnings/` — the compounding knowledge base of the series:
[`TECHNICAL.md`](learnings/TECHNICAL.md) · [`PRODUCT.md`](learnings/PRODUCT.md) · [`BUSINESS.md`](learnings/BUSINESS.md)

## Why this exists

One early-career engineer proving a point: with AI leverage and senior habits — scoping, minimalism, documentation, tests — one person can ship like a small team. Every artifact here is evidence.

## Index

- [Day 01 — env-doctor](days/day-01-env-doctor/) · 504-upvote complaint about env setup dread → a CLI that diagnoses a repo's environment in one command
- [Day 02 — stale-PR wrangler](days/day-02-stale-pr-wrangler/) · 571-point r/ExperiencedDevs answer on review latency at 15-20 engineers → a scheduled digest of a repo's oldest waiting PRs, with rotating-reviewer nudges
- [Day 03 — nuke-caches](days/day-03-nuke-caches/) · 186-point wish in r/webdev's "tool you wish existed" thread → one zero-dependency command that finds every dev cache, shows the bytes, and clears them
- [Day 04 — docs-drift](days/day-04-docs-drift/) · the years-running r/devops question "how do you keep API docs up to date?" → a stdlib-only linter that fails CI when the committed OpenAPI spec disagrees with the FastAPI app
- [Day 05 — todo-debt](days/day-05-todo-debt/) · the dead TODO-collector mourned in r/webdev's wish-thread → a blame-aged debt index + a PR ratchet that fails CI when a change adds net-new TODO/FIXME/HACK (this repo's own `ponytail:` ledger is its demo)
- [Day 06 — loglens](days/day-06-loglens/) · "fresher struggling with logs while debugging" + 5 sibling r/devops threads → a zero-dependency Go CLI that reads log *records* grep can't see: format-detecting, stack-attaching, duplicate-collapsing, with grep-compatible exit codes *(index line added a day late — day-06 shipped without it; caught during day-07's index check)*
- [Day 07 — viewport-wall](days/day-07-viewport-wall/) · a decade of "cross device testing is so much harder than I expected" threads → one page rendering any URL at 320/390/412/768/1280 simultaneously, synced scrolling, honest about every ceiling (blocked frames, engine-vs-width, page-length cut)
- [Day 08 — standup-prep](days/day-08-standup-prep/) · 717 upvotes for hating to compose daily standups → a zero-dependency CLI that drafts the 30-second update from real commits, with an optional LLM tone pass that can polish but never invent (exit 0/1/2: draft / honest empty / cannot check)
- [Day 09 — overlap planner](days/day-09-overlap-planner/) · "boss schedules meetings at 11pm my time because it works for HQ" (169 votes, r/digitalnomad) → a pinnable, account-free page: teammates' cities + hours in, one grid of everyone's clock with the fair meeting windows computed — zero date libraries, all `Intl.DateTimeFormat` per instant ([live](https://shrinathprofile.github.io/30painpoints/days/day-09-overlap-planner/#v%3D1%7CShri%7CAsia%252FKolkata%7C09%253A30%7C18%253A30%2CSam%7CEurope%252FLondon%7C09%253A00%7C17%253A00))
- [Day 10 — decision-miner](days/day-10-decision-miner/) · "is there anyone else who forgets what was decided in the meetings?" (r/remotework; Otter/Fireflies paywalled) → transcript in, decisions/actions/owners out as Markdown, every line cited; an optional LLM pass where every claim must quote the transcript verbatim or it's dropped and counted

---

*Follow the daily posts on LinkedIn.*
