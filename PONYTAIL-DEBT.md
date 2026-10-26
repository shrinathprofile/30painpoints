# Ponytail Debt Ledger

Regenerated weekly via /ponytail-debt. Every shortcut names its ceiling and upgrade trigger.

| File:Line | Simplified | Ceiling | Upgrade trigger |
|-----------|------------|---------|-----------------|
| day-01/env-doctor.ts `parseVersion` | unparseable version → 0.0.0 | only fed strings we chose to trust | first third-party version string parsed |
| day-01/env-doctor.ts `satisfiesComp ^` | `^0.x` treated as "same major" | correct for runtime engines, wrong for package deps | reuse in a package-dependency context |
| day-01/env-doctor.ts `satisfiesRange` | PEP 440 exclusive ranges (`3.9-3.12`) unsupported | requires-python never uses them in the wild | first real-world sighting |
| day-01/env-doctor.ts `scanRepo` | `engines.npm` unchecked | ~500ms spawn for a version nobody pins | user report |
| day-01/env-doctor.ts header | single-file CLI, `parseArgs` over commander | one flag, one positional | a second subcommand |

5 markers, all low-severity, all with named triggers.
