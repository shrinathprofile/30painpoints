// self-check — the one runnable check. Assert-based, no framework.
// Run: node self-check.ts   (or: npm run check)
//
// process.env.NO_COLOR first: run() renders through paint(), and assertions must not
// depend on whether the check itself was started from a TTY (day-01 lesson: test the
// string, control the environment).

process.env.NO_COLOR = "1";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync as exists, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PM_CACHES, dnsFlush, buildPlan, clear, run, formatBytes,
  type World, type ShResult, type Target,
} from "./nuke-caches.ts";

const here = dirname(fileURLToPath(import.meta.url));
const GB = 1024 ** 3;
const MB = 1024 ** 2;

let n = 0;
const check = (label: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${label}`); };

// --- fake world: records every destructive call, sizes answered from a script ---

type FakeSetup = {
  platform?: NodeJS.Platform;
  projectDir?: string;
  bins?: string[];                  // PMs (and linux dns bins) considered on PATH
  pmDir?: Record<string, string>;   // bin -> discovered cache dir ("" => none reported)
  failDiscover?: string;            // bin whose discover command exits 1
  failClean?: string;               // bin whose clean command exits 1
  failDnsBin?: string;              // dns bin that exits 1 (e.g. killall without root)
  dirs?: string[];                  // paths that "exist"
  sizes?: Record<string, number[]>; // path -> sequential dirSize answers (before, after, ...)
};

function fakeWorld(setup: FakeSetup = {}) {
  const platform = setup.platform ?? "darwin";
  const cleaned: string[] = [];
  const removed: string[] = [];
  const flushed: string[] = [];
  const pmDir = setup.pmDir ?? {};
  const dirs = new Set(setup.dirs ?? []); // discovering a path ≠ the path existing
  const sizes = setup.sizes ?? {};
  const key = (bin: string, args: string[]) => `${bin} ${args.join(" ")}`;
  const world: World = {
    platform,
    projectDir: setup.projectDir ?? "/p",
    onPath: (bin) => (setup.bins ?? []).includes(bin),
    sh: (bin, args): ShResult => {
      const spec = PM_CACHES.find((s) => s.bin === bin);
      if (spec && args.join(" ") === spec.discover.join(" ")) {
        if (setup.failDiscover === bin) return { status: 1, stdout: "", stderr: "EPERM: boom\nsecond line" };
        return { status: 0, stdout: pmDir[bin] ?? "", stderr: "" };
      }
      if (spec && args.join(" ") === spec.clean.join(" ")) {
        if (setup.failClean === bin) return { status: 1, stdout: "", stderr: "EPERM: cannot clean" };
        cleaned.push(key(bin, args));
        return { status: 0, stdout: "", stderr: "" };
      }
      const dns = dnsFlush(platform, () => true) ?? [];
      if (dns.some((c) => c.bin === bin && c.args.join(" ") === args.join(" "))) {
        if (setup.failDnsBin === bin)
          return { status: 1, stdout: "", stderr: "No matching processes belonging to you were found" };
        flushed.push(key(bin, args));
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `unexpected call: ${key(bin, args)}` };
    },
    dirSize: (p) => sizes[p]?.shift() ?? 0,
    exists: (p) => dirs.has(p),
    rm: (p) => removed.push(p),
  };
  return { world, cleaned, removed, flushed };
}

// --- formatBytes ---
check("formatBytes: B through TB, tidy rounding", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(40_054_803), "38.2 MB");
  assert.equal(formatBytes(13 * GB), "13.0 GB");
  assert.equal(formatBytes(Math.round(2.9 * GB)), "2.9 GB");
  assert.equal(formatBytes(512 * MB), "512 MB"); // >= 99.95 drops the decimal
  assert.equal(formatBytes(1.5 * 1024 ** 4), "1.5 TB");
});

// --- dnsFlush ---
check("dnsFlush: darwin pair (killall best-effort), win32, resolvectl, systemd fallback, none", () => {
  const never = () => false;
  assert.deepEqual(dnsFlush("darwin", never), [
    { bin: "dscacheutil", args: ["-flushcache"] },
    { bin: "killall", args: ["-HUP", "mDNSResponder"], required: false },
  ]);
  assert.deepEqual(dnsFlush("win32", never), [{ bin: "ipconfig", args: ["/flushdns"] }]);
  assert.deepEqual(dnsFlush("linux", (b) => b === "resolvectl"), [{ bin: "resolvectl", args: ["flush-caches"] }]);
  assert.deepEqual(dnsFlush("linux", (b) => b === "systemd-resolve"), [{ bin: "systemd-resolve", args: ["--flush-caches"] }]);
  assert.equal(dnsFlush("linux", never), null);
});

// --- buildPlan: full house ---
check("buildPlan: every cache present → 6 hits with paths, bytes, pnpm note", () => {
  const { world } = fakeWorld({
    bins: ["npm", "pnpm", "yarn"],
    pmDir: { npm: "/h/.npm", pnpm: "/h/pnpm/store", yarn: "/h/Caches/Yarn" },
    dirs: ["/h/.npm", "/h/pnpm/store", "/h/Caches/Yarn", "/p/node_modules/.vite", "/p/node_modules/.cache"],
    sizes: { "/h/.npm": [13 * GB], "/h/pnpm/store": [2.9 * GB], "/h/Caches/Yarn": [300 * MB], "/p/node_modules/.vite": [38 * MB], "/p/node_modules/.cache": [12 * MB] },
  });
  const plan = buildPlan(world);
  assert.equal(plan.filter((t) => t.hit).length, 6);
  const npm = plan.find((t) => t.id === "npm")!;
  assert.equal(npm.hit, true);
  assert.equal(npm.path, "/h/.npm");
  assert.equal(npm.bytes, 13 * GB);
  assert.equal(npm.clean!.join(" "), "cache clean --force");
  assert.equal(plan.find((t) => t.id === "pnpm")!.note, "prune removes only unreferenced packages");
  assert.equal(plan.find((t) => t.id === "vite")!.path, "/p/node_modules/.vite");
  assert.equal(plan.at(-1)!.kind, "dns");
});

// --- buildPlan: every miss mode ---
check("buildPlan: not-on-PATH, absent dir, empty + failed discovery", () => {
  const { world } = fakeWorld({
    bins: ["npm"],
    pmDir: { npm: "" }, // npm reports no cache dir
    dirs: [],           // vite/webpack absent
  });
  const plan = buildPlan(world);
  const miss = (id: string) => plan.find((t) => t.id === id)!;
  assert.equal(miss("yarn").reason, "yarn not on PATH");
  assert.equal(miss("npm").reason, "reported no cache dir");
  assert.equal(miss("vite").reason, "not present");
  assert.equal(miss("webpack").reason, "not present");
  const failed = buildPlan(fakeWorld({ bins: ["pnpm"], failDiscover: "pnpm" }).world)
    .find((t) => t.id === "pnpm")!;
  assert.match(failed.reason!, /EPERM: boom/); // first stderr line, not the second
  const empty = buildPlan(fakeWorld({ bins: ["pnpm"], pmDir: { pnpm: "/h/store" } }).world)
    .find((t) => t.id === "pnpm")!;
  assert.match(empty.reason!, /already empty/);
});

check("buildPlan: linux without a flush command → dns miss", () => {
  const plan = buildPlan(fakeWorld({ platform: "linux", bins: ["npm"] }).world);
  assert.equal(plan.at(-1)!.hit, false);
  assert.match(plan.at(-1)!.reason!, /no supported flush command/);
});

// --- run(): dry-run default is the trust boundary ---
check("run dry-run: hits shown, zero destructive calls, exit 0", () => {
  const f = fakeWorld({
    bins: ["npm"],
    pmDir: { npm: "/h/.npm" },
    dirs: ["/h/.npm", "/p/node_modules/.vite"],
    sizes: { "/h/.npm": [13 * GB], "/p/node_modules/.vite": [38 * MB] },
  });
  const lines: string[] = [];
  const code = run(false, f.world, { log: (s) => lines.push(s) });
  assert.equal(code, 0);
  assert.deepEqual(f.cleaned, []);
  assert.deepEqual(f.removed, []);
  assert.deepEqual(f.flushed, []);
  assert.match(lines.join("\n"), /dry-run/);
  assert.match(lines.join("\n"), /13\.0 GB/);
  assert.match(lines.join("\n"), /3 of 6 targets · 13\.0 GB reclaimable/);
});

// --- run --go: the whole point ---
check("run --go: PM cleans via their own commands, rm only bundler dirs, dns flushed", () => {
  const f = fakeWorld({
    bins: ["npm", "pnpm", "yarn"],
    pmDir: { npm: "/h/.npm", pnpm: "/h/store", yarn: "/h/yarn" },
    dirs: ["/h/.npm", "/h/store", "/h/yarn", "/p/node_modules/.vite", "/p/node_modules/.cache"],
    sizes: {
      "/h/.npm": [13 * GB, 0],
      // integer bytes only — float GB arithmetic makes toFixed assertions brittle
      "/h/store": [3221225472, 3006477107], // 3.0 GiB → 2.8 GiB: prune only removes unreferenced
      "/h/yarn": [300 * MB, 0],
      "/p/node_modules/.vite": [38 * MB, 0],
      "/p/node_modules/.cache": [12 * MB, 0],
    },
  });
  const lines: string[] = [];
  const code = run(true, f.world, { log: (s) => lines.push(s) });
  assert.equal(code, 0);
  assert.deepEqual(f.cleaned.sort(), ["npm cache clean --force", "pnpm store prune", "yarn cache clean"].sort());
  assert.deepEqual(f.removed.sort(), ["/p/node_modules/.cache", "/p/node_modules/.vite"].sort());
  assert.equal(f.flushed.length, 2); // dscacheutil + killall
  const out = lines.join("\n");
  assert.match(out, /npm cache\s+13\.0 GB\s+\/h\/\.npm/);       // plan line: before-bytes + path
  assert.match(out, /pnpm store\s+cleared 205 MB/);             // 3.0 → 2.8 GiB = 214748365 B (≥100 drops the decimal)
  assert.match(out, /DNS resolver\s+flushed/);
  assert.match(out, /cleared 13\.5 GB across 6 target\(s\)/);    // 13G + 205M + 300M + 38M + 12M
});

check("run --go: a failed clean → exit 1 with the stderr line, others unaffected", () => {
  const f = fakeWorld({
    bins: ["npm", "pnpm"],
    pmDir: { npm: "/h/.npm", pnpm: "/h/store" },
    failClean: "pnpm",
    dirs: ["/h/.npm", "/h/store"],
    sizes: { "/h/.npm": [1 * GB, 0], "/h/store": [1 * GB, 1 * GB] },
  });
  const lines: string[] = [];
  const code = run(true, f.world, { log: (s) => lines.push(s) });
  assert.equal(code, 1);
  const out = lines.join("\n");
  assert.match(out, /pnpm store\s+failed: EPERM: cannot clean/);
  assert.match(out, /1 failed/);
  assert.match(out, /npm cache\s+cleared 1\.0 GB/);
});

// regression: found by the first REAL --go run — non-root killall cannot HUP root's
// mDNSResponder on macOS; the flush that worked (dscacheutil) must not fail with it
check("run --go: best-effort killall failing → dns still flushed, exit 0, note surfaced", () => {
  const f = fakeWorld({ bins: [], failDnsBin: "killall" });
  const lines: string[] = [];
  const code = run(true, f.world, { log: (s) => lines.push(s) });
  assert.equal(code, 0);
  const out = lines.join("\n");
  assert.match(out, /DNS resolver\s+flushed \(killall skipped: No matching processes/);
  assert.match(out, /across 1 target\(s\)/); // dns only — no "failed" suffix
});

check("clear: reclaimed never negative (cache grew during clean → 0)", () => {
  const f = fakeWorld({ bins: ["npm"], pmDir: { npm: "/h/.npm" }, dirs: ["/h/.npm"], sizes: { "/h/.npm": [1000, 2000] } });
  const t = buildPlan(f.world).find((x) => x.id === "npm") as Target;
  assert.equal(clear(t, f.world).reclaimed, 0);
});

check("clear: rm targets are only ever the two bundler dirs", () => {
  const f = fakeWorld({ dirs: ["/p/node_modules/.vite"], sizes: { "/p/node_modules/.vite": [10, 0] } });
  const vite = buildPlan(f.world).find((t) => t.id === "vite")!;
  clear(vite, f.world);
  assert.deepEqual(f.removed, ["/p/node_modules/.vite"]);
});

// --- CLI edges (real process, real argv) ---
const freshProject = (files: Record<string, number>) => {
  const dir = mkdtempSync(join(tmpdir(), "nuke-caches-"));
  for (const [rel, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), "x".repeat(bytes));
  }
  return dir;
};

check("CLI: bad --dir → exit 2", () => {
  const r = spawnSync(process.execPath, [join(here, "nuke-caches.ts"), "--dir", "/definitely/not/here"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /path not found/);
});

check("CLI: dry-run on a real sandbox project, PATH stripped of package managers", () => {
  const dir = freshProject({
    "node_modules/.vite/deps/svelte.js": 1024,
    "node_modules/.cache/webpack/0.pack": 2048,
  });
  const r = spawnSync(process.execPath, [join(here, "nuke-caches.ts"), "--dir", dir], {
    encoding: "utf8",
    env: { ...process.env, PATH: "/usr/bin:/bin" }, // npm/pnpm/yarn not here → deterministic misses
  });
  assert.equal(r.status, 0);
  const out = r.stdout;
  assert.match(out, /dry-run/);
  assert.match(out, /npm not on PATH/);
  assert.match(out, /Vite optimize cache\s+1\.0 KB\s+/);
  assert.match(out, /webpack\/babel cache\s+2\.0 KB\s+/);
  assert.match(out, /DNS resolver/);
  assert.match(out, /3 of 6 targets · 3\.0 KB reclaimable/);
});

check("CLI: --go on a real sandbox project really deletes the bundler dirs", () => {
  const dir = freshProject({ "node_modules/.vite/deps/svelte.js": 1024, "src/keep.me": 5 });
  const r = spawnSync(process.execPath, [join(here, "nuke-caches.ts"), "--dir", dir, "--go"], {
    encoding: "utf8",
    env: { ...process.env, PATH: "/usr/bin:/bin" },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Vite optimize cache\s+cleared 1\.0 KB/);
  assert.ok(!exists(`${dir}/node_modules/.vite`), ".vite gone");
  assert.ok(exists(`${dir}/src/keep.me`), "nothing else touched");
});

check("run through a symlink (npm bin / npx) still runs main()", () => {
  const link = join(mkdtempSync(join(tmpdir(), "nuke-caches-")), "nuke-caches");
  symlinkSync(join(here, "nuke-caches.ts"), link);
  const r = spawnSync(process.execPath, [link, "--dir", here], { encoding: "utf8", env: { ...process.env, PATH: "/usr/bin:/bin" } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /nuke-caches — /);
});

console.log(`\nself-check: ${n} checks passed`);
