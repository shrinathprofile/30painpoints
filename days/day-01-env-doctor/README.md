# env-doctor

**Day 01 of 30** · [Retro](RETRO.md) · [Build log](BUILD-LOG.md)

> "Guys I'm tired of spending hours configuring my development environment" — r/webdev, 504 upvotes, 198 comments
> [thread →](https://www.reddit.com/r/webdev/comments/1jgrdgl/guys_im_tired_of_spending_hours_configuring_my/)

A zero-dependency CLI that reads a repo's **own manifests** — `.nvmrc`, `package.json` (engines, lockfiles, node_modules), `.env.example` vs `.env`, `pyproject.toml` (requires-python) — and prints every environment mismatch with the exact fix command. **Diagnose + tell. Never touch.**

Non-zero exit on any error, so you can drop it at the top of onboarding scripts or CI.

## Run it

```bash
# needs Node ≥ 22.18 (native TypeScript type-stripping — no build step, no deps)
node env-doctor.ts /path/to/any/repo
```

That's the whole install. There is no `npm install`.

## What it looks like

Real run against `fixtures/broken-repo` (a repo with 4 planted problems):

```text
env-doctor — diagnosing fixtures/broken-repo

 ✗ Node version (.nvmrc)
   .nvmrc wants 20.11.0, running v22.23.1
   → fix: nvm install && nvm use
 ✗ Node version (package.json engines)
   engines wants ">=18 <20", running v22.23.1
   → fix: nvm install 18 && nvm use 18
 ✓ Package manager
   npm (package-lock.json)
 ✗ Dependencies
   2 packages declared, node_modules missing
   → fix: npm ci
 ✗ Env vars (.env.example)
   .env is missing 2 key(s): API_KEY, DATABASE_URL
   → fix: add them to .env — see .env.example for the expected shape
 ✓ Python version (requires-python)
   running 3.15.0, satisfies >=3.9

4 error(s) · 2 passed
fix top-down; the first error is usually the one causing the rest.
```

Exit codes: `0` clean · `1` findings · `2` bad path.

## Checks

| Check | Source of truth | Level |
|-------|-----------------|-------|
| Node version | `.nvmrc` vs running Node (bare major, minor-line, or full) | error (`lts/*`, `node`, `stable` → warn: can't resolve nvm aliases offline) |
| Node version | `package.json` `engines.node` (node-semver subset: `>= < > <= ^ ~ \|\| x`, hyphen ranges) | error |
| Package manager | which lockfiles exist (multiple → CI ambiguity) | warn |
| Dependencies | deps declared but `node_modules` missing | error |
| Env vars | `.env.example` keys vs `.env` keys | error |
| Python | `pyproject.toml` `requires-python` vs `python3 --version` (PEP 440: `>= < ~= == != .*`) | error / warn if no python3 |

## Validate it works

```bash
npm run check    # 18 assert-based checks incl. fixture end-to-end + symlinked-bin run (deterministic via injected probe)
```

The self-check injects a fixed runtime probe (`{node, python}`) instead of reading the machine, so it passes identically everywhere.

## Deliberately not built

No auto-fixing (`--fix`), no Docker/devcontainer generation, no ecosystems beyond Node/Python, no `engines.npm` check, no registry lookups. Every cut is marked in the code with a `ponytail:` comment.

## Files

- `env-doctor.ts` — the tool (250 lines, stdlib only)
- `self-check.ts` — the one runnable check
- `fixtures/broken-repo/`, `fixtures/clean-repo/` — deterministic demo repos
