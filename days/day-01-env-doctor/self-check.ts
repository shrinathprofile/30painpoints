// self-check — the one runnable check. Assert-based, no framework.
// Run: node self-check.ts   (or: npm run check)

import assert from "node:assert/strict";
import { satisfiesRange, parseEnvKeys, scanRepo } from "./env-doctor.ts";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// fixed probe → deterministic results on any machine
const probe = { node: "v22.23.1", python: "3.15.0" };

let n = 0;
const check = (label: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${label}`); };

// --- satisfiesRange: node-semver subset ---
check(">= bounds", () => {
  assert.equal(satisfiesRange("22.23.1", ">=22"), true);
  assert.equal(satisfiesRange("18.0.0", ">=20"), false);
});
check("< upper bounds (AND group)", () => {
  assert.equal(satisfiesRange("19.9.9", ">=18 <20"), true);
  assert.equal(satisfiesRange("21.0.0", ">=18 <20"), false);
});
check("^ stays in major", () => {
  assert.equal(satisfiesRange("20.5.0", "^20.1.0"), true);
  assert.equal(satisfiesRange("21.0.0", "^20.1.0"), false);
  assert.equal(satisfiesRange("20.0.9", "^20.1.0"), false);
});
check("~ stays in minor", () => {
  assert.equal(satisfiesRange("20.11.5", "~20.11.0"), true);
  assert.equal(satisfiesRange("20.12.0", "~20.11.0"), false);
  assert.equal(satisfiesRange("20.10.9", "~20.11.0"), false);
});
check("x-ranges and bare majors", () => {
  assert.equal(satisfiesRange("20.9.1", "20.x"), true);
  assert.equal(satisfiesRange("21.0.0", "20.x"), false);
  assert.equal(satisfiesRange("20.9.1", "20"), true);
  assert.equal(satisfiesRange("20.11.9", "20.11"), true);
  assert.equal(satisfiesRange("20.12.0", "20.11"), false);
  assert.equal(satisfiesRange("20.11.0", "20.11.0"), true);
  assert.equal(satisfiesRange("20.11.1", "20.11.0"), false);
  assert.equal(satisfiesRange("19.0.0", "*"), true);
});
check("|| unions", () => {
  assert.equal(satisfiesRange("16.20.2", "^14 || ^16 || >=18"), true);
  assert.equal(satisfiesRange("17.0.0", "^14 || ^16 || >=18"), false);
});
check("PEP 440 comma form (requires-python)", () => {
  assert.equal(satisfiesRange("3.11.4", ">=3.11,<3.13"), true);
  assert.equal(satisfiesRange("3.13.0", ">=3.11,<3.13"), false);
});
check("v-prefix and unparsable tolerance", () => {
  assert.equal(satisfiesRange("v22.23.1", ">=22"), true);
  assert.equal(satisfiesRange("22.23.1", ">= 22"), true);
});
check("space after operator (\">= 18\" is not the bare major 18)", () => {
  assert.equal(satisfiesRange("22.23.1", ">= 18"), true);
  assert.equal(satisfiesRange("22.23.1", ">= 18 < 22"), false);
  assert.equal(satisfiesRange("3.15.0", ">= 3.9, < 4"), true);
});
check("hyphen ranges (partial upper bound includes its whole line)", () => {
  assert.equal(satisfiesRange("22.23.1", "18 - 24"), true);
  assert.equal(satisfiesRange("24.9.9", "18 - 24"), true);
  assert.equal(satisfiesRange("25.0.0", "18 - 24"), false);
  assert.equal(satisfiesRange("17.9.9", "18 - 24"), false);
  assert.equal(satisfiesRange("20.11.5", "18 - 20.11"), true);
  assert.equal(satisfiesRange("20.12.0", "18 - 20.11"), false);
  assert.equal(satisfiesRange("20.11.1", "18 - 20.11.0"), false);
});
check("PEP 440 ~= compatible release", () => {
  assert.equal(satisfiesRange("3.15.0", "~=3.9"), true);
  assert.equal(satisfiesRange("3.8.9", "~=3.9"), false);
  assert.equal(satisfiesRange("4.0.0", "~=3.9"), false);
  assert.equal(satisfiesRange("3.9.7", "~=3.9.2"), true);
  assert.equal(satisfiesRange("3.10.0", "~=3.9.2"), false);
});
check("PEP 440 == / != with and without .*", () => {
  assert.equal(satisfiesRange("3.15.0", "==3.15.*"), true);
  assert.equal(satisfiesRange("3.14.2", "==3.15.*"), false);
  assert.equal(satisfiesRange("3.11.0", "==3.11"), true);
  assert.equal(satisfiesRange("3.11.4", "==3.11"), false);
  assert.equal(satisfiesRange("3.15.0", ">=3.10,!=3.11.*"), true);
  assert.equal(satisfiesRange("3.11.4", ">=3.10,!=3.11.*"), false);
});

// --- parseEnvKeys ---
check("env parsing: keys, comments, export prefix, blanks", () => {
  assert.deepEqual(
    parseEnvKeys("# comment\n\nAPI_KEY=x\n  export PORT=3000\nQUOTED=\"a=b\"\nnot a assignment"),
    ["API_KEY", "PORT", "QUOTED"],
  );
});

// --- scanRepo end-to-end on fixtures (fixed probe) ---
check("broken-repo: exactly the 4 planted errors, each with a fix", () => {
  const findings = scanRepo(`${here}/fixtures/broken-repo`, probe);
  const errors = findings.filter((f) => f.level === "error");
  assert.deepEqual(
    errors.map((f) => f.check).sort(),
    ["engines-node", "env-keys", "node-modules", "nvmrc"],
  );
  assert.ok(errors.every((f) => f.fix && f.fix.length > 0), "every error carries a fix command");
  assert.equal(findings.filter((f) => f.level === "warn").length, 0);
  assert.equal(findings.filter((f) => f.level === "ok").length, 2); // lockfile + python
});
check("clean-repo: zero errors under the probe", () => {
  const findings = scanRepo(`${here}/fixtures/clean-repo`, probe);
  assert.equal(findings.filter((f) => f.level === "error").length, 0);
  assert.equal(findings.filter((f) => f.level === "ok").length, 3); // nvmrc + engines + env-keys
});

// --- scanRepo edge cases on throwaway repos ---
const tmpRepo = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "env-doctor-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
};
check("invalid package.json → error finding, not a crash", () => {
  const findings = scanRepo(tmpRepo({ "package.json": "{" }), probe);
  assert.deepEqual(findings.map((f) => [f.level, f.check]), [["error", "package-json"]]);
  assert.ok(findings[0].fix);
});
check(".nvmrc aliases (node / stable / lts/*) → warn, not error", () => {
  for (const alias of ["node", "stable", "lts/*", "lts/iron"]) {
    const findings = scanRepo(tmpRepo({ ".nvmrc": `${alias}\n`, "package.json": "{}" }), probe);
    assert.deepEqual(findings.map((f) => [f.level, f.check]), [["warn", "nvmrc"]], alias);
  }
});
check("run through a symlink (npm bin / npx / npm link) still runs main()", () => {
  const link = join(mkdtempSync(join(tmpdir(), "env-doctor-")), "env-doctor");
  symlinkSync(join(here, "env-doctor.ts"), link);
  const r = spawnSync(process.execPath, [link, join(here, "fixtures/broken-repo")], { encoding: "utf8" });
  assert.equal(r.status, 1, "broken-repo must exit 1");
  assert.match(r.stdout, /4 error\(s\)/);
});

console.log(`\nself-check: ${n} checks passed (${probe.node} / python ${probe.python})`);
