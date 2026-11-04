# BUILD-LOG — Day 07: viewport-wall

> Appended in real time, not written at the end. Honest beats tidy.

## Decisions
| Time | Decision | Why |
|------|----------|-----|
| 0:00 | Evidence: cited 2026-10-24 pre-verification; Reddit re-fetch bot-walled today (curl→shell HTML, old.reddit→login redirect, api.reddit→403; WebSearch + web_reader quota-exhausted until 11-28) | D04 precedent: honest citation beats invented numbers |
| 0:05 | Scroll-sync = tall iframe inside clipped column, sync the *columns* — not the ideas-doc's postMessage | Parent cannot scroll a cross-origin iframe (same-origin policy); postMessage only works on pages running a cooperating listener, which production sites don't. Native CSS/DOM beats a plan that assumes cooperation (D01: ladder outranks plan) |
| 0:10 | Zoom via CSS `zoom` property on the iframe, not `transform: scale` wrapper | One property vs a wrapper + height math; must be verified in real browser this session (D06 pass-2: never claim platform property unverified) |
| 0:12 | `no scheme` + localhost/127.0.0.1 host → `http://`, everything else → `https://` | Real trap caught at design time: typing `localhost:5173` must not become `https://localhost:5173` (TLS handshake fail on every local dev server) |
| 0:15 | No blocked-frame detection | Cross-origin iframe `load` fires even when X-Frame-Options refuses; no cross-browser way to distinguish blocked from slow. Honest note + per-column ↗ instead of a fake detector ("cannot check" is valid; a wrong indicator is not) |

## Rabbit holes
| Time lost | What happened | Lesson |
|-----------|---------------|-------|
| 6m | Reddit evidence re-fetch: 4 routes tried (www JSON, old.reddit, api.reddit, MCP readers), all bot-walled or quota-dead | The D04 precedent exists precisely for this; cite the pre-verified ledger, move on — 4 routes is enough |

## Rung 2 — real-run validation (real browser, Playwright/Chromium, dev server :5199)
| Input | Result |
|---|---|
| `#http://localhost:5199/demo.html` (hash boot, same-origin dogfood) | ✓ 5 columns, inner layout widths **exactly 320/390/412/768/1280** (instrument page's own badge: "layout width: 320px"); CSS `zoom` layout math verified (scrollH 20000 = 40000×0.5) |
| scroll col 1 → 800 | ✓ all five mirrored to 800 |
| sync OFF, scroll col 3 → 3000 | ✓ only col 3 moved |
| sync re-ON | ✓ col 3 snapped back to leader (800) |
| `javascript:alert(1)` + Enter | ✓ refused, error shown, frames cleared, hash untouched |
| `example.com` | ✓ rendered in all 5 (https prepended, hash updated) |
| `info.cern.ch` | ✓ rendered in all 5 — the world's first website, at five widths |
| `en.wikipedia.org/wiki/Responsive_web_design` | ✓ rendered — frame-friendly; layout visibly differs per width (the product, working) |
| `github.com` | ✓ honest blank — console: `CSP frame-ancestors 'none'` ×5; footer note + per-column ↗ cover it. Not detectable cross-browser (XFO blocks fire no event the parent can read; CSP ones do — half-coverage detector rejected as worse than the honest note) |

## Rung 3 — adversarial pass (fresh-context agent, 13 findings, all reproduced twice by the agent)
| # | Finding (agent's words, condensed) | Class | Fix shipped |
|---|---|---|---|
| F1 | hash with malformed `%`-escape (`#%`, `#50%off`) crashed the whole app on load (URIError in boot, blank page) | crash | try/catch in `boot()` → degrades to empty state; verified: `#%` reload boots alive |
| F2 | `mailto:bill@microsoft.com` silently rewritten to `https://mailto:…` and "loaded" | wrong-result | bare `name:` (non-`//`, non-digit-port) now refused: "only http(s) URLs can be framed, not mailto:" |
| F3 | `not a url` accepted by Chromium (percent-encodes spaces in host) — while the green selfcheck claimed refusal (Node throws) | wrong-result | whitespace/control-char guard BEFORE URL parsing → identical behavior on every engine; selfcheck assert updated to the deterministic truth. The meta-finding: **a selfcheck ran green on a claim its own engine disproves** (D05 rule, now cross-platform) |
| F4 | footer stated blank frame = "site refuses embedding" as certain — false for TLS-wrong-scheme and DNS-dead hosts | wrong-result | copy rewritten to the honest range ("usually refuses embedding… or unreachable as framed — open ↗ to see the site's own answer") |
| F5 | `user:secret@` written into iframe src, ↗ link, and the shareable hash; Chromium blocks credentialed frames anyway | wrong-result | `u.username/password` stripped post-parse → secret never reaches src/hash/↗; assert added |
| F6 | embedded newline in paste silently dropped → different site | wrong-result* | guard covers it; *investigation: `<input type=text>` strips newlines on entry (HTML value sanitization), so the UI path was unreachable — the guard's live path is hash-boot (`#exa%0Ample.com` → refused, verified) |
| F7 | hash-boot with refused scheme (`#ftp://…`) showed no error | cannot-check | `boot()` now returns the error; verified shown |
| F8 | `min-width:120px` fought zoom ≤33% (dead space) | cosmetic | min-width removed; 25% zoom now exactly 80/97.5/103/192/320 (measured) |
| F9 | empty-state hint not zoomed → clipped | cosmetic | hint gets `zoom` style |
| F10 | fixed footer overlapped columns at ≤900px widths (45px hidden at 640w) | cosmetic | body flex-column + `#root{display:contents}` + static footer; footerGap 0 at all sizes, document no longer scrolls |
| F11 | short pages leave ~19.5k px of blank scrollable below content (frame is 40k px tall) | cosmetic | documented ceiling — inner content height is unknowable cross-origin; named in README |
| F12 | 2px right-edge clip (border + overflow) | cosmetic | `outline` (no layout) replaces `border`; frame == clip width (measured 160 == 160) |
| F13 | editing the hash mid-session did nothing | cosmetic | `hashchange` listener (our own `replaceState` never fires it — no loop); verified |

**Fix-caused regression caught during re-verify:** the F10 flex rewrite initially broke scroll entirely — clips grew to 20,000px (clientH == scrollH, scrollTop clamped to 0) because the React `#root` div broke body's flex chain; the old magic `calc()` had masked it. Fixed with `#root { display: contents }`; re-verified: clip 571/20000, sync 1200→×5, no document scroll. Lesson logged for MISTAKES.md.

**Agent-confirmed claims (evidence in its report):** exact widths at every zoom (320/390/412/768/1280 via instrument page DOM); pixel-perfect sync incl. fast/gestures/zoom-change/same-tick conflicts; load resets scroll; scheme guard on ftp/file/javascript/data/about; IDN punycode (`例え.jp`); github CSP-blank + working ↗; example.com 5×HTTP 200.

## AI vs me
| ZCode did | I did (chose / rejected / rewrote) |
|-----------|-----------------------------------|
| Drafted IDEA-BRIEF incl. postMessage→container-scroll correction | User approved brief at Gate 1 with sync+zoom target (not floor-only) |
| Scaffolded Vite react-ts, wrote lib/App/css/selfcheck | (in progress) |
| First `normalizeUrl` draft came out with a mangled ternary (`http://` + `https://` concatenation) | Rewrote it on sight as three plain branches — caught by reading, before any run |
| oxlint flagged the mount-effect setState | Rewrote as a lazy `useState(boot)` initializer — one less effect, StrictMode-proof, warning gone |
| Offered `securitypolicyviolation` listener as blocked-frame detector (covers CSP-blocked sites only) | Rejected: half-coverage detector = inconsistent UX; honest note + ↗ kept (wrong indicator worse than no indicator) |
| Left CSS `zoom` in despite cross-browser history | Conditional on real-run verification (D06 pass-2 rule) — verified in Chromium this session; Firefox ≥126 ships it, README names Chromium-verified |

*This table is the judgment evidence. If it's empty, either the build was trivial or I wasn't steering.*

## Shortcuts marked
- `lib.ts` FRAME_H — fixed 40,000px frame height; page taller than this is cut off · trigger: a real page whose tail matters
- `App.tsx` footer — blank-frame cause not detected (no cross-browser signal); honest note instead · trigger: a reliable cross-browser detection API existing

## The one check
`node selfcheck.ts` — 16 executed asserts: URL trust boundary (http(s)-only iframe srcs; `javascript:`/`data:`/`ftp:` refused; localhost→http so dev servers aren't TLS-dead; `localhost.evil.com` NOT treated as local) + layout invariants (device widths strictly ascending, zooms in (0,1]). Hand-traced twice per case before running; 16/16 executed green.
