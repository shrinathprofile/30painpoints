# RETRO — Day 07: viewport-wall

> No retro, no post. The post is a byproduct of the work.

## What I learned
- **Technical:** You cannot scroll a cross-origin iframe — ever — so every "synced browser view" tool either gets cooperation (extension, proxy, postMessage listener) or uses the one trick that needs none: render the frame very tall inside a clipped, scrollable container and scroll the *container*. Paired with CSS `zoom` (layout-affecting, unlike `transform`) the whole multi-viewport wall is ~40 lines with zero cooperation from any site. The second platform lesson: `new URL()` is engine-divergent — Chromium percent-encodes spaces inside hosts that Node throws on, so URL validation must be *your own guard before the parser*, or your selfcheck certifies behavior only Node has.
- **Meta:** The adversarial pass earned its keep again, harder than on D06: 13 findings, including a total crash on link-sharing and a **selfcheck that was green on a claim the real browser disproves** — checks run on an engine, and "valid URL" is not the same fact on two engines (D05's rule, now with a cross-platform face).

## Reusable artifact
None extracted — and that's right (D03 rule: extraction only when a second day *imports*). Candidates for future days: `normalizeUrl` (scheme/host:port/credential/whitespace guard) inherits into any future URL-at-a-trust-boundary day (D09 overlap planner, D12 extension).

## Ponytail debt created
- `app/src/lib.ts` FRAME_H — fixed 40,000px frame height; pages taller than this cut off · trigger: a real page whose tail matters
- `app/src/App.tsx` footer — blank-frame cause not detected (no cross-browser signal); honest range-of-causes note instead · trigger: a reliable cross-browser detection API
- (documented ceiling, no marker needed: short pages leave blank scroll below content; pixel-sync not percentage-sync)

## Numbers
- Time spent: ~2h light-day budget (build ~35m, validation+fixes ~55m, ship+deploy ~15m, docs/retro the rest) — on the ceiling of 🟢, as a weekly day should be
- Token spend (est.): ~2.3M session tokens (main + 2 subagents ≈ 0.44M audit + 7.1M-page adversarial ≈ 0.9M in its own budget)
- Self-check passing: yes — 21/21 executed green, byte-identical from a clean rebuild; tsc/oxlint/vite all clean
- Adversarial: 13 findings (1 crash, 4 wrong-result, 1 cannot-check, 7 cosmetic) — all fixed except F11 (documented ceiling); 1 fix-caused regression caught and fixed inside the same pass

## Tomorrow
Day 08 (standup-prep, first LLM-integration day): the `normalizeUrl` guard pattern comes along — any string that becomes a URL/command at a trust boundary gets my own validation before the platform's parser, because the platform's parser is engine-divergent.

## Honest failures
- My first shipped selfcheck asserted "spaces in host refused" — green in Node, **false in the browser the app actually runs in**. The adversarial agent caught it. A green check proved nothing about the engine that matters.
- My F10 CSS fix broke scroll entirely (clips grew to 20,000px) because I forgot the React `#root` div breaks a body flex chain — caught only because I re-verified scroll after a cosmetic fix. Re-verify the core after *any* fix, not just core fixes.
- The root README index was missing day-06 entirely — the exact D04 meta-2 failure, repeated. The check I do at ship ("update the index") needs to be "verify every prior day is in the index", not "add today's line".
- Reddit bot-walled the evidence re-fetch (4 routes). Cited the 2026-10-24 pre-verification honestly per the D04 precedent — not a failure, but it's why the thread quote isn't fresh.
