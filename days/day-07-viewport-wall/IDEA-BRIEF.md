# IDEA-BRIEF — Day 07: viewport-wall

> Written BEFORE any code. If any section is blank at build start, the build doesn't start.

## The complaint (evidence)
- **Subreddit:** r/QualityAssurance (echoed across r/webdev, r/Frontend, r/softwaretesting for a decade)
- **Thread / quote:** "How are you handling cross-browser testing in 2025?" — the recurring answer genre is "cross device testing is so much harder than I expected"; 10+ threads across 5 subreddits from 2014 to 2025, and every free answer bottoms out at "open several windows", while the tools that do it properly (BrowserStack, Sizzy, Polypane) are paid. (Evidence pre-verified 2026-10-24 in `docs/02-THE-30-IDEAS.md`; today's re-fetch of the thread was blocked by Reddit's bot wall — noted honestly, not quietly dropped, per the D04 precedent.)
- **Why I believe it's recurring:** responsive layout breaks are only visible by *comparing* widths side by side, but every free tool shows one width at a time. DevTools device mode is serial; the complaint is about parallelism. A decade of threads and the free state of the art is still "resize a window 6 times."
- **Source URL:** https://www.reddit.com/r/QualityAssurance/comments/1mq9712/how_are_you_handling_crossbrowser_testing_in_2025/

## Why this should exist (ponytail rung 1)
DevTools answers "what does 390px look like?" — the complaint asks "does it still work at 320, 390, 768, 1280 *at the same time*?", which is a layout question, not an engine question; N simultaneous viewports in one window cannot be replaced by a tool that renders one viewport at a time.

## The people hurting
Frontend devs and QA checking responsive breaks during development — today they open 5 browser windows resized by hand (the thread's free answer) or pay for BrowserStack/Sizzy/Polypane; the middle — free, instant, side-by-side — is empty.

## Scope
- **30-minute floor (fallback):** 4 fixed viewports (320 / 390 / 768 / 1280), no scroll sync. Type a URL, press Enter, four columns render.
- **Today's target:** a Vite+React page: URL bar → 5 device-width columns (320 iPhone SE · 390 iPhone 15 · 412 Pixel 8 · 768 iPad · 1280 laptop), pixel scroll-sync across columns (default on, toggleable), global zoom (25–100%, so the wall fits one screen), per-column "open ↗", honest "blank frame = that site refuses embedding" note, target URL persisted in the location hash so a deployed link demos itself.
- **Deliberately NOT building:** no screenshot/visual-diff lab (that's a real infrastructure product), no browser-engine emulation claims (one engine, many widths — named honestly in the README; this is *width* testing, not cross-browser), no auth'd/login pages, no device manager/history, no extension.
- **How sync works (platform reality the plan had wrong):** the ideas doc said "postMessage scroll-sync" — but a parent cannot scroll a cross-origin iframe, and postMessage only helps pages that run a cooperating listener, which production sites don't. Instead: each iframe is rendered very tall inside a clipped, scrollable column; sync scrolls the *columns*. Pure native CSS/DOM. Documented ceilings: pages taller than the fixed frame height are cut off at the bottom; sync is pixel-offset, not percentage (same-origin policy hides content height).
- **Guarding against (from MISTAKES.md, today's stack):** never trust read-right checks — every self-check executed, fixtures hand-counted twice (D05); never claim a platform/browser property without checking it in the real run (D06 pass-2); never let fixtures be the only world — ≥2 real sites in a real browser (D06 meta-1); never ship generated source before the type-checker — `tsc --noEmit` before anything runs, invisible bytes are this stack's trailing whitespace (D06 meta-2); grep siblings before closing any fix (D06 V3); README outputs byte-identical at close (D06 pass-2).

## Stack of the day
**React + Vite + TypeScript** — first frontend day of the series; native platform features do the work (iframes, `overflow`, `scrollTop`, CSS `transform: scale`, `location.hash`), zero runtime deps beyond React. Maps to the #1 JD demand (TypeScript + React: 10 of 30 days).

## Definition of done
A stranger opens the page, types a real site URL, presses Enter, and within 5 seconds sees that site rendered in 5 device-width columns side by side — and scrolling one column scrolls all the others by the same pixel offset (verified in a real browser, plus a `node selfcheck.ts` green run for the URL/width parsing logic).
