# IDEA-BRIEF — Day 04: docs-drift

> Written BEFORE any code. If any section is blank at build start, the build doesn't start.

## The complaint (evidence)
- **Subreddit:** r/devops
- **Thread / quote:** "How are DevOps teams keeping API documentation up to date?" — the same question recurs across 4 subreddits going back years; docs rot quietly until an integration breaks and someone finds out in production. (Evidence pre-verified 2026-10-24 in `docs/02-THE-30-IDEAS.md`; today's re-fetch of the thread was blocked by Reddit's bot wall — noted honestly, not quietly dropped.)
- **Why I believe it's recurring:** "keep the docs current" is a chore with no enforcement point. FastAPI auto-generates interactive docs, so teams assume docs can't rot — but the spec they *hand to consumers* (the committed `openapi.json` that feeds the docs site, the client codegen, the partner onboarding) is a snapshot, and snapshots rot. Nothing in CI fails when the app and the snapshot disagree, so they always eventually disagree.
- **Source URL:** https://www.reddit.com/r/devops/comments/1ov1ohe/how_are_devops_teams_keeping_api_documentation_up/

## Why this should exist (ponytail rung 1)
FastAPI already knows its own routes — `app.openapi()` *is* the truth. The one thing that doesn't exist is the cheap enforcement step: a check that diffs the committed spec against the app's live spec and fails CI on disagreement. The diff already exists as two dicts; the product is the gate.

## The people hurting
Any team that publishes an OpenAPI spec for consumers — API maintainers whose partner integrations break on unannounced param changes, and the consumers who coded against a spec that was quietly stale.

## Scope
- **30-minute floor (fallback):** list routes present in the app but missing from the committed spec. Done.
- **Today's target:** a stdlib-only Python CLI `docs_drift.py`. It imports the app (uvicorn convention `module:attr`), asks FastAPI for its own spec via `app.openapi()` — never parses source code — normalizes both sides to (method, path, params) endpoint sets, and reports three drift classes: undocumented endpoints, ghost endpoints, and param drift (missing/extra path or query params, required-flag flips). Copy-paste fix command per finding (the re-export one-liner). Exit 0/1/2 (in sync / drift found / usage error) so it drops straight into CI.
- **Deliberately NOT building:** no spec editing or auto-regeneration (lint and fail — the fix command is printed, not executed), no auth-flow or schema/response-model deep-diff, no Swagger 2.0, no hosted UI, no multi-app mode. Every cut gets a `ponytail:` marker.

## Stack of the day
Python + FastAPI + pytest + Dockerfile (the stack card from `02-THE-30-IDEAS.md`). The tool itself is stdlib-only (argparse, json, importlib) — FastAPI appears as the *provider under test*, pytest as an optional runner for the same plain-assert checks (protocol's no-framework rule beats the stack card; the card is honored by making the checks pytest-collectable, not pytest-dependent). Maps to FastAPI (SO-2025's biggest framework climber) + the Docker/CI pair.

## Definition of done
A stranger with a FastAPI repo and a committed `openapi.json` can run `python docs_drift.py myapp.main:app openapi.json` and in under 5 seconds see either "in sync" or a numbered list of exactly which endpoints/params lie — verified before shipping against a fixture app with planted drift, a clean re-export (exit 0), the CLI edge matrix (bad module / missing file / invalid JSON → 2), and at least one real third-party repo, not just fixtures.
