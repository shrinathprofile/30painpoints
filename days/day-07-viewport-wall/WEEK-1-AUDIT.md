# Week-1 ponytail-audit — days 01–06

> Run day-07 (protocol Sunday) by a fresh-context agent over the six shipped CLIs.
> Scope: over-engineering only. It lists; it applies nothing. Cuts applied separately.

1. `stdlib:` hand-rolled `readLines` loop (16 lines) → `for sc := bufio.NewScanner(in); sc.Scan();` (8 lines, `sc.Err()` replaces the EOF switch). [day-06-loglens/loglens.go:743]
2. `yagni:` hyphen-range preprocessing + `hyphenUpper` — reachable only from `engines.node`; `.nvmrc` feeds `~X`/bare and PEP 440 has no hyphen ranges (the file says so). → nothing. [day-01-env-doctor/env-doctor.ts:79]
3. `delete:` `ts := "—"` block — assigned, never read, silenced by `_ = ts`; 5 dead lines. → nothing. [day-06-loglens/loglens.go:529]
4. `shrink:` `formatBytes` loop + unreachable TB return → identical-output 6-liner. [day-03-nuke-caches/nuke-caches.ts:156]
5. `stdlib:` hand-rolled tally dict → `collections.Counter(f.title for f in findings)`. [day-04-docs-drift/docs_drift.py:176]
6. `shrink:` `exitCode()` one-expression wrapper, one production caller → inline. [day-02-stale-pr-wrangler/stale-pr.ts:169]
7. `delete:` `Finding.level` — always `"error"`, nothing reads it; a copied shape that lost its consumer. [day-04-docs-drift/docs_drift.py:32]
8. `delete:` `export const exitCode` — one caller, not consumed by self-check → inline. [day-05-todo-debt/todo-debt.ts:252]
9. `shrink:` re-inlined age ternary where `age()` helper exists 160 lines above → `age(r.ageDays).padStart(5)`. [day-05-todo-debt/todo-debt.ts:290]

**net: −28 lines, −0 deps.**

Deliberately NOT flagged (series discipline, verified): hand-rolled arg parses, `Api`/`World` DI seams (self-checks inject fakes — checked), `reorderArgs`, optional-YAML, every `ponytail:`-marked shortcut (ledger-tracked), and cross-day copies that haven't drifted (`firstLine`, `cell`, realpath-main guard, `createApi`).

**Week-1 verdict:** six zero-dep CLIs, nothing to remove but my own leftovers — dead code the compiler should've caught, a 16-line bufio.Scanner reimplementation, version-ranges no input ever feeds, an unreachable branch, a hand-rolled Counter, and wrappers tested for their own sake.
