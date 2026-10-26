#!/usr/bin/env node
// env-doctor — diagnose a repo's dev environment. Tell, don't touch.
//
// ponytail: single-file CLI, zero dependencies — node:util parseArgs instead of
// commander, native TS type-stripping instead of a build step (needs Node >= 22.18).
// Upgrade trigger: a second subcommand or a flags conflict — then adopt commander.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

export type Finding = {
  level: "error" | "warn" | "ok";
  check: string;
  title: string;
  detail?: string;
  fix?: string;
};

type Probe = { node: string; python: string | null };

// ---------- pure logic (all of it exercised by self-check.ts) ----------

type Ver = [number, number, number];

function parseVersion(v: string): Ver {
  const m = v.trim().replace(/^v/i, "").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  // ponytail: unparseable → 0.0.0; only ever fed strings we chose to trust
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function cmpVer(a: Ver, b: Ver): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// PEP 440 equality: "3.11.*" is a prefix match, "3.11" means exactly 3.11.0
function pepEquals(ver: Ver, raw: string): boolean {
  if (!raw.endsWith(".*")) return cmpVer(ver, parseVersion(raw)) === 0;
  return raw.slice(0, -2).split(".").every((n, i) => ver[i] === Number(n));
}

function satisfiesComp(ver: Ver, comp: string): boolean {
  if (comp === "*") return true;
  const m = comp.match(/^(~=|==|!=|>=|<=|>|<|=|\^|~)?\s*(.+)$/)!;
  const op = m[1] ?? "=";
  const raw = m[2].replace(/^v/i, "");
  const spec = parseVersion(raw);
  switch (op) {
    case ">=": return cmpVer(ver, spec) >= 0;
    case "<=": return cmpVer(ver, spec) <= 0;
    case ">":  return cmpVer(ver, spec) > 0;
    case "<":  return cmpVer(ver, spec) < 0;
    case "==": return pepEquals(ver, raw);
    case "!=": return !pepEquals(ver, raw);
    case "~=": // PEP 440 compatible release: ~=3.9 → >=3.9, ==3.*
      return cmpVer(ver, spec) >= 0 && pepEquals(ver, `${raw.split(".").slice(0, -1).join(".")}.*`);
    case "^": // ponytail: ^0.x treated as "same major, not below" — right for runtime engines, wrong for package deps
      return ver[0] === spec[0] && cmpVer(ver, spec) >= 0;
    case "~":
      return ver[0] === spec[0] && ver[1] === spec[1] && cmpVer(ver, spec) >= 0;
    default: { // bare / = / x-ranges: "20" or "20.x" → major; "20.11" → major.minor; full → exact
      const parts = raw.split(".");
      if (parts[0] === "x" || parts[0] === "*") return true;
      if (parts.length === 1 || parts[1] === "x" || parts[1] === "*") return ver[0] === spec[0];
      if (parts.length === 2 || parts[2] === "x" || parts[2] === "*") return ver[0] === spec[0] && ver[1] === spec[1];
      return cmpVer(ver, spec) === 0;
    }
  }
}

/** node-semver-style ranges: "||" unions of space/comma-separated AND-groups.
 *  ponytail: PEP 440 exclusive ranges ("3.9-3.12") unsupported — vanishingly rare in requires-python. */
export function satisfiesRange(version: string, range: string): boolean {
  return range
    .replace(/(~=|==|!=|>=|<=|>|<|=|\^|~)\s+/g, "$1") // ">= 18" → ">=18"
    .replace(/(\S+)\s+-\s+(\S+)/g, (_, lo, hi) => `>=${lo} ${hyphenUpper(hi)}`) // "18 - 24" → ">=18 <25"
    .split("||")
    .some((group) =>
      group.trim().split(/[\s,]+/).filter(Boolean)
        .every((c) => satisfiesComp(parseVersion(version), c)),
    );
}

// node-semver hyphen upper bound: a partial version includes its whole line ("24" → <25, "24.1" → <24.2)
function hyphenUpper(hi: string): string {
  const p = hi.replace(/^v/i, "").split(".").map(Number);
  if (p.length >= 3) return `<=${hi}`;
  return p.length === 2 ? `<${p[0]}.${p[1] + 1}` : `<${p[0] + 1}`;
}

export function parseEnvKeys(content: string): string[] {
  const keys: string[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

// ---------- scanner ----------

function detectRuntime(): Probe {
  const r = spawnSync("python3", ["--version"], { encoding: "utf8" });
  const python = r.status === 0 ? r.stdout.trim().replace(/^Python\s+/i, "") : null;
  return { node: process.version, python };
}

const LOCKFILES: Record<string, string> = {
  "package-lock.json": "npm",
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "pnpm",
  "bun.lockb": "bun",
  "bun.lock": "bun",
};

export function scanRepo(dir: string, probe: Probe = detectRuntime()): Finding[] {
  const out: Finding[] = [];
  const has = (f: string) => existsSync(join(dir, f));
  const read = (f: string) => readFileSync(join(dir, f), "utf8");

  // Node side
  let pkg: any = null;
  if (has("package.json")) {
    try {
      pkg = JSON.parse(read("package.json"));
    } catch (e) {
      out.push({ level: "error", check: "package-json", title: "package.json", detail: `not valid JSON — ${(e as Error).message}`, fix: "fix the syntax error in package.json (npm can't read it either)" });
    }
  }

  if (has(".nvmrc")) {
    const want = read(".nvmrc").trim().replace(/^v/i, "");
    if (/^(lts\/|node$|stable$)/i.test(want)) {
      out.push({ level: "warn", check: "nvmrc", title: "Node version (.nvmrc)", detail: `.nvmrc pins the alias "${want}" — I can't resolve nvm aliases offline`, fix: `nvm install ${want} && nvm use ${want}` });
    } else {
      const range = /^\d+$/.test(want) ? want : `~${want}`; // bare major, or "same minor line"
      satisfiesRange(probe.node, range)
        ? out.push({ level: "ok", check: "nvmrc", title: "Node version (.nvmrc)", detail: `running ${probe.node}, matches ${want}` })
        : out.push({ level: "error", check: "nvmrc", title: "Node version (.nvmrc)", detail: `.nvmrc wants ${want}, running ${probe.node}`, fix: "nvm install && nvm use" });
    }
  }

  if (pkg?.engines?.node) {
    const range = String(pkg.engines.node);
    if (satisfiesRange(probe.node, range)) {
      out.push({ level: "ok", check: "engines-node", title: "Node version (package.json engines)", detail: `running ${probe.node}, satisfies ${range}` });
    } else {
      const hint = range.match(/\d+(?:\.\d+)*/)?.[0] ?? "a matching version";
      out.push({ level: "error", check: "engines-node", title: "Node version (package.json engines)", detail: `engines wants "${range}", running ${probe.node}`, fix: `nvm install ${hint} && nvm use ${hint}` });
    }
  }
  // ponytail: engines.npm unchecked — spawning npm costs ~500ms for a version nobody pins meaningfully

  if (pkg) {
    const present = Object.keys(LOCKFILES).filter(has);
    if (present.length > 1) {
      out.push({ level: "warn", check: "lockfiles", title: "Package manager", detail: `multiple lockfiles (${present.join(", ")}) — CI can't tell which one owns the repo`, fix: `delete the stale lockfile(s), keep ${LOCKFILES[present[0]]}` });
    } else if (present.length === 1) {
      out.push({ level: "ok", check: "lockfiles", title: "Package manager", detail: `${LOCKFILES[present[0]]} (${present[0]})` });
    }
    const depCount = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length;
    if (depCount > 0 && !has("node_modules")) {
      const pm = present.length ? LOCKFILES[present[0]] : "npm";
      const fix = !present.length ? "npm install"
        : pm === "npm" ? "npm ci"
        : `${pm} install --frozen-lockfile`;
      out.push({ level: "error", check: "node-modules", title: "Dependencies", detail: `${depCount} packages declared, node_modules missing`, fix });
    }
  }

  if (has(".env.example")) {
    const want = parseEnvKeys(read(".env.example"));
    const got = has(".env") ? parseEnvKeys(read(".env")) : [];
    const missing = want.filter((k) => !got.includes(k));
    if (!has(".env")) {
      out.push({ level: "error", check: "env-keys", title: "Env vars (.env.example)", detail: ".env doesn't exist; the example defines the keys the app expects", fix: "cp .env.example .env  # then fill in real values" });
    } else if (missing.length) {
      out.push({ level: "error", check: "env-keys", title: "Env vars (.env.example)", detail: `.env is missing ${missing.length} key(s): ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ` (+${missing.length - 8} more)` : ""}`, fix: "add them to .env — see .env.example for the expected shape" });
    } else {
      out.push({ level: "ok", check: "env-keys", title: "Env vars (.env.example)", detail: `.env has all ${want.length} expected key(s)` });
    }
  }

  // Python side
  if (has("pyproject.toml")) {
    const m = read("pyproject.toml").match(/requires-python\s*=\s*["']([^"']+)["']/);
    if (m) {
      if (!probe.python) {
        out.push({ level: "warn", check: "python", title: "Python version (requires-python)", detail: `wants "${m[1]}" but no python3 on PATH — can't verify`, fix: "install python3 (pyenv install && pyenv local, or brew install python3)" });
      } else if (satisfiesRange(probe.python, m[1])) {
        out.push({ level: "ok", check: "python", title: "Python version (requires-python)", detail: `running ${probe.python}, satisfies ${m[1]}` });
      } else {
        out.push({ level: "error", check: "python", title: "Python version (requires-python)", detail: `pyproject wants "${m[1]}", running ${probe.python}`, fix: "pyenv install && pyenv local  # pick a version in the range" });
      }
    }
  }

  if (out.length === 0) {
    out.push(pkg || has("pyproject.toml")
      ? { level: "ok", check: "nothing", title: "Nothing to check", detail: "no .nvmrc / engines / .env.example / requires-python found — this repo pins nothing" }
      : { level: "error", check: "manifest", title: "No manifest found", detail: "no package.json or pyproject.toml here", fix: "run env-doctor from the repo root" });
  }
  return out;
}

// ---------- CLI ----------

const paint = (code: string, s: string) =>
  process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s;

function print(findings: Finding[], dir: string): void {
  console.log(`env-doctor — diagnosing ${dir}\n`);
  for (const f of findings) {
    const sym = f.level === "error" ? paint("31", "✗") : f.level === "warn" ? paint("33", "!") : paint("32", "✓");
    console.log(` ${sym} ${f.title}`);
    if (f.detail) console.log(`   ${f.detail}`);
    if (f.fix) console.log(`   ${paint("2", `→ fix: ${f.fix}`)}`);
  }
  const errors = findings.filter((f) => f.level === "error").length;
  const warns = findings.filter((f) => f.level === "warn").length;
  const oks = findings.filter((f) => f.level === "ok").length;
  console.log(`\n${errors ? paint("31", `${errors} error(s)`) : paint("32", "environment looks good")}${warns ? ` · ${warns} warning(s)` : ""} · ${oks} passed`);
  if (errors) console.log(paint("2", "fix top-down; the first error is usually the one causing the rest.\n"));
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { help: { type: "boolean", short: "h" } },
  });
  if (values.help) {
    console.log("usage: env-doctor [path]   # diagnose a repo's environment (default: .)");
    return;
  }
  const dir = resolve(positionals[0] ?? ".");
  if (!existsSync(dir)) {
    console.error(`env-doctor: path not found: ${dir}`);
    process.exitCode = 2;
    return;
  }
  const findings = scanRepo(dir);
  print(findings, dir);
  process.exitCode = findings.some((f) => f.level === "error") ? 1 : 0;
}

// realpath: npm's bin / npx / npm link run us through a symlink
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
