// self-check — the one runnable check. Assert-based, no framework.
// Run: node self-check.ts   (or: npm run check)
//
// Fixture hand-counted twice (D05). Records mimic git's numstat porcelain
// exactly: \0-prefixed header, \x1f-joined fields, stat lines below the
// header, BLANK line between records, none after the last.
//
// Boundary epochs (day-08's checked anchors, margins ≥ 24h from any
// local-midnight window edge on any timezone):
//   NOW   = 1_793_890_800 = 2026-11-05T15:00Z
//   T_A   = 1_793_890_000 = 2026-11-05T14:46:40Z  (in window everywhere)
//   T_B   = 1_793_815_200 = 2026-11-04T18:00Z     (in window everywhere)
//   T_OLD = 1_793_534_400 = 2026-11-01T12:00Z     (out of window everywhere)
//   T_F   = 1_794_322_800 = 2026-11-10T15:00Z     (after NOW — future-dated)
//
// Hand-count of LOG_STDOUT (twice): 9 records → 7 parse (A,B,C,D,H,G,G2),
// 2 inert (E,F), 1 badStat line (inside B). In-window (days=1): A,B,C,D,H,G,G2
// = 7 commits; Last(T_OLD) filtered. Totals: ins 12+5+0+2+3+1+0 = 23,
// del 13+0+0+2+1+1+0 = 17, files {src/a.ts, README.md, days/day-11/x.ts,
// logo.png, a.ts, h.ts, notes.md} = 7, docs {README.md, notes.md} = 2.
// Areas: unlabeled ×3 (D,H,G), AUTH-12 ×1, day-11 ×1, deps ×1, empty ×1.
// Tickets: AUTH-12 (leading), PAY-3 (mid-subject) — deduped, sorted.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GitResult, World } from "../../packages/git-digest/git-digest.ts";
import { windowFilter, windowStart } from "../../packages/git-digest/git-digest.ts";
import { run, parseDetailed, tally, harvestTickets, tallyAreas, renderReport, type Detailed } from "./proof-report.ts";

const here = dirname(fileURLToPath(import.meta.url));
const NOW = new Date(1_793_890_800 * 1000);
const T_A = 1_793_890_000;
const T_B = 1_793_815_200;
const T_OLD = 1_793_534_400;
const T_F = 1_794_322_800;

let n = 0;
const check = async (label: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log(`  ✓ ${label}`); };

// --- fixture (mimics git's numstat porcelain; hash is "a"*40 etc. so slices are visible) ---
const rec = (hash: string, author: string, email: string, ts: number | string, subject: string, stats: string[] = []) =>
  `\0${[hash, author, email, String(ts), subject].join("\x1f")}${stats.length ? "\n" + stats.join("\n") : ""}`;
// E built RAW: a genuinely 4-field record (field-shift shape). The builder
// trap (D05/D08): passing stats=[] still emits a VALID 5-field record — a
// 4-field record must be built by hand or the hand-count lies.
const recE = `\0${["e".repeat(40), "Malformed", "mal@x", "1700000000"].join("\x1f")}`;
// H40 builds a 40-hex hash from ONE hex char — and REFUSES anything else: the
// fixture builder must not be able to lie (D05). Today's build hit that trap
// twice: "g"/"z" (non-hex) and "f0".repeat(40) (80 chars) both parsed as
// inert records and silently rewrote the hand-count.
const H40 = (c: string) => {
  if (!/^[0-9a-f]$/.test(c)) throw new Error(`H40 wants one hex char, got "${c}"`);
  return c.repeat(40);
};
const LOG_STDOUT = [
  rec(H40("a"), "Dev Tester", "dev@test", T_A, "AUTH-12: fix the flaky login retry", ["12\t3\tsrc/a.ts", "0\t10\tREADME.md"]),
  rec(H40("b"), "Dev Tester", "dev@test", T_B, "day-11: build the CLI", ["5\t0\tdays/day-11/x.ts", "garbage stat line without tabs"]),
  rec(H40("c"), "Other Person", "other@x", T_B, "chore(deps): bump vite", ["-\t-\tlogo.png"]),
  rec(H40("d"), "Dev Tester", "dev@test", T_B, "add bell \x07 alert", ["2\t2\ta.ts"]),
  rec(H40("5"), "Dev Tester", "dev@test", T_B, "fix: handle PAY-3 retry", ["3\t1\th.ts"]),
  rec(H40("7"), "Dev Tester", "dev@test", T_B, "", ["1\t1\tnotes.md"]),
  rec(H40("2"), "Dev Tester", "dev@test", T_B, "empty: nothing landed physically"), // empty commit: zero stat lines
  recE,                                                       // E: 4 fields → inert
  rec(H40("f"), "Bad Ts", "bad@x", "12x3", "not digits"),      // F: non-numeric ts → inert
].join("\n\n") + "\n\n" + rec(H40("0"), "Last", "last@x", T_OLD, "old work: before the window");
// hand-count: 9 + Last = 10 records → 7+Last parse (8), 2 inert, 1 badStat

await check("parseDetailed: hand-counted 8 parse / 2 inert / 1 badStat; stats typed, binary zeroes", () => {
  const { commits, inert, badStat } = parseDetailed(LOG_STDOUT);
  assert.equal(commits.length, 8);
  assert.equal(inert, 2);
  assert.equal(badStat, 1);
  const a = commits.find((c) => c.hash === H40("a"))!;
  assert.equal(a.stats.length, 2);
  assert.deepEqual(a.stats[0], { ins: 12, del: 3, path: "src/a.ts" });
  const c = commits.find((c) => c.hash === H40("c"))!;
  assert.deepEqual(c.stats[0], { ins: 0, del: 0, path: "logo.png" }, "binary counts the file, contributes no lines");
  const g2 = commits.find((c) => c.hash === H40("2"))!;
  assert.equal(g2.stats.length, 0, "empty commit: zero stat lines, still a receipt");
  assert.equal(commits.find((c) => c.hash === H40("7"))!.subject, "", "empty subject kept, never dropped");
});

await check("parseDetailed: 64-hex (SHA-256 repo) hash parses; 39-hex is inert, not guessed", () => {
  const good = rec("9".repeat(64), "D", "d@x", T_B, "sha256: long hash");
  assert.equal(parseDetailed(good).commits.length, 1);
  const bad = rec("9".repeat(39), "D", "d@x", T_B, "short hash");
  assert.equal(parseDetailed(bad).inert, 1);
});

await check("parseDetailed: last record with NO trailing newline parses identically", () => {
  const noTail = LOG_STDOUT.replace(/\n\n$/, "");
  const full = parseDetailed(LOG_STDOUT);
  const cut = parseDetailed(noTail);
  assert.equal(cut.commits.length, full.commits.length);
  assert.deepEqual(cut.commits.at(-1), full.commits.at(-1));
});

const IN_WINDOW = windowFilter(parseDetailed(LOG_STDOUT).commits, windowStart(NOW, 1), NOW).commits;

await check("tally: hand-counted +23 −17, 7 unique files, 2 docs; same path in two commits dedupes", () => {
  assert.deepEqual(tally(IN_WINDOW), { ins: 23, del: 17, files: 7, docs: 2 });
  const twice: Detailed[] = [
    { ...IN_WINDOW[0], stats: [{ ins: 1, del: 0, path: "same.ts" }] },
    { ...IN_WINDOW[1], stats: [{ ins: 1, del: 0, path: "same.ts" }] },
  ];
  assert.deepEqual(tally(twice), { ins: 2, del: 0, files: 1, docs: 0 });
});

await check("harvestTickets: mid-subject keys found, deduped, sorted; lowercase prefixes are not tickets", () => {
  assert.deepEqual(harvestTickets(IN_WINDOW), ["AUTH-12", "PAY-3"]);
  const dup = [...IN_WINDOW, { ...IN_WINDOW[0] }]; // AUTH-12 twice → once
  assert.deepEqual(harvestTickets(dup), ["AUTH-12", "PAY-3"]);
  const lower = [{ ...IN_WINDOW[0], subject: "day-11: not a ticket" }];
  assert.deepEqual(harvestTickets(lower), [], "day-11 is lowercase — no false ticket");
});

await check("tallyAreas: count desc, unlabeled forced last, codepoint asc within ties", () => {
  const areas = tallyAreas(IN_WINDOW);
  assert.deepEqual(areas.map((a) => [a.area, a.n]), [
    [null, 3], ["AUTH-12", 1], ["day-11", 1], ["deps", 1], ["empty", 1],
  ]);
});

// --- run() against a scripted git (the recording-world idiom) ---
function fakeWorld(opts: {
  repo?: boolean;
  logStdout?: string;
  logOk?: boolean;
  config?: { email?: string; name?: string };
  now?: Date;
  logs?: string[];
}): { world: World; logs: string[] } {
  const logs = opts.logs ?? [];
  const git = (args: string[]): GitResult => {
    if (args[0] === "rev-parse") return { ok: opts.repo !== false, stdout: opts.repo === false ? "" : "true\n", stderr: opts.repo === false ? "fatal: not a git repository" : "" };
    if (args[0] === "config") {
      const key = args[2];
      const v = key === "user.email" ? opts.config?.email : opts.config?.name;
      return v ? { ok: true, stdout: v + "\n", stderr: "" } : { ok: false, stdout: "", stderr: "" };
    }
    if (args[0] === "log") {
      assert.ok(args.includes("--numstat"), "the detailed fetch must ask for numstat");
      return { ok: opts.logOk !== false, stdout: opts.logStdout ?? "", stderr: opts.logOk === false ? "fatal: bad ref" : "" };
    }
    return { ok: false, stdout: "", stderr: `fake git: unexpected call ${args.join(" ")}` };
  };
  const world: World = { git, now: () => opts.now ?? NOW, log: (s) => logs.push(s) };
  return { world, logs };
}

await check("not a git repo → exit 2 with one line (cannot check ≠ no commits)", async () => {
  const { world, logs } = fakeWorld({ repo: false });
  assert.equal(await run({ root: "/nope", days: 1, me: false }, world), 2);
  assert.match(logs.join("\n"), /not a git repository/);
});
await check("git log failure → exit 2, never exit 1", async () => {
  const { world, logs } = fakeWorld({ logOk: false });
  assert.equal(await run({ root: "/r", days: 1, me: false }, world), 2);
  assert.match(logs.join("\n"), /git log failed/);
});
await check("empty window → exit 1, message names window and merge rule, no report", async () => {
  const { world, logs } = fakeWorld({ logStdout: rec(H40("0"), "Last", "last@x", T_OLD, "old work: before the window") });
  assert.equal(await run({ root: "/r", days: 1, me: false }, world), 1);
  assert.match(logs.join("\n"), /no commits in .*merges excluded/);
  assert.doesNotMatch(logs.join("\n"), /proof of work —/, "no half-report on an honest empty");
});
await check("--me with no git identity → exit 2 before any fetch (fail fast)", async () => {
  const { world, logs } = fakeWorld({ config: {} });
  assert.equal(await run({ root: "/r", days: 1, me: true }, world), 2);
  assert.match(logs.join("\n"), /--me has nothing to match/);
});
await check("happy path: exit 0, hand-counted header/stats/receipts/areas/tickets in order", async () => {
  const { world, logs } = fakeWorld({ logStdout: LOG_STDOUT });
  assert.equal(await run({ root: "/r", days: 1, me: false }, world), 0);
  const out = logs.join("\n");
  assert.match(out, /proof of work — \d{4}-\d{2}-\d{2} \(window .* · 7 commits\)/, "header shape; exact times are pinned only under forced TZ (D08)");
  assert.match(out, /\*\*7 commits · 7 files · \+23 −17 · 2 docs\*\* · landed .+ → .+/);
  const receipts = out.split("\n").filter((l) => l.startsWith("- `"));
  assert.deepEqual(receipts, [
    "- `aaaaaaa` AUTH-12: fix the flaky login retry",
    "- `bbbbbbb` day-11: build the CLI",
    "- `ccccccc` chore(deps): bump vite",
    "- `ddddddd` add bell ␇ alert",
    "- `5555555` fix: handle PAY-3 retry",
    "- `7777777` (no message)",
    "- `2222222` empty: nothing landed physically",
  ], "newest first, equal-ts in parse order, control char as a control PICTURE, empty subject honest");
  assert.match(out, /\*\*areas:\*\* unlabeled ×3 · AUTH-12 ×1 · day-11 ×1 · deps ×1 · empty ×1/);
  assert.match(out, /\*\*tickets:\*\* AUTH-12 · PAY-3/);
  assert.match(out, /every line is one `git show <hash>` away — output, not online-status\./);
  assert.match(out, /\(1 unparseable numstat line skipped/);
  assert.match(out, /2 unparseable log records skipped/);
});
await check("--me: only the config identity's commits, header names the filter", async () => {
  const { world, logs } = fakeWorld({ config: { email: "dev@test", name: "Dev Tester" }, logStdout: LOG_STDOUT });
  const code = await run({ root: "/r", days: 1, me: true }, world);
  assert.equal(code, 0);
  const out = logs.join("\n");
  assert.match(out, /6 commits by dev@test/, "hand-count: A,B,D,H,G,G2 are dev@test; C is not");
  assert.ok(!out.includes("bump vite"), "Other Person's commit never enters the proof");
});
await check("--me by NAME when email matches nothing (rebases rewrite emails, names stick)", async () => {
  const { world, logs } = fakeWorld({ config: { email: "me@new", name: "Dev Tester" }, logStdout: LOG_STDOUT });
  assert.equal(await run({ root: "/r", days: 1, me: true }, world), 0);
  assert.match(logs.join("\n"), /6 commits by Dev Tester/);
});
await check("future-dated commits excluded AND counted; stats never include them", async () => {
  const stdout = [
    rec(H40("9"), "D", "d@x", T_F, "AUTH-9: dated after now", ["100\t100\tfuture.ts"]),
    rec(H40("b"), "D", "d@x", T_B, "AUTH-10: dated today", ["1\t1\ttoday.ts"]),
  ].join("\n\n");
  const { world, logs } = fakeWorld({ logStdout: stdout });
  assert.equal(await run({ root: "/r", days: 1, me: false }, world), 0);
  const out = logs.join("\n");
  assert.match(out, /· 1 commit\)/, "singular");
  assert.match(out, /\(1 commit dated after now excluded/);
  assert.match(out, /\*\*1 commit · 1 file · \+1 −1\*\*/, "the future commit's +100 −100 never enter the stats");
  assert.ok(!out.includes("AUTH-9"));
});
await check("all-inert window → exit 1 but inert + badStat notes are NOT swallowed, notes precede verdict", async () => {
  const stdout = [
    rec(H40("1"), "D", "d@x", T_B, "has\x1funit separator"),
    recE,
  ].join("\n\n");
  const { world, logs } = fakeWorld({ logStdout: stdout });
  assert.equal(await run({ root: "/r", days: 1, me: false }, world), 1);
  const out = logs.join("\n");
  assert.match(out, /2 unparseable log records skipped/);
  assert.match(out, /no commits in/);
  assert.ok(out.indexOf("unparseable") < out.indexOf("no commits"), "the fetch note precedes the verdict");
});
await check("fetch-cap note counts parsed + inert, not the parsed slice alone (D08 F5)", async () => {
  const recs: string[] = [];
  for (let i = 0; i < 999; i++) recs.push(rec(H40(String(i % 10)), "D", "d@x", T_B, `work-${i}: thing`));
  recs.push(rec(H40("9"), "D", "d@x", T_B, "broken\x1fsubject")); // the 1000th record, inert
  const { world, logs } = fakeWorld({ logStdout: recs.join("\n\n") });
  assert.equal(await run({ root: "/r", days: 1, me: false }, world), 0);
  assert.match(logs.join("\n"), /fetch cap 1000 hit/, "fetched = 999 parsed + 1 inert = 1000 ≥ cap");
});
await check("clip at 100 runes, never mid-rune (package invariants hold on receipts)", async () => {
  const long = "x" + "😀".repeat(110);
  const stdout = rec(H40("a"), "D", "d@x", T_B, long);
  const { world, logs } = fakeWorld({ logStdout: stdout });
  assert.equal(await run({ root: "/r", days: 1, me: false }, world), 0);
  const receipt = logs.join("\n").split("\n").find((l) => l.startsWith("- `"))!;
  // receipt = "- `" + hash7 + "` " + 100 runes + "…" — code points, not UTF-16 units
  assert.equal(Array.from(receipt).length, 3 + 7 + 2 + 100 + 1);
  assert.ok(receipt.endsWith("…"));
  assert.ok(receipt.includes("😀"), "the boundary rune survives whole");
});

// --- renderReport directly: the span is a landing window, singular when one commit ---
await check("renderReport: single commit → 'landed <time>' with no arrow; plural/singular everywhere", () => {
  const one: Detailed[] = [parseDetailed(rec(H40("3"), "D", "d@x", T_B, "solo: one commit", ["1\t0\ta.ts"])).commits[0]];
  const out = renderReport(one, NOW, new Date(NOW.getTime() - 86400_000), null);
  assert.match(out, /· landed \w+ \d+ \d\d:\d\d\b/);
  assert.doesNotMatch(out, /landed .+ → /, "one commit: no span arrow, no hours implication");
  assert.match(out, /\*\*1 commit · 1 file · \+1 −0\*\*/);
  assert.doesNotMatch(out, /docs/, "no docs line when zero doc files");
  assert.doesNotMatch(out, /\*\*tickets:\*\*/, "no tickets line when none in subjects");
});

// --- CLI subprocess edges (exit matrix) ---
const cli = (args: string[], env?: NodeJS.ProcessEnv) =>
  spawnSync(process.execPath, [join(here, "proof-report.ts"), ...args], { encoding: "utf8", cwd: here, env: env ?? process.env });

await check("CLI: unknown flag → usage exit 2, no stack", () => {
  const r = cli(["--bogus"]);
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stderr ?? "", /\n\s+at /);
});
await check("CLI: two positionals → usage exit 2", () => {
  assert.equal(cli(["a", "b"]).status, 2);
});
await check("CLI: --days 0 / 99 / abc → exit 2; --since garbage → exit 2", () => {
  assert.equal(cli(["--days", "0"]).status, 2);
  assert.equal(cli(["--days", "99"]).status, 2);
  assert.equal(cli(["--days", "abc"]).status, 2);
  assert.equal(cli(["--since", "not-a-date"]).status, 2);
});

// --- end-to-end against real git (the provider itself; dates + clock pinned) ---
function git(dir: string, args: string[], opts: { date?: string; name?: string; email?: string } = {}) {
  const env = { ...process.env };
  if (opts.date) { env.GIT_AUTHOR_DATE = opts.date; env.GIT_COMMITTER_DATE = opts.date; }
  env.GIT_AUTHOR_NAME = opts.name ?? "Dev Tester";
  env.GIT_AUTHOR_EMAIL = opts.email ?? "dev@test";
  env.GIT_COMMITTER_NAME = env.GIT_AUTHOR_NAME;
  env.GIT_COMMITTER_EMAIL = env.GIT_AUTHOR_EMAIL;
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
const PINNED = { ...process.env, PROOF_REPORT_FAKE_NOW: String(1_793_890_800), TZ: "UTC" } as NodeJS.ProcessEnv;

await check("real git end-to-end: stats hand-count, ticket + docs + binary, --me, merges excluded", () => {
  const dir = mkdtempSync(join(tmpdir(), "proof-report-repo-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "dev@test"]);
  git(dir, ["config", "user.name", "Dev Tester"]);
  // out-of-window
  writeFileSync(join(dir, "old.txt"), "old\n");
  git(dir, ["add", "-A"], { date: "2026-11-01T12:00:00Z" });
  git(dir, ["commit", "-q", "-m", "old work: before the window"], { date: "2026-11-01T12:00:00Z" });
  // in-window dev commit: code + doc + binary (+8 −2, 3 files, 1 doc, ticket)
  writeFileSync(join(dir, "app.ts"), "line1\nline2\nline3\n");
  writeFileSync(join(dir, "NOTES.md"), "notes\n");
  writeFileSync(join(dir, "logo.png"), Buffer.from([0x00, 0x89, 0x50, 0x4e, 0x47]));
  git(dir, ["add", "-A"], { date: "2026-11-04T18:00:00Z" });
  git(dir, ["commit", "-q", "-m", "AUTH-55: ship the report feature"], { date: "2026-11-04T18:00:00Z" });
  // in-window other-author commit (+1 −0, 1 file)
  writeFileSync(join(dir, "other.txt"), "x\n");
  git(dir, ["add", "-A"], { date: "2026-11-04T19:00:00Z", name: "Other Person", email: "other@x" });
  git(dir, ["commit", "-q", "-m", "chore: other's touch"], { date: "2026-11-04T19:00:00Z", name: "Other Person", email: "other@x" });
  // in-window merge commit — must be excluded
  const mainBranch = git(dir, ["symbolic-ref", "--short", "HEAD"]); // main/master/whatever this git defaults to
  git(dir, ["checkout", "-q", "-b", "side"]);
  writeFileSync(join(dir, "side.txt"), "s\n");
  git(dir, ["add", "-A"], { date: "2026-11-04T20:00:00Z" });
  git(dir, ["commit", "-q", "-m", "side: branch work"], { date: "2026-11-04T20:00:00Z" });
  git(dir, ["checkout", "-q", mainBranch]);
  git(dir, ["merge", "-q", "--no-ff", "-m", "Merge branch 'side'", "side"], { date: "2026-11-04T21:00:00Z" });

  const all = cli([dir, "--days", "1"], PINNED);
  assert.equal(all.status, 0, all.stderr);
  const out = all.stdout ?? "";
  // hand-count: AUTH-55 (+8 −2 — app.ts 3/0, NOTES.md 1/0... recompute below), other (+1 −0), side (+1 −0), merge EXCLUDED
  // app.ts is NEW: 3 ins; NOTES.md NEW: 1 ins; logo.png binary 0/0 → AUTH-55 = +4 −0; other +1; side +1 → totals +6 −0, files 5
  assert.match(out, /window Nov 4 00:00 → Nov 5 15:00 · 3 commits\)/, "TZ=UTC pinned clock; merge excluded, old excluded");
  assert.match(out, /\*\*3 commits · 5 files · \+6 −0 · 1 doc\*\* · landed Nov 4 18:00 → Nov 4 20:00/);
  assert.match(out, /- `[0-9a-f]{7}` AUTH-55: ship the report feature/);
  assert.match(out, /\*\*ticket:\*\* AUTH-55/, "F5: singular when one ticket");
  assert.match(out, /\*\*areas:\*\* AUTH-55 ×1 · side ×1 · unlabeled ×1/, "bare 'chore:' has no scope — unlabeled, per the package's subjectArea");
  assert.ok(!out.includes("Merge branch"), "merge commits are not receipts");
  assert.ok(!out.includes("old work"), "T_OLD is outside every timezone's window");

  const mine = cli([dir, "--days", "1", "--me"], PINNED);
  assert.equal(mine.status, 0);
  assert.match(mine.stdout ?? "", /2 commits by dev@test/, "hand-count: AUTH-55 + side are dev@test's; other's + merge are not");
  assert.ok(!(mine.stdout ?? "").includes("other's touch"), "--me filters other identities");
});

await check("real git: zero-commit repo → exit 2 naming git's own reason (cannot check ≠ honest empty)", () => {
  const dir = mkdtempSync(join(tmpdir(), "proof-report-empty-"));
  git(dir, ["init", "-q"]);
  const r = cli([dir], PINNED);
  // day-08's same call: no history exists AT ALL is a "cannot check" (git log
  // itself fails); exit 1 is reserved for an empty window OF existing history
  assert.equal(r.status, 2);
  assert.match(r.stdout ?? "", /git log failed/);
  assert.match(r.stdout ?? "", /does not have any commits yet/, "git's own truthful reason surfaces");
});

await check("real git: --since local-midnight (not UTC) — the UTC-gap commit is IN", () => {
  // TZ=UTC+14 ("XXX-14"): local midnight of 2026-11-03 = 2026-11-02T10:00Z; UTC
  // midnight = 11-03T00:00Z. A commit at 11-02T18:00Z has LOCAL date 11-03 but
  // sits BEFORE UTC midnight — the D08 trap; the local parser must include it.
  const dir = mkdtempSync(join(tmpdir(), "proof-report-gap-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "dev@test"]);
  git(dir, ["config", "user.name", "Dev Tester"]);
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, ["add", "-A"], { date: "2026-11-02T18:00:00Z" });
  git(dir, ["commit", "-q", "-m", "AUTH-88: gap-window work"], { date: "2026-11-02T18:00:00Z" });
  const env = { ...PINNED, TZ: "XXX-14" } as NodeJS.ProcessEnv;
  const r = cli([dir, "--since", "2026-11-03"], env);
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stdout} ${r.stderr}`);
  assert.match(r.stdout ?? "", /AUTH-88 — gap-window work|AUTH-88: gap-window work/);
});

await check("real git: SHA-256 object-format repo — 64-hex hashes parse and cite", () => {
  const dir = mkdtempSync(join(tmpdir(), "proof-report-sha256-"));
  const init = spawnSync("git", ["-C", dir, "init", "-q", "--object-format=sha256"], { encoding: "utf8" });
  if (init.status !== 0) {
    console.log("    (git lacks --object-format=sha256; the 64-hex path stays covered by the parser fixture)");
    return;
  }
  git(dir, ["config", "user.email", "dev@test"]);
  git(dir, ["config", "user.name", "Dev Tester"]);
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, ["add", "-A"], { date: "2026-11-04T18:00:00Z" });
  git(dir, ["commit", "-q", "-m", "sha256: modern object format"], { date: "2026-11-04T18:00:00Z" });
  const r = cli([dir, "--days", "1"], PINNED);
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stdout} ${r.stderr}`);
  assert.match(r.stdout ?? "", /- `[0-9a-f]{7}` sha256: modern object format/);
});

// --- adversarial-pass regressions (D11 F#, each reproduced twice by the fresh-context agent) ---

await check("F1: C-quoted paths decode — quoted .md files count as docs; escaped tab and rename shapes parse", () => {
  // git emits these EXACT forms for non-ASCII / special / renamed paths
  const stdout = rec(H40("a"), "D", "d@x", T_B, "docs: touch quoted paths", [
    "1\t0\t\"caf\\303\\251.md\"",  // café.md, octal-escaped UTF-8
    "2\t1\t\"a\\tb.md\"",         // a<TAB>b.md, escaped tab
    "1\t0\told => new",           // rename shape: one line, one file
  ]);
  const { commits, badStat } = parseDetailed(stdout);
  assert.equal(badStat, 0);
  assert.deepEqual(commits[0].stats.map((s) => s.path), ["café.md", "a\tb.md", "old => new"]);
  assert.deepEqual(tally(commits), { ins: 4, del: 1, files: 3, docs: 2 }, "hand-count: both quoted .md paths count");
});
await check("F1 real git: a non-ASCII filename's .md still lands in the docs count", () => {
  const dir = mkdtempSync(join(tmpdir(), "proof-report-quoted-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "dev@test"]);
  git(dir, ["config", "user.name", "Dev Tester"]);
  writeFileSync(join(dir, "文献.md"), "content\n");
  git(dir, ["add", "-A"], { date: "2026-11-04T18:00:00Z" });
  git(dir, ["commit", "-q", "-m", "docs: non-ascii filename"], { date: "2026-11-04T18:00:00Z" });
  const r = cli([dir, "--days", "1"], PINNED);
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stdout} ${r.stderr}`);
  assert.match(r.stdout ?? "", /· 1 doc\*\*/, "the quoted 文献.md path decodes and counts");
});

await check("F2: a nonexistent root is 'cannot access', never 'not a git repository'", async () => {
  const logs: string[] = [];
  const world: World = {
    git: (args) =>
      args[0] === "rev-parse"
        ? { ok: false, stdout: "", stderr: "fatal: cannot change to '/no/such/dir': No such file or directory" }
        : { ok: false, stdout: "", stderr: "fake git: unexpected call" },
    now: () => NOW,
    log: (s) => logs.push(s),
  };
  assert.equal(await run({ root: "/no/such/dir", days: 1, me: false }, world), 2);
  assert.match(logs.join("\n"), /cannot access \/no\/such\/dir/);
  assert.doesNotMatch(logs.join("\n"), /not a git repository/, "the old reason was false for a missing path");
});
await check("F2 real CLI: /no/such/dir → exit 2 naming the access failure", () => {
  const r = cli(["/no/such/dir-11-does-not-exist"]);
  assert.equal(r.status, 2);
  assert.match(r.stdout ?? "", /cannot access/);
});

await check("F3: email-only identity with zero matches still names the filter in the honest empty", async () => {
  const stdout = rec(H40("c"), "Other", "other@x", T_B, "chore: someone else's work", ["1\t0\tx.ts"]);
  const { world, logs } = fakeWorld({ config: { email: "orphan@nowhere" }, logStdout: stdout });
  assert.equal(await run({ root: "/r", days: 1, me: true }, world), 1);
  assert.match(logs.join("\n"), /no commits by orphan@nowhere/, "the searched email, not silence");
});

await check("F4: equal first/last timestamps collapse — no self-pointing arrow", async () => {
  const stdout = [
    rec(H40("a"), "D", "d@x", T_B, "one: same instant", ["1\t0\ta.ts"]),
    rec(H40("b"), "D", "d@x", T_B, "two: same instant", ["1\t0\tb.ts"]),
  ].join("\n\n");
  const { world, logs } = fakeWorld({ logStdout: stdout });
  assert.equal(await run({ root: "/r", days: 1, me: false }, world), 0);
  assert.doesNotMatch(logs.join("\n"), /landed .+ → /, "two commits, one timestamp: one time, no arrow");
});

await check("F5: one ticket reads 'ticket:', not the always-plural label", async () => {
  const stdout = rec(H40("a"), "D", "d@x", T_B, "AUTH-1: only ticket", ["1\t0\ta.ts"]);
  const { world, logs } = fakeWorld({ logStdout: stdout });
  assert.equal(await run({ root: "/r", days: 1, me: false }, world), 0);
  assert.match(logs.join("\n"), /\*\*ticket:\*\* AUTH-1/);
});

await check("F6: same output twice from the same repo — the byte-stable contract, pinned", () => {
  const dir = mkdtempSync(join(tmpdir(), "proof-report-det-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "dev@test"]);
  git(dir, ["config", "user.name", "Dev Tester"]);
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, ["add", "-A"], { date: "2026-11-04T18:00:00Z" });
  git(dir, ["commit", "-q", "-m", "AUTH-1: determinism"], { date: "2026-11-04T18:00:00Z" });
  const a = cli([dir, "--days", "1"], PINNED);
  const b = cli([dir, "--days", "1"], PINNED);
  assert.equal(a.status, 0);
  assert.equal(a.stdout, b.stdout);
});

await check("F8: an inert record's numstat lines never enter the stats", async () => {
  const stdout = [
    recE, // the 4-field record — would carry stat lines if guessed at
    rec(H40("a"), "D", "d@x", T_B, "AUTH-1: real work", ["1\t1\ta.ts"]),
  ].join("\n\n");
  const { world, logs } = fakeWorld({ logStdout: stdout });
  assert.equal(await run({ root: "/r", days: 1, me: false }, world), 0);
  assert.match(logs.join("\n"), /1 unparseable log record skipped/);
  assert.match(logs.join("\n"), /\*\*1 commit · 1 file · \+1 −1\*\*/, "only the parsed record's lines counted");
});

await check("F9: the UTC−12 pole — exact local-midnight boundary, both sides", () => {
  // TZ=Etc/GMT+12: local midnight of 2026-11-04 = Nov 4 12:00:00Z EXACTLY.
  // 12:00:00Z is IN (>=), 11:59:59Z is OUT — the boundary is inclusive on
  // the start, exclusive of nothing below it.
  const dir = mkdtempSync(join(tmpdir(), "proof-report-utc12-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "dev@test"]);
  git(dir, ["config", "user.name", "Dev Tester"]);
  writeFileSync(join(dir, "in.txt"), "in\n");
  git(dir, ["add", "-A"], { date: "2026-11-04T12:00:00Z" });
  git(dir, ["commit", "-q", "-m", "AUTH-IN: exact local midnight"], { date: "2026-11-04T12:00:00Z" });
  writeFileSync(join(dir, "out.txt"), "out\n");
  git(dir, ["add", "-A"], { date: "2026-11-04T11:59:59Z" });
  git(dir, ["commit", "-q", "-m", "AUTH-OUT: one second before midnight"], { date: "2026-11-04T11:59:59Z" });
  const env = { ...PINNED, TZ: "Etc/GMT+12" } as NodeJS.ProcessEnv;
  const r = cli([dir, "--since", "2026-11-04"], env);
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stdout} ${r.stderr}`);
  const out = r.stdout ?? "";
  assert.match(out, /AUTH-IN: exact local midnight/);
  assert.ok(!out.includes("AUTH-OUT"), "11:59:59Z is the wrong side of local midnight at UTC−12");
});

await check("F9: ESC in a real commit subject renders as a picture end-to-end", () => {
  const dir = mkdtempSync(join(tmpdir(), "proof-report-esc-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "dev@test"]);
  git(dir, ["config", "user.name", "Dev Tester"]);
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, ["add", "-A"], { date: "2026-11-04T18:00:00Z" });
  git(dir, ["commit", "-q", "-m", "AUTH-1: evil \x1b[31mred\x1b[0m subject"], { date: "2026-11-04T18:00:00Z" });
  const r = cli([dir, "--days", "1"], PINNED);
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout ?? "";
  assert.ok(!out.includes("\x1b"), "no raw ESC in the pasted report");
  assert.match(out, /␛\[31mred/, "the escape sequence shown as pictures");
});

console.log(`\nself-check: ${n} checks passed (${NOW.toISOString()} fixed clock)`);
