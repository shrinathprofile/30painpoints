# RETRO — Day 04: docs-drift

> No retro, no post. The post is a byproduct of the work.

## What I learned
- **Technical:** diff specs, not source. `app.openapi()` IS the app's contract — the same dict the deployed `/openapi.json` serves. Asking the framework for its own spec turns "parse decorators and infer" (brittle, wrong at the first `include_router`) into a dict-vs-dict comparison where both sides already agree on the schema. Fourth consecutive day of the same pattern wearing a different hat: ask the provider (GitHub API sort order, `pnpm store path`, `killall` semantics, now FastAPI itself), never the side channel.
- **Technical 2:** a CI linter has three outcomes, not two: in sync / drift / **cannot check**. The middle one gets all the design love, but the third is the one that lies — an app that crashes at import exited 1 (drift!) with a stack trace, and CI would have filed the wrong incident. Any exception from importing user code is exit 2 + one line, because user code can raise anything, including inside framework internals.
- **Meta:** day-03's retro set one carry-over ("validate against a real drifted repo, not just fixtures") and it found the day's worst bug within minutes — the same real-run habit that caught npm's bin link (day 1), GitHub's default sort (day 2), and root's mDNSResponder (day 3). Four for four. The validation IS the product; the tool is the excuse to run it.
- **Meta 2 (process slip, caught):** the root README's index silently missed Day 03 — "nothing gets posted without the retro" has no matching rule for "the index gets updated every day". Fixed with Day 04's entry; the check is now part of the ship phase mentally.

## Reusable artifact
The `extract()` + `diff()` pair: a ~60-line, stdlib-only OpenAPI endpoint normalizer + differ (path-item/operation param merge, method normalization, required semantics). Any future spec work — Day 29 rebuild, a spec linter for another framework — inherits it. Also: the self-proving Dockerfile CMD pattern (checks green AND the failure path must fail), reusable on any day with a Docker card.

## Ponytail debt created
Four markers (see BUILD-LOG): argparse ceiling, params-subset comparison, YAML-behind-pyaml, Swagger 2.0 rejection. All low-severity with named triggers. Ledger updated (14 → 18).

## Numbers
- Time spent: ~3h (build-day box, stretched by the real-repo install matrix)
- Token spend (est.): ~160k across brief + build + validation + docs + post
- Self-check passing: yes — 18/18 (16 at first green + 2 regression bundles), via both the stdlib runner and pytest; Docker self-proof green; real-repo matrix: sqlmesh HEAD in sync ×3 specs, exit 0/1/2 matrix verified pipe-free

## Tomorrow
Day 05 (TODO-debt indexer, light day): the exit-code trichotomy carries over to a GitHub Action (drift found vs action broken must read differently in the log), and the provider rule again — TODO age comes from `git blame`, not from parsing dates out of comments.

## Honest failures
- The tool's printed fix command said `python` where macOS only has `python3` — unusable copy-paste, found by executing the rendered string, the same class of bug as day 1's `nvm install 1820`.
- My first check-writing pass contained an "any order is fine" assert and two wrong sort-order expectations. Day-03's retro documented this exact failure mode ("a wrong assertion is a bug wearing a green checkmark") two days before I produced three fresh examples of it.
- The fix-command check originally ran the product's own redirect against the fixture file and truncated it to empty when the command failed — a check that destroys its own evidence. Now it redirects to a throwaway target.
- zsh piped exit codes fooled me twice in one day; day-01's build log already documents this trap. Logged lessons are not learned lessons until they cost you nothing.
- The temporal-drift demo (old app vs new spec on a real repo) was abandoned after two dependency-install attempts: 2025 code does not import under 2026 typing-extensions, and there was no lockfile at that commit. The in-sync validation on three real specs stands; the drift path stands on the planted-fixture matrix, honestly labeled.
