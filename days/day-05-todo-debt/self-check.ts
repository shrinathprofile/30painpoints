// self-check — the one runnable check. Assert-based, no framework.
// Run: node self-check.ts   (or: npm run check)
// await-ified check() from day-02's lesson: an async assertion must not false-pass.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  run, markerRegex, scanText, parseBlame, parseDiff, driftMarkdown,
  type Api, type World, type GitResult,
} from "./todo-debt.ts";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const NOW = new Date(Date.UTC(2026, 10, 3, 12)); // 2026-11-03T12:00:00Z = epoch 1_793_707_200 (hand-checked)
const DEFAULT = markerRegex(["TODO", "FIXME", "HACK"]);

let n = 0;
const check = async (label: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log(`  ✓ ${label}`); };

// --- markerRegex + scanText ---
await check("markers match as whole words, case exactly as given", () => {
  const re = markerRegex(["TODO"]);
  assert.ok("x // TODO: ship".match(re));
  assert.ok(!"TODOING".match(re));       // no boundary after TODO
  assert.ok(!"PRETODO".match(re));       // no boundary before TODO
  assert.ok(!"todo lowercase".match(re)); // case is the convention, not the dictionary
});
await check("scanText: line numbers, note extraction, binary skip", () => {
  assert.deepEqual(
    scanText("const a = 1;\n// TODO: fix the retry | fail path\n// HACK(alice) no colon\n", DEFAULT),
    [
      { line: 2, marker: "TODO", note: "fix the retry | fail path" },
      { line: 3, marker: "HACK", note: "(alice) no colon" },
    ],
  );
  assert.deepEqual(scanText("TODO\x00binary", DEFAULT), [], "NUL byte → no debt");
});
await check("custom marker (the series' own ponytail:)", () => {
  assert.deepEqual(
    scanText("// ponytail: in-memory only, sqlite when persistence matters\n", markerRegex(["ponytail"])),
    [{ line: 1, marker: "ponytail", note: "in-memory only, sqlite when persistence matters" }],
  );
});

// --- parseBlame (fixture: realistic --line-porcelain with boundary/previous) ---
await check("parseBlame: author/time per final line, uncommitted detected", () => {
  const map = parseBlame(readFileSync(join(here, "fixtures/blame-src-a.txt"), "utf8"));
  assert.equal(map.size, 3);
  assert.deepEqual(map.get(1), { author: "Bob Old", time: 1_700_000_000 });
  assert.deepEqual(map.get(2), { author: "Alice Dev", time: 1_790_000_000 });
  assert.equal(map.get(3)?.author, "Not Committed Yet");
});
await check("age math (hand-computed, not the tool's formula replayed)", async () => {
  const age = Math.floor((1_793_707_200 - 1_790_000_000) / 86_400); // 42.9 → 42
  const logs: string[] = [];
  const { world } = fakeWorld({
    files: { "src/a.ts": "x\n// TODO one\n# FIXME two\n" },
    blames: { "src/a.ts": readFileSync(join(here, "fixtures/blame-src-a.txt"), "utf8") },
    now: NOW,
    logs,
  });
  const code = await run({ root: "/repo", markers: ["TODO", "FIXME", "HACK"] }, world);
  assert.equal(code, 0, "index mode is informational");
  const out = logs.join("\n");
  assert.match(out, / {2}42d\s+Alice Dev/);          // age from author-time, not comment dates
  assert.match(out, /uncommitted/);                   // staged line: shown, age not guessed
  assert.ok(!/Not Committed Yet/.test(out), "porcelain's sentinel never reaches the user");
  assert.equal(age, 42);
});

// --- parseDiff (fixture: new file, modified, deleted; @@-context guard) ---
await check("parseDiff: added/removed hits with hunk-counted line numbers", () => {
  const { added, removed } = parseDiff(readFileSync(join(here, "fixtures/diff-mixed.txt"), "utf8"), DEFAULT);
  assert.deepEqual(added, [{ file: "src/new.ts", line: 2, marker: "TODO", note: "fresh debt on line 2" }]);
  assert.deepEqual(removed.sort((a, b) => a.file.localeCompare(b.file)), [
    { file: "gone.ts", line: 2, marker: "TODO", note: "dies with the file" },
    { file: "src/old.ts", line: 2, marker: "FIXME", note: "remove me" },
  ]);
});
await check("parseDiff: a marker in the FILE PATH alone is not debt", () => {
  const d = parseDiff(
    'diff --git a/TODO.md b/TODO.md\ndeleted file mode 100644\n--- a/TODO.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-just a doc\n',
    DEFAULT,
  );
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, [], "path headers never scanned; only +/- content lines are");
});
await check("parseDiff: git's TAB suffix on spaced header paths is stripped", () => {
  const d = parseDiff('diff --git a/my file.ts b/my file.ts\n--- a/my file.ts\t\n+++ b/my file.ts\t\n@@ -1,0 +2,2 @@\n+\n+// TODO moved\n', DEFAULT);
  assert.deepEqual(d.added, [{ file: "my file.ts", line: 3, marker: "TODO", note: "moved" }]);
});
await check("parseDiff: @@ trailing context is not content; +++ prefixed line is", () => {
  const no = parseDiff("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -10 +10 @@ // TODO inside hunk header\n+const clean = 1;\n", DEFAULT);
  assert.equal(no.added.length + no.removed.length, 0);
  const weird = parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,0 +2 @@\n++++ TODO banner line\n', DEFAULT);
  assert.deepEqual(weird.added, [{ file: "x", line: 2, marker: "TODO", note: "banner line" }], "content '+++ TODO banner' survives the header guard");
});
await check("markdown escaping: pipe in a note cannot break the table", () => {
  const md = driftMarkdown([{ file: "a.ts", line: 1, marker: "TODO", note: "a | b" }], []);
  assert.match(md, /a \\\| b/, "pipe escaped as \\| so the table survives");
  assert.match(md, /net \+1/);
});

// --- run() against a scripted git (the recording-world idiom, days 02–03) ---
function fakeWorld(opts: {
  files: Record<string, string>;
  blames?: Record<string, string>;
  diff?: { stdout?: string; ok?: boolean };
  repo?: boolean;
  now?: Date;
  logs?: string[];
}): { world: World; logs: string[]; summaries: string[] } {
  const logs = opts.logs ?? [];
  const summaries: string[] = [];
  const git = (args: string[]): GitResult => {
    if (args[0] === "rev-parse") return { ok: opts.repo !== false, stdout: opts.repo === false ? "" : "true\n", stderr: opts.repo === false ? "fatal: not a git repository" : "" };
    if (args[0] === "ls-files") return { ok: true, stdout: Object.keys(opts.files).join("\n") + "\n", stderr: "" };
    if (args[0] === "blame") {
      const f = args[args.length - 1];
      return opts.blames?.[f] !== undefined
        ? { ok: true, stdout: opts.blames[f], stderr: "" }
        : { ok: false, stdout: "", stderr: `fatal: no such path ${f} in HEAD` };
    }
    if (args[0] === "-c") return opts.diff
      ? { ok: opts.diff.ok !== false, stdout: opts.diff.stdout ?? "", stderr: "fatal: ambiguous argument 'bogus'" }
      : { ok: false, stdout: "", stderr: "fatal: ambiguous argument 'bogus'" };
    return { ok: false, stdout: "", stderr: `fake git: unexpected call ${args.join(" ")}` };
  };
  const world: World = {
    git,
    read: (rel) => { if (!(rel in opts.files)) throw new Error(`ENOENT ${rel}`); return opts.files[rel]; },
    now: () => opts.now ?? NOW,
    log: (s) => logs.push(s),
    summary: (md) => summaries.push(md),
  };
  return { world, logs, summaries };
}

await check("not a git repo → exit 2 with one line (cannot check ≠ no debt)", async () => {
  const { world, logs } = fakeWorld({ files: {}, repo: false });
  assert.equal(await run({ root: "/nope", markers: ["TODO"] }, world), 2);
  assert.match(logs.join("\n"), /not a git repository/);
});
await check("bad --base ref → exit 2, never exit 1", async () => {
  const { world, logs } = fakeWorld({ files: {}, diff: { ok: false } });
  assert.equal(await run({ root: "/r", markers: ["TODO"], base: "no-such-ref" }, world), 2);
  assert.match(logs.join("\n"), /cannot diff no-such-ref\.\.\.HEAD/);
});
await check("unreadable file → skipped with a count, never a crash", async () => {
  // ls-files lists it; the read then throws (EACCES, or gone between listing and reading)
  const { world, logs } = fakeWorld({ files: { "gone.ts": "// TODO x" } });
  const w2: World = { ...world, read: () => { throw new Error("EACCES"); } };
  const code = await run({ root: "/r", markers: ["TODO"] }, w2);
  assert.equal(code, 0);
  assert.match(logs.join("\n"), /skipped or unblamable/);
});
await check("blame failure → author '?', row still listed", async () => {
  const { world, logs } = fakeWorld({ files: { "u.ts": "// TODO staged only\n" }, blames: {} });
  await run({ root: "/r", markers: ["TODO"] }, world);
  assert.match(logs.join("\n"), /\?\s+TODO\s+u\.ts:1/);
});
await check("drift net positive → exit 1 and the verdict line", async () => {
  // only the new-file section: added=1, removed=0 → net +1
  const stdout = readFileSync(join(here, "fixtures/diff-mixed.txt"), "utf8").split("diff --git a/src/old.ts")[0];
  const { world, logs, summaries } = fakeWorld({ files: {}, diff: { stdout } });
  assert.equal(await run({ root: "/r", markers: ["TODO", "FIXME", "HACK"], base: "main" }, world), 1);
  assert.match(logs.join("\n"), /net \+1 → this change adds debt → exit 1/);
  assert.ok(summaries[0].includes("net +1"));
});
await check("drift net negative (repaid) → exit 0", async () => {
  // the new-file TODO, now deleted instead of added: 0 added · 1 removed → net -1
  const stdout = 'diff --git a/src/new.ts b/src/new.ts\n--- a/src/new.ts\n+++ b/src/new.ts\n@@ -2 +1,0 @@\n-// TODO fresh debt on line 2\n';
  const { world, logs } = fakeWorld({ files: {}, diff: { stdout } });
  assert.equal(await run({ root: "/r", markers: ["TODO", "FIXME", "HACK"], base: "main" }, world), 0);
  assert.match(logs.join("\n"), /net -1 → debt repaid → exit 0/);
});

// --- --post: one living comment per PR (marker read-back, day-02 idiom) ---
function fakeApi(existing: { id: number; body: string }[] = []) {
  const calls: string[] = [];
  const api: Api = {
    listComments: async () => existing,
    postComment: async (_pr, body) => { calls.push(`post:${body.slice(0, 30)}`); existing.push({ id: 99, body }); },
    updateComment: async (id, body) => { calls.push(`update:${id}:${body.slice(0, 30)}`); },
  };
  return { api, calls };
}
// net-positive diff (+1 TODO, nothing removed) — the "PR adds debt" path
const DRIFT_STDOUT = { stdout: readFileSync(join(here, "fixtures/diff-mixed.txt"), "utf8").split("diff --git a/src/old.ts")[0] };

await check("--post: first bad PR → comment created; second run → updated, not duplicated", async () => {
  const { api, calls } = fakeApi([]);
  const opts = { root: "/r", markers: ["TODO"], base: "main", post: true, pr: 7, repo: "o/r" } as const;
  await run({ ...opts, api }, fakeWorld({ files: {}, diff: DRIFT_STDOUT }).world);
  assert.match(calls[0], /^post:/);
  const again = fakeApi([{ id: 55, body: "stale report\n<!-- todo-debt-report -->" }]);
  await run({ ...opts, api: again.api }, fakeWorld({ files: {}, diff: DRIFT_STDOUT }).world);
  assert.equal(again.calls.length, 1);
  assert.match(again.calls[0], /^update:55:/, "update in place, never a second comment");
});
await check("--post: clean PR with no existing comment → silent; with our old comment → repaid update", async () => {
  const quiet = fakeApi([]);
  const code = await run({ root: "/r", markers: ["TODO"], base: "main", post: true, pr: 8, repo: "o/r", api: quiet.api }, fakeWorld({ files: {}, diff: { stdout: "" } }).world);
  assert.equal(code, 0);
  assert.deepEqual(quiet.calls, [], "clean PRs get no comment");
  const had = fakeApi([{ id: 66, body: "old drift\n<!-- todo-debt-report -->" }]);
  await run({ root: "/r", markers: ["TODO"], base: "main", post: true, pr: 8, repo: "o/r", api: had.api }, fakeWorld({ files: {}, diff: { stdout: "" } }).world);
  assert.match(had.calls[0], /^update:66:/);
});
await check("--post without a PR number → exit 2 (cannot post ≠ drift)", async () => {
  const { api } = fakeApi();
  const { world, logs } = fakeWorld({ files: {}, diff: DRIFT_STDOUT });
  assert.equal(await run({ root: "/r", markers: ["TODO"], base: "main", post: true, repo: "o/r", api }, world), 2);
  assert.match(logs.join("\n"), /--post needs a PR number/);
});

// --- CLI edge cases (day-01/day-03 regressions, probed as real subprocesses) ---
const cli = (args: string[]) => spawnSync(process.execPath, [join(here, "todo-debt.ts"), ...args], { encoding: "utf8" });

await check("CLI: unknown flag → usage error exit 2, no stack", () => {
  const r = cli(["--bogus"]);
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stderr, /\n\s+at /, "no stack trace");
});
await check("CLI: path not found → exit 2 with one line", () => {
  const r = cli(["/definitely/not/here"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /path not found/);
});
await check("CLI: empty directory is not a repo → exit 2 with one line", () => {
  const r = cli([mkdtempSync(join(tmpdir(), "todo-debt-"))]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /not a git repository/, "cannot-check goes through the log channel, single stream like day-02");
  assert.doesNotMatch(r.stderr, /\n\s+at /, "no stack trace");
});

// --- end-to-end against real git (the provider itself; dates pinned via env) ---
function git(dir: string, args: string[], date?: string) {
  const env = date
    ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: "Base Tester", GIT_AUTHOR_EMAIL: "base@test", GIT_COMMITTER_NAME: "Base Tester", GIT_COMMITTER_EMAIL: "base@test" }
    : { ...process.env, GIT_AUTHOR_NAME: "Dev Tester", GIT_AUTHOR_EMAIL: "dev@test", GIT_COMMITTER_NAME: "Dev Tester", GIT_COMMITTER_EMAIL: "dev@test" };
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

await check("real git end-to-end: index (informational) + ratchet fires + repay passes + custom marker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "todo-debt-repo-"));
  git(dir, ["init", "-q"]);
  writeFileSync(join(dir, "keep.ts"), "// TODO base debt\nexport const a = 1;\n");
  writeFileSync(join(dir, "fix.ts"), "// FIXME gone soon\n");
  writeFileSync(join(dir, "meta.ts"), "// ponytail: in-memory only\n");
  git(dir, ["add", "-A"], "2026-10-01T00:00:00Z");
  git(dir, ["commit", "-q", "-m", "base"], "2026-10-01T00:00:00Z");
  // head: +2 TODO (one in a new file), -1 FIXME → net +1 → the ratchet must fire
  writeFileSync(join(dir, "keep.ts"), "// TODO base debt\nexport const a = 2;\n// TODO fresh debt\n");
  writeFileSync(join(dir, "new.ts"), "// TODO new file debt\n");
  git(dir, ["rm", "-q", "fix.ts"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "head"]);

  const base = git(dir, ["rev-parse", "HEAD~1"]);
  const drift = cli([dir, "--base", base]);
  assert.equal(drift.status, 1, "net +1 must fail the ratchet");
  assert.match(drift.stdout, /net \+1 → this change adds debt/);
  assert.match(drift.stdout, /\+ new\.ts:1\s+TODO\s+new file debt/);
  assert.match(drift.stdout, /- fix\.ts:1\s+FIXME\s+gone soon/);

  const idx = cli([dir]);
  assert.equal(idx.status, 0, "index mode never fails on existing debt");
  assert.match(idx.stdout, / 3 item\(s\)/, "3 TODOs (ponytail marker not counted by default)");
  assert.ok(!/fix\.ts/.test(idx.stdout), "the FIXME died with fix.ts (no row references it)");
  assert.match(idx.stdout, /Dev Tester/, "author from git blame");
  assert.match(idx.stdout, /\d+d\s+Base Tester/, "base TODO keeps its original author + age");

  const custom = cli([dir, "--markers", "ponytail"]);
  assert.equal(custom.status, 0);
  assert.match(custom.stdout, /1 item\(s\)/);
  assert.ok(!custom.stdout.includes("TODO base debt"), "custom markers replace, not extend");

  // repay: drop the added TODO → diff head...repay is net -1 → exit 0
  writeFileSync(join(dir, "keep.ts"), "// TODO base debt\nexport const a = 2;\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "repay"]);
  const repaid = cli([dir, "--base", "HEAD~1"]);
  assert.equal(repaid.status, 0);
  assert.match(repaid.stdout, /net -1 → debt repaid/);
});
await check("real git: staged-but-uncommitted TODO shows as uncommitted, not as a fake age", async () => {
  const dir = mkdtempSync(join(tmpdir(), "todo-debt-repo-"));
  git(dir, ["init", "-q"]);
  writeFileSync(join(dir, "a.ts"), "// TODO committed\n");
  git(dir, ["add", "-A"], "2026-10-01T00:00:00Z");
  git(dir, ["commit", "-q", "-m", "base"], "2026-10-01T00:00:00Z");
  writeFileSync(join(dir, "a.ts"), "// TODO committed\n// TODO staged now\n");
  git(dir, ["add", "-A"]);
  const r = cli([dir]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /uncommitted\s+TODO\s+a\.ts:2/);
});

console.log(`\nself-check: ${n} checks passed (${NOW.toISOString().slice(0, 10)} fixed clock)`);
