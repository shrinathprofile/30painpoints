# BUILD-LOG — Day 04: docs-drift

> Appended in real time, not written at the end. Honest beats tidy.

## Decisions
| Time | Decision | Why |
|------|----------|-----|
| 0:05 | Diff **spec against spec**, never parse source | Day-03's retro carry-over, applied literally: "FastAPI's route table is the provider — read it from the imported app." The tool imports the app (uvicorn-style `module:attr`) and calls `app.openapi()` — the same object the user's own `/openapi.json` endpoint serves. Both sides of the diff are then OpenAPI dicts; apples-to-apples, zero FastAPI internals, zero AST games. |
| 0:10 | Compare a subset: (method, path) + params (name, kind, required) | The complaint is "docs lie about what the API does". Endpoint presence and param contracts are the lie that breaks integrations. Schema/response-model drift: cut, `ponytail:` marker, named trigger. |
| 0:15 | Python stdlib CLI — argparse, json, importlib; **zero deps in the tool** | The tool runs inside the *app's* environment (like pytest/uvicorn); it must add nothing to it. FastAPI is the provider under test, not a dependency of `docs_drift.py`. |
| 0:20 | Fixtures exported from the fixture app, then aged by hand | Generating `openapi-synced.json` from the real app guarantees exit-0 is real; hand-editing exactly 5 drifts into a copy guarantees the drifted run has no accidental diffs. Realism without fake drift. |
| 0:25 | Checks as plain-assert `test_*()` functions, collectable by pytest AND a 6-line `__main__` runner | The stack card says pytest; the protocol says assert-based, no frameworks. Resolution: the same 18 functions run green under `python3 test_drift.py` and `pytest test_drift.py` — pytest is optional, the asserts are the check. |
| 0:30 | Exit 0/1/2 = in sync / drift / usage-or-broken-app | Days 01–03 convention, with today's addition learned the hard way: **a linter that exits 1 when it *cannot check* is a CI footgun** — "broken" and "drifted" must be distinguishable exit codes. |
| 0:35 | No `--fix`, no spec writing; print the re-export one-liner instead | Scope cut from the brief (lint and fail). Day-01 discipline: the fix command is printed, copy-pasteable, and never executed by the tool. |
| 0:40 | Dockerfile that proves itself | Stack card says Docker. The container runs the checks, then runs the drifted fixture and **requires exit 1** — container exits 0 only if both behave. The CI story in miniature. |

## Rabbit holes
| Time lost | What happened | Lesson |
|-----------|---------------|-------|
| 10 min | Reddit re-fetch of the evidence thread: 403 bot wall (www and old.reddit, curl with UA, and the search API quota). Kept the pre-verified citation from `docs/02-THE-30-IDEAS.md` (verified 2026-10-24) and noted the block in the brief. | An evidence link you can't re-fetch today is still evidence if its verification date is recorded. What's dishonest is pretending you re-verified. |
| 25 min | **Temporal-drift demo blocked:** the plan was to checkout sqlmesh's Sep-2025 code and diff against today's committed spec (real drift, zero planting). Their old code won't even import under today's typing-extensions (`TypeError: Too few arguments for typing.Generator`), and there's no lockfile at that commit to freeze old deps. Two install attempts, then stopped. | Old code needs old locks. And see the next row — the "failure" was the day's best find. |
| 15 min | First self-check run: 5 failures. Three were **my own assertion bugs** (wrong sort-order expectations ×2, one nonsense assert), one was a real tool bug (below). Day-03's retro warning — "tests written by the code's author inherit the code's arithmetic" — repeated on day one of writing tests myself. | Assert what the output IS, after deriving what it should be. Order matters when order is part of the contract. |
| 10 min | **The `python` vs `python3` bug:** the printed fix command said `python -c …` — macOS has no bare `python`; the copy-paste fix failed with command-not-found, and (worse) the test's shell redirect truncated the fixture file to empty while "failing", cascading fake JSON errors into later checks. Fix: tool prints `python3`; the fix-command check redirects to a throwaway target so it can never mutate fixtures. | Day-01's lesson verbatim: run the rendered string when the string IS the product. Plus: a check that executes the product's own fix must not be able to destroy the fixtures it runs against. |
| 5 min ×2 | zsh piped exit codes lied to me twice (`… | tail; echo $?` shows tail's 0, not the tool's) — once during Docker validation, once during probes. Day-01's build log documents this exact trap. | Lessons you log are lessons you re-learn anyway. Measure exit codes without pipes in the way. |

## AI vs me
| ZCode did | I did (chose / rejected / rewrote) |
|-----------|-----------------------------------|
| Wrote the tool, fixtures, checks, Dockerfile, docs | Set the rule up front: "same logic as day 1" — brief-before-code, provider-not-parsing, injected pure logic, assert checks, real-run validation, ponytail markers |
| First draft of the checks contained an "any order is fine" triple-alternative assert | Rejected it before running — rewrote as exact expected output (day-03's wrong-assertion lesson); still got sort order wrong twice, honestly logged above |
| Caught that importing user apps can raise anything (from the sqlmesh crash) | Chose exit-2-for-any-import-failure over catching only ImportError — "the check is broken" and "drift found" must never share an exit code in a CI linter |
| Suggested comparing schemas and response models too | Rejected — param-contract subset answers the complaint; the rest is a `ponytail:` marker with a trigger |
| Suggested a `--fix` flag that rewrites the spec | Rejected — scope cut in the brief; the tool prints the exact re-export command and never writes |

*This table is the judgment evidence. If it's empty, either the build was trivial or I wasn't steering.*

## Shortcuts marked
- `ponytail:` single-file stdlib CLI, argparse over click — trigger: a second subcommand or a second provider (non-FastAPI)
- `ponytail:` only paths/methods/params compared — schema, response-model and description drift invisible — trigger: a user report asking for it
- `ponytail:` YAML specs only if pyyaml already exists in the app's env — JSON is FastAPI's native export — trigger: a real repo whose only spec is YAML
- `ponytail:` Swagger 2.0 rejected, not translated (basePath/definitions) — trigger: a user report

## The one check
`test_drift.py` — 18 assert-based checks, runnable two ways: `python3 test_drift.py` (stdlib runner) or `pytest test_drift.py -q` (stack-of-the-day runner). Covers: extract normalization (path-item/operation param merge, method case, metadata keys, lying required flags, junk entries), the three drift classes in emission order, header params, trailing-slash and template-rename as drift, end-to-end on the fixture app (exactly the 5 planted drifts; synced → empty), the CLI exit matrix (0/1/2, one-line usage errors, no stack traces), the printed fix command executed for real (redirected to a throwaway target), and the three probe-found regressions.

## Real-world validation (before shipping)
- **TobikoData/sqlmesh** (a major real FastAPI codebase, installed at HEAD from source): the tool imported `web.server.app:app` (their own export path) and reported **in sync — 25 endpoints, exit 0** against their committed `web/client/openapi.json`, their `vscode/openapi.json`, AND their Sep-2025 historical spec. Their discipline is real; the tool proved it in one command each.
- **The sqlmesh crash that became the day's bug:** checking out their Sep-2025 code (today's deps) makes their app raise `TypeError` during FastAPI route registration at import. First version of the tool: raw stack + **exit 1** — CI would have read "docs drifted" when the truth was "the check couldn't run." Fixed: any import-time exception → one line + exit 2. Regression check added.
- Adversarial probes (inputs real repos contain): a string entry inside `parameters` crashed the diff (fixed: skip non-dicts); a UTF-8 BOM — the PowerShell-export signature — was rejected as invalid JSON (fixed: read `utf-8-sig`); an `openapi()` overridden to return `None` needed a type guard (fixed: exit 2, "returned NoneType"). Each has a check.
- CLI matrix, exit codes verified without pipes: drifted→1, synced→0, bad module/missing file/invalid JSON/Swagger 2.0/directory-as-spec/no-args/unknown flag→2.
- Docker: `docker build && docker run` — 18 checks green inside the container, the drifted fixture correctly exits 1 inside it, container exits 0 with the proof line.
