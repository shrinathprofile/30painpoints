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

---

*Follow the daily posts on LinkedIn.*
