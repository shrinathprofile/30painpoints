# git-digest

The series' shared **git-log porcelain kernel** — extracted verbatim from day-08's `standup-prep.ts` on **day-11**, the extraction day-08's brief named ("day-11, the named first importer").

What lives here (and nothing more):

- `parseLog` — NUL-prefixed, `\x1f`-joined records, strict-epoch inert counting
- `subjectArea` / `cleanSubject` — the subject's own leading token as the area
- `clip` / `sanitize` — rune-boundary clips, Unicode control pictures (display safety, D06/D08)
- `parseSince` / `windowStart` — local-midnight window math (no UTC trap)
- `probeRepo` — truthful refusal: git-missing ≠ not-a-repo ≠ bare
- `readIdentity` / `filterMine` — two-pass email-authoritative identity
- `windowFilter` — author-date window in JS; future-dated excluded *and counted*
- `makeGit` / `envClock` — real-world adapters (spawn with truthful failure marking; pinned-clock knob)

What deliberately does NOT: anything LLM, anything per-tool rendering, hash+numstat parsing (day-11's different porcelain shape stays local to its only importer until a second exists).

**No self-check of its own.** The package is pinned by its importers' suites, which exercise it through real imports:

- day-08: 41 checks (`cd days/day-08-standup-prep && npm run check`)
- day-11: see `days/day-11-proof-report/`

Import (Node ≥ 22.18, native type-stripping, explicit `.ts` extension):

```ts
import { parseLog, windowFilter } from "../../packages/git-digest/git-digest.ts";
```

The extraction is *proven* by day-08's byte-precise 41-check suite passing unchanged after day-08 was rewired onto this package.
