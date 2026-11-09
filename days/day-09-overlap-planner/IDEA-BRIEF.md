# IDEA-BRIEF — Day 09: overlap planner

> Written BEFORE any code. If any section is blank at build start, the build doesn't start.

## The complaint (evidence)
- **Subreddit:** r/digitalnomad (echoed in 7+ timezone-angst threads across r/remotework and r/ExperiencedDevs)
- **Thread / quote:** "Boss schedules meetings at 11pm my time because it works for HQ" — 169 votes, 203 comments. The pain isn't that meetings exist; it's that the scheduler never *saw* the 11pm.
- **Why I believe it's recurring:** the thread genre is stable — "how do you work around massive timezone differences" gets answered with world-clock tabs and mental math, every time, for years. Calendar tools show MY busy blocks, but nothing free shows the whole team's clocks against one timeline before a slot is picked.
- **Source URL:** https://reddit.com/r/digitalnomad/comments/o34nnl/timezonefu_how_do_you_work_around_massive/ (evidence pre-verified 2026-10-24 in `docs/02-THE-30-IDEAS.md`; thread re-fetch blocked by Reddit's bot wall — noted honestly, per the D04/D07 precedent.)

## Why this should exist (ponytail rung 1)
The failure is a visibility failure, not a scheduling failure — HQ picks 2pm because on their screen 2pm is the only time that exists; the fix is one artifact that makes everyone's local clock visible *before* the slot is picked, and every product that does this (World Time Buddy, Calendly team views) wants accounts or calendar OAuth. A stateless page with no accounts is the free slice the complaint actually asks for.

## The people hurting
Remote engineers, nomads, and offshore teams scheduling across 3+ zones — today they open N world-clock tabs, subtract offsets in their head, and still ship a 11pm invite; several times a week, forever.

## Scope
- **30-minute floor (fallback):** 3 fixed cities (type zone names), one grid showing each teammate's current wall time only — no working hours, no fair windows.
- **Today's target:** a pinnable page: teammate rows (name + place + native `<input type="time">` working hours), place resolved from a small city-alias dictionary + the browser's own full IANA list via `Intl.supportedValuesOf('timeZone')` in a native `<datalist>`; one timeline grid of the viewer's local day in 48 half-hour slots, green = inside that teammate's working hours; contiguous all-green spans computed and labeled as fair windows; a now-marker; state shared through the URL hash (deployed link demos itself, day-07 pattern); viewer's own zone prefilled as the first row.
- **Deliberately NOT building:** no accounts, no calendar integration/OAuth, no invite sending, no date picker (the grid anchors to *today*; the day-shape is DST-shift-proof because every slot asks Intl per-instant — a date picker arrives when someone plans across a transition date), no overnight/shift hours (start < end only — night shifts are a different complaint), no DST edge-case *guarantees* beyond what Intl gives free (which turns out to be most of them — that's the stack card).
- **Guarding against (from MISTAKES.md, today's stack):** assert the UNIT at every seam — this tool lives on `Date` milliseconds and `formatToParts` integers (D08); pin locale + `hourCycle: 'h23'` wherever parts are parsed — unpinned 12h output re-introduces `hour: "24"`/dayPeriod ghosts (D08 determinism); self-check expected values hand-verified against an *independent* clock (shell `TZ=… date`), never the implementation's own output (D03); never claim a platform property without checking it in the real run — `Intl.supportedValuesOf`, datalist matching, `<input type="time">` all get touched in a real browser before the README says they work (D06 meta-1); `tsc --noEmit` before anything runs (D06 meta-2); grep sibling callers before closing any fix (D06 V3).

## Stack of the day
**React + TS + `Intl.DateTimeFormat`** — the ponytail native-platform showcase: zero date libraries. The full IANA zone list (`Intl.supportedValuesOf('timeZone')`), per-instant wall times and UTC offsets (`formatToParts` + the epoch-shift trick), and DST handling are all platform-frees; the only hand-written logic is the overlap arithmetic. Maps to the #1 JD demand (TypeScript + React: 10 of 30 days).

## Definition of done
A stranger opens the page, adds three teammates' cities with 9:00–17:00 hours, and sees at one glance which continuous band(s) of the day fall inside everyone's working hours — each band labeled in UTC and viewer-local time — and the link they share reproduces the exact same grid (verified in a real browser, plus a `node selfcheck.ts` green run where every expected value was hand-verified against an independent clock).
