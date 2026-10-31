# docs-drift

**Day 04 of 30** · [Retro](RETRO.md) · [Build log](BUILD-LOG.md)

> "How are DevOps teams keeping API documentation up to date?" — the question that recurs across 4 subreddits, year after year, in r/devops
> [thread →](https://www.reddit.com/r/devops/comments/1ov1ohe/how_are_devops_teams_keeping_api_documentation_up/)

A stdlib-only Python CLI that fails CI when the OpenAPI spec you ship disagrees with the FastAPI app you run. It imports your app (uvicorn-style), asks FastAPI for its **own** spec via `app.openapi()` — the same document your `/openapi.json` endpoint serves — and diffs it against the committed spec file. Never parses source code.

Three drift classes: **undocumented** endpoints (in the app, missing from the spec), **ghost** endpoints (documented, not served), and **param drift** (missing/extra path, query or header params; required-flag flips — the one that silently breaks consumers).

## Run it

```bash
# inside your app's environment (same rule as pytest / uvicorn):
python3 docs_drift.py myapp.main:app openapi.json
```

That's the whole interface: the app (uvicorn convention `module:attr`, attr defaults to `app`) and the spec (default: `openapi.json`). Exit `0` in sync · `1` drift found · `2` the check couldn't run (bad module, unreadable spec, Swagger 2.0, broken app import — **never** confused with drift).

In CI, it's one step:

```yaml
- run: python docs_drift.py myapp.main:app docs/openapi.json
```

Demo without a repo of your own:

```bash
uv run --with fastapi python3 docs_drift.py fixtures.demo_api:app fixtures/openapi-drifted.json   # 5 planted drifts, exit 1
```

## What it looks like

```text
docs-drift — fixtures.demo_api:app vs fixtures/openapi-drifted.json

 ✗ DELETE /items/{item_id} — undocumented: exists in the app, missing from the spec
 ✗ GET /items/{item_id} — param drift: query param "verbose" is in the app but missing from the spec
 ✗ GET /reports — ghost: documented, but the app doesn't serve it
   → fix: remove GET /reports from the spec, or restore the route
 ✗ GET /search — param drift: query param "cursor" is documented but the app ignores it
 ✗ GET /search — param drift: query param "limit": spec says required, app says optional

5 drift(s): 1 ghost · 3 param drift · 1 undocumented — the spec is lying
→ fix all of the above: python3 -c "import json; import fixtures.demo_api as m; print(json.dumps(m.app.openapi(), indent=2))" > fixtures/openapi-drifted.json
```

The tool never edits the spec — it prints the exact re-export command, you run it when you agree (diagnose and tell, don't touch).

Validated read-only against a real codebase: **TobikoData/sqlmesh** at HEAD — in sync, 25 endpoints, exit 0, against both committed specs and the versions they had in Sep 2025. Pointed at their Nov-2024 spec, it catches real, unplanted drift: `GET /api/commands/test` still documents `verbose`, which the app renamed to `verbosity` in Mar 2025 (sqlmesh #3982). Details in the [build log](BUILD-LOG.md), including the real-repo crash that taught the exit-code rule: *a linter whose "cannot check" looks like "drift found" is a CI footgun.*

## Validate it works

```bash
uv venv && uv pip install fastapi pytest   # or any env with fastapi
python3 test_drift.py        # 18 assert-based checks — or the same functions via: pytest test_drift.py -q
docker build -t docs-drift . && docker run --rm docs-drift   # self-proving: checks green AND drift must exit 1
```

Checks are deterministic (pure diff logic on dicts; CLI exercised via subprocess with `NO_COLOR` forced). The fixture specs were exported from the fixture app itself, then aged by hand with exactly five planted drifts — so a green run means the planted drift, no more, no less.

## Deliberately not built

No spec editing or auto-regeneration (lint and fail; the fix command is printed, never executed), no schema/response-model deep-diff (params and endpoints are the contract that breaks integrations; the rest is a `ponytail:` marker with a trigger), no Swagger 2.0 translation, no hosted UI, no multi-app mode. YAML specs only if pyyaml already exists in your app's env — JSON is what `app.openapi()` natively produces.

## Files

- `docs_drift.py` — the tool (214 lines, stdlib only)
- `test_drift.py` — the one runnable check (plain asserts; pytest-collectable)
- `fixtures/demo_api.py` + `fixtures/openapi-{synced,drifted}.json` — the app under docs and its two specs
- `Dockerfile` — the self-proving container
