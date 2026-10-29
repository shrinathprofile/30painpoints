#!/usr/bin/env node
// nuke-caches — find every dev cache on the machine, show the bytes, clear them in one command.
//
// ponytail: single-file CLI, zero dependencies — node:util parseArgs, native TS
// type-stripping (needs Node >= 22.18). Plan by default, --go clears. Package-manager
// caches go through each PM's own clean command (never a hand-rolled rm of a store);
// rm -rf is restricted to the two documented-disposable bundler dirs.
// Upgrade trigger: a second subcommand or per-cache flags — then adopt commander.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

// ---------- registry (data, not code: each supported cache is one entry) ----------

export type PmSpec = {
  id: string;
  label: string;
  bin: string;
  discover: string[]; // ask the PM where its cache lives — it knows its own layout
  clean: string[];    // the PM's own clean command; we never rm a store ourselves
  note?: string;
};

export const PM_CACHES: PmSpec[] = [
  { id: "npm", label: "npm cache", bin: "npm", discover: ["config", "get", "cache"], clean: ["cache", "clean", "--force"] },
  { id: "pnpm", label: "pnpm store", bin: "pnpm", discover: ["store", "path"], clean: ["store", "prune"], note: "prune removes only unreferenced packages" },
  { id: "yarn", label: "yarn cache", bin: "yarn", discover: ["cache", "dir"], clean: ["cache", "clean"] },
];

export type DirSpec = { id: string; label: string; rel: string };

// build-tool caches inside a project dir — documented-disposable, no clean command exists
export const DIR_CACHES: DirSpec[] = [
  { id: "vite", label: "Vite optimize cache", rel: "node_modules/.vite" },
  { id: "webpack", label: "webpack/babel cache", rel: "node_modules/.cache" },
];

/** DNS flush commands per platform, or null where we don't know a reliable one.
 *  A command with required:false is best-effort — its failure never fails the target
 *  (found the hard way: non-root killall cannot HUP root's mDNSResponder on macOS). */
export type DnsCmd = { bin: string; args: string[]; required?: boolean };

export function dnsFlush(platform: NodeJS.Platform, onPath: (bin: string) => boolean): DnsCmd[] | null {
  if (platform === "darwin")
    return [
      { bin: "dscacheutil", args: ["-flushcache"] },
      { bin: "killall", args: ["-HUP", "mDNSResponder"], required: false },
    ];
  // ponytail: win32 branch untested — no Windows box in this series yet; trigger: a Windows user report
  if (platform === "win32") return [{ bin: "ipconfig", args: ["/flushdns"] }];
  if (onPath("resolvectl")) return [{ bin: "resolvectl", args: ["flush-caches"] }];
  if (onPath("systemd-resolve")) return [{ bin: "systemd-resolve", args: ["--flush-caches"] }];
  return null;
}

// ---------- world (injected, like day-01's probe — self-check fakes all of it) ----------

export type ShResult = { status: number; stdout: string; stderr: string };

export type World = {
  platform: NodeJS.Platform;
  projectDir: string;
  onPath: (bin: string) => boolean;
  sh: (bin: string, args: string[]) => ShResult;
  dirSize: (p: string) => number; // apparent bytes of a dir tree, 0 if missing
  exists: (p: string) => boolean;
  rm: (p: string) => void;
};

// ---------- pure-ish logic: plan + execute (all of it exercised by self-check.ts) ----------

export type Target = {
  kind: "pm" | "dir" | "dns";
  id: string;
  label: string;
  hit: boolean;
  path?: string;             // cache dir (pm) or project path (dir)
  bin?: string;              // pm executable
  clean?: string[];          // pm clean argv
  bytes: number;             // reclaimable estimate; 0 for dns and misses
  reason?: string;           // why it's a miss
  note?: string;
  cmds?: DnsCmd[];           // dns commands
};

export function buildPlan(w: World): Target[] {
  const out: Target[] = [];
  for (const spec of PM_CACHES) {
    if (!w.onPath(spec.bin)) {
      out.push({ kind: "pm", ...spec, hit: false, bytes: 0, reason: `${spec.bin} not on PATH` });
      continue;
    }
    const r = w.sh(spec.bin, spec.discover);
    // first stdout line only — PMs occasionally warn above the value
    const dir = r.status === 0 ? r.stdout.trim().split(/\r?\n/)[0]?.trim() : "";
    if (!dir || dir === "undefined" || dir === "null") {
      out.push({ kind: "pm", ...spec, hit: false, bytes: 0, reason: r.status === 0 ? "reported no cache dir" : firstLine(r.stderr) || `${spec.bin} ${spec.discover.join(" ")} failed` });
      continue;
    }
    if (!w.exists(dir)) {
      out.push({ kind: "pm", ...spec, hit: false, bytes: 0, reason: `${dir} (already empty)` });
      continue;
    }
    out.push({ kind: "pm", ...spec, hit: true, path: dir, bytes: w.dirSize(dir) });
  }
  for (const spec of DIR_CACHES) {
    const p = join(w.projectDir, spec.rel);
    w.exists(p)
      ? out.push({ kind: "dir", ...spec, hit: true, path: p, bytes: w.dirSize(p) })
      : out.push({ kind: "dir", ...spec, hit: false, bytes: 0, reason: "not present" });
  }
  const cmds = dnsFlush(w.platform, w.onPath);
  out.push(cmds
    ? { kind: "dns", id: "dns", label: "DNS resolver", hit: true, bytes: 0, cmds }
    : { kind: "dns", id: "dns", label: "DNS resolver", hit: false, bytes: 0, reason: "no supported flush command on this platform" });
  return out;
}

export type Cleared = { target: Target; reclaimed: number; error?: string; note?: string };

/** Clear one hit target. Bytes come from re-measuring, never from the clean command's word. */
export function clear(t: Target, w: World): Cleared {
  if (t.kind === "pm" && t.bin && t.clean && t.path) {
    const r = w.sh(t.bin, t.clean);
    const reclaimed = Math.max(0, t.bytes - w.dirSize(t.path));
    return r.status === 0
      ? { target: t, reclaimed }
      : { target: t, reclaimed, error: firstLine(r.stderr) || `${t.bin} ${t.clean.join(" ")} exited ${r.status}` };
  }
  if (t.kind === "dir" && t.path) {
    w.rm(t.path);
    return { target: t, reclaimed: Math.max(0, t.bytes - w.dirSize(t.path)) };
  }
  if (t.kind === "dns" && t.cmds) {
    let skipped: string | undefined;
    for (const c of t.cmds) {
      const r = w.sh(c.bin, c.args);
      if (r.status !== 0) {
        const why = firstLine(r.stderr) || `${c.bin} exited ${r.status}`;
        if (c.required === false) {
          skipped = `${c.bin} skipped: ${why}`;
          continue;
        }
        return { target: t, reclaimed: 0, error: why };
      }
    }
    return { target: t, reclaimed: 0, note: skipped };
  }
  return { target: t, reclaimed: 0, error: "unknown target" };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  let v = n;
  for (const u of ["KB", "MB", "GB", "TB"]) {
    v /= 1024;
    if (v < 1024 || u === "TB") return `${v >= 99.95 ? v.toFixed(0) : v.toFixed(1)} ${u}`;
  }
  return `${v.toFixed(1)} TB`;
}

function firstLine(s: string): string {
  return (s || "").trim().split(/\r?\n/)[0] ?? "";
}

// ---------- orchestrator + rendering ----------

const paint = (code: string, s: string) =>
  process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s;

export type RunIo = { log: (s: string) => void };

export function run(go: boolean, w: World, io: RunIo): number {
  const plan = buildPlan(w);
  io.log(`nuke-caches — ${w.projectDir} (${w.platform}${go ? "" : ", dry-run"})\n`);
  for (const t of plan) {
    if (!t.hit) {
      io.log(` ${paint("2", "·")} ${t.label.padEnd(20)} ${paint("2", t.reason ?? "")}`);
      continue;
    }
    const size = t.kind === "dns" ? paint("2", "flush") : formatBytes(t.bytes).padStart(8);
    io.log(` ${paint("32", "✓")} ${t.label.padEnd(20)} ${size}  ${t.path ?? ""}${t.note ? paint("2", `  (${t.note})`) : ""}`);
  }
  const hits = plan.filter((t) => t.hit);
  if (!go) {
    const reclaimable = hits.reduce((n, t) => n + t.bytes, 0);
    io.log(`\n${hits.length} of ${plan.length} targets · ${formatBytes(reclaimable)} reclaimable — rerun with --go to clear`);
    return 0;
  }
  // one target throwing (EACCES on a root-owned file) must not skip the rest or the summary
  const results = hits.map((t): Cleared => {
    try { return clear(t, w); }
    catch (e) { return { target: t, reclaimed: 0, error: (e as Error).message }; }
  });
  io.log("");
  let freed = 0;
  for (const r of results) {
    freed += r.reclaimed;
    const tail = r.error
      ? paint("31", `failed: ${r.error}`)
      : r.target.kind === "dns"
        ? r.note ? `flushed ${paint("2", `(${r.note})`)}` : "flushed"
        : `cleared ${formatBytes(r.reclaimed)}`;
    io.log(` ${r.error ? paint("31", "✗") : paint("32", "✓")} ${r.target.label.padEnd(20)} ${tail}`);
  }
  const failed = results.filter((r) => r.error).length;
  io.log(`\ncleared ${formatBytes(freed)} across ${results.length - failed} target(s)${failed ? paint("31", ` · ${failed} failed`) : ""}`);
  return results.some((r) => r.error) ? 1 : 0;
}

// ---------- the real world (the only impure surface besides io) ----------

// ponytail: apparent bytes, symlinks skipped, hardlink dedup not done (du dedupes inodes) —
// totals can exceed `du`'s; the before/after delta stays truthful either way.
// Trigger: a user report of a wildly-off total vs du.
// Unreadable entries (root-owned files left by `sudo npm i`, races with a running clean)
// are skipped, not fatal — the plan undercounts rather than crashing.
function realDirSize(p: string): number {
  let total = 0;
  const walk = (d: string) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const child = join(d, e.name);
      if (e.isDirectory()) walk(child);
      else if (e.isFile()) try { total += statSync(child).size; } catch { /* vanished or unreadable */ }
    }
  };
  if (existsSync(p)) walk(p);
  return total;
}

function realSh(bin: string, args: string[]): ShResult {
  // win32: npm/pnpm/yarn are .cmd shims, which spawn refuses without a shell (args are
  // fixed constants from the registry, never user input). ponytail: untested, same trigger as dnsFlush.
  const r = spawnSync(bin, args, { encoding: "utf8", shell: process.platform === "win32" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function realWorld(projectDir: string): World {
  return {
    platform: process.platform,
    projectDir,
    onPath: (bin) => realSh(bin, ["--version"]).status === 0,
    sh: realSh,
    dirSize: realDirSize,
    exists: existsSync,
    rm: (p) => rmSync(p, { recursive: true, force: true }),
  };
}

// ---------- CLI ----------

function main(): void {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        help: { type: "boolean", short: "h" },
        go: { type: "boolean" },     // actually clear (default: dry-run plan)
        dir: { type: "string" },     // project dir for bundler caches (default: .)
      },
    }));
  } catch (e) {
    // unknown flag / missing --dir value / stray positional is a usage error (2), not a failed clear (1)
    console.error(`nuke-caches: ${(e as Error).message}\nrun with --help for usage`);
    process.exitCode = 2;
    return;
  }
  if (values.help) {
    console.log(`usage: nuke-caches [--dir <project>] [--go]
  plan by default: what's on this machine, bytes reclaimable per target.
  --go clears: PM-owned clean commands for npm/pnpm/yarn, rm for node_modules/.vite
  and node_modules/.cache, platform DNS flush. Never touches anything else.`);
    return;
  }
  const projectDir = resolve(values.dir ?? ".");
  if (!existsSync(projectDir)) {
    console.error(`nuke-caches: path not found: ${projectDir}`);
    process.exitCode = 2;
    return;
  }
  process.exitCode = run(!!values.go, realWorld(projectDir), { log: console.log });
}

// realpath: running through a symlink (npm bin / npx) must still trigger main()
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
