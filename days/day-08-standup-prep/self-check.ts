// self-check — the one runnable check. Assert-based, no framework.
// Run: node self-check.ts   (or: npm run check)
//
// Fixture hand-counted twice (D05): 7 records → 5 parse (A,B,C,D,G), 2 inert (E,F).
// Boundary epochs (all hand-computed from day-05's checked anchor
// 1_793_707_200 = 2026-11-03T12:00Z, margins ≥ 24h from any local-midnight
// window edge on any timezone):
//   NOW   = 1_793_890_800 = 2026-11-05T15:00Z
//   T_A   = 1_793_890_000 = 2026-11-05T14:46:40Z  (in window everywhere)
//   T_B   = 1_793_815_200 = 2026-11-04T18:00Z     (in window everywhere)
//   T_OLD = 1_793_534_400 = 2026-11-01T12:00Z     (out of window everywhere)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run, parseLog, parseSince, windowStart, subjectArea, cleanSubject, clip, sanitize, type World, type GitResult } from "./standup-prep.ts";

const here = dirname(fileURLToPath(import.meta.url));
const NOW = new Date(1_793_890_800 * 1000);
const T_A = 1_793_890_000;
const T_B = 1_793_815_200;
const T_OLD = 1_793_534_400;
const T_F = 1_794_322_800; // 2026-11-10T15:00Z — five days AFTER now (F4 future-dated)

let n = 0;
const check = async (label: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log(`  ✓ ${label}`); };

// --- fixture (mimics git exactly: \0 prefix per record, \n BETWEEN records, none after the last) ---
const rec = (author: string, email: string, ts: string, subject: string) =>
  `\0${[author, email, ts, subject].join("\x1f")}`;
// E is built RAW: a genuinely 3-field record (no trailing separator). Note the
// builder trap — `rec(..., undefined)` would join as 4 fields with an empty
// subject (a trailing \x1f), i.e. a VALID record, and the hand-count would lie.
const recE = `\0${["Malformed", "mal@x", "1700000000"].join("\x1f")}`;
const LOG_STDOUT = [
  rec("Dev Tester", "dev@test", String(T_A), "AUTH-12: fix the flaky login retry"),
  rec("Dev Tester", "dev@test", String(T_B), "day-08: build the CLI"),
  rec("Other Person", "other@x", String(T_B), "chore(deps): bump vite"),
  rec("Dev Tester", "dev@test", String(T_B), "add bell \x07 alert"),
  recE,                                                        // E: 3 fields → inert
  rec("Bad Ts", "bad@x", "12x3", "not digits"),                // F: non-numeric ts → inert
  rec("Dev Tester", "dev@test", String(T_B), ""),              // G: empty subject → kept
].join("\n") + "\n" + rec("Last", "last@x", String(T_OLD), "old work: before the window");
// hand-count: A,B,C,D,G parse (5) · E,F inert (2) · Last=1 more parse (6 total, 2 inert)

await check("parseLog: hand-counted 6 parse / 2 inert, subjects carry no separator newline", () => {
  const { commits, inert } = parseLog(LOG_STDOUT);
  assert.equal(commits.length, 6);
  assert.equal(inert, 2);
  assert.equal(commits.find((c) => c.email === "dev@test" && c.subject.startsWith("day-08"))?.subject, "day-08: build the CLI", "no trailing \\n on the subject");
  assert.equal(commits.filter((c) => c.subject === "").length, 1, "empty-subject commit kept, never dropped");
});

// --- subjectArea / cleanSubject (hand-checked against each real-world shape) ---
await check("subjectArea: conventional scope, bare type → null, ticket, day-prefix, none", () => {
  assert.equal(subjectArea("chore(deps): bump vite"), "deps");
  assert.equal(subjectArea("fix: the retry bug"), null);
  assert.equal(subjectArea("feat!: breaking change"), null);
  assert.equal(subjectArea("AUTH-12: fix the flaky login retry"), "AUTH-12");
  assert.equal(subjectArea("AUTH-12 fix without colon"), "AUTH-12");
  assert.equal(subjectArea("day-08: build the CLI"), "day-08");
  assert.equal(subjectArea("update readme"), null);
  assert.equal(subjectArea("Merge pull request #12 from o/x"), null);
});
await check("cleanSubject: the grouping token is stripped, the words stay the author's", () => {
  assert.equal(cleanSubject("chore(deps): bump vite"), "bump vite");
  assert.equal(cleanSubject("fix: the retry bug"), "the retry bug");
  assert.equal(cleanSubject("AUTH-12: fix the flaky login retry"), "fix the flaky login retry");
  assert.equal(cleanSubject("day-08: build the CLI"), "build the CLI");
});

// --- display safety (D06 F6/F7 regressions) ---
await check("clip: 90 runes exactly, mid-rune never cut, ellipsis keeps it valid", () => {
  assert.equal(clip("x".repeat(95), 90).length, 91);
  const emoji = clip("😀".repeat(95), 90);
  assert.equal(Array.from(emoji).length, 91, "code points, not UTF-16 units");
  assert.ok(emoji.endsWith("…"));
  assert.equal(clip("short", 90), "short");
});
await check("sanitize: control chars display as control pictures; tab and newline stay", () => {
  const out = sanitize("add bell \x07 alert");
  assert.ok(out.includes("␇"), "real BEL → U+2407 picture");
  assert.ok(!out.includes("\x07"));
  assert.ok(!out.includes("\\u0007"), "the escape form is retired — pictures can't be impersonated by typed text (F11)");
  assert.equal(sanitize("tab\tkept"), "tab\tkept");
  assert.ok(sanitize("a\nb").includes("\n"), "newline survives (paragraphs are wanted)");
  assert.ok(sanitize("bad\rcr").includes("␍"), "CR becomes a picture — it must not rewrite the line (F13)");
  assert.ok(!sanitize("bad\rcr").includes("\r"));
  assert.ok(sanitize("\x1b[31mred").includes("␛"), "ANSI ESC can't repaint a terminal (F9)");
});

// --- windows (expected values constructed from calendar rules, not the tool's formula) ---
await check("windowStart: local midnight, N days back", () => {
  const d1 = windowStart(NOW, 1);
  const expected1 = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 1);
  assert.equal(d1.getTime(), expected1.getTime());
  assert.equal(d1.getHours(), 0);
  const d2 = windowStart(NOW, 2);
  assert.equal(d2.getTime(), new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 2).getTime());
});
await check("parseSince: date-only is LOCAL midnight; rollover rejected, not silently shifted", () => {
  assert.equal(parseSince("2026-11-03"), new Date(2026, 10, 3).getTime());
  assert.equal(parseSince("2026-11-03T10:30:00Z"), Date.UTC(2026, 10, 3, 10, 30));
  assert.equal(parseSince("2026-13-40"), null);
  assert.equal(parseSince("2026-02-30"), null);
  assert.equal(parseSince("garbage"), null);
});

// --- run() against a scripted git (the recording-world idiom) ---
function fakeWorld(opts: {
  repo?: boolean;
  logStdout?: string;
  logOk?: boolean;
  config?: { email?: string; name?: string };
  now?: Date;
  logs?: string[];
  llm?: (req: { system: string; user: string }) => Promise<string>;
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
      return { ok: opts.logOk !== false, stdout: opts.logStdout ?? "", stderr: opts.logOk === false ? "fatal: bad ref" : "" };
    }
    return { ok: false, stdout: "", stderr: `fake git: unexpected call ${args.join(" ")}` };
  };
  const world: World = {
    git,
    now: () => opts.now ?? NOW,
    log: (s) => logs.push(s),
    ...(opts.llm ? { llm: opts.llm } : {}),
  };
  return { world, logs };
}

await check("not a git repo → exit 2 with one line (cannot check ≠ no commits)", async () => {
  const { world, logs } = fakeWorld({ repo: false });
  assert.equal(await run({ root: "/nope", days: 1, me: false, llm: false }, world), 2);
  assert.match(logs.join("\n"), /not a git repository/);
});
await check("git log failure → exit 2, never exit 1", async () => {
  const { world, logs } = fakeWorld({ logOk: false });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: false }, world), 2);
  assert.match(logs.join("\n"), /git log failed/);
});
await check("empty window → exit 1, message names window and merge rule", async () => {
  const { world, logs } = fakeWorld({ logStdout: "" });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: false }, world), 1);
  assert.match(logs.join("\n"), /no commits in .*merges excluded/);
});
await check("--me with no git identity → exit 2 before any fetch (fail fast)", async () => {
  const { world, logs } = fakeWorld({ config: {} });
  assert.equal(await run({ root: "/r", days: 1, me: true, llm: false }, world), 2);
  assert.match(logs.join("\n"), /--me has nothing to match/);
});
await check("happy path: exit 0, hand-counted bullets in hand-computed order", async () => {
  // 6 commits: A(AUTH-12, newest) then B,C,D,G at T_B (parse order), Last(T_OLD) filtered out
  const { world, logs } = fakeWorld({ config: { email: "dev@test", name: "Dev Tester" }, logStdout: LOG_STDOUT });
  const code = await run({ root: "/r", days: 1, me: false, llm: false }, world);
  assert.equal(code, 0);
  const out = logs.join("\n");
  const bullets = out.split("\n").filter((l) => l.startsWith("- "));
  assert.deepEqual(bullets, [
    "- AUTH-12 — fix the flaky login retry",
    "- day-08 — build the CLI",
    "- deps — bump vite",
    "- add bell ␇ alert",
    "- (no message)",
  ], "newest area first, equal-ts singles in parse order, control char as a control PICTURE, empty subject honest");
  assert.match(out, /· 5 commits\)/, "hand-count: 5 in-window commits (T_OLD filtered)"); // 6 parsed − T_OLD
  assert.match(out, /2 unparseable log records skipped/);
});
await check("--me: only the config identity's commits, header names the filter", async () => {
  const { world, logs } = fakeWorld({ config: { email: "dev@test", name: "Dev Tester" }, logStdout: LOG_STDOUT });
  const code = await run({ root: "/r", days: 1, me: true, llm: false }, world);
  assert.equal(code, 0);
  const out = logs.join("\n");
  assert.match(out, /4 commits by dev@test/);
  assert.ok(!out.includes("bump vite"), "Other Person's commit never enters the draft");
});
await check("--me matching by NAME when email differs (rebases rewrite emails, names stick)", async () => {
  const { world, logs } = fakeWorld({ config: { email: "me@new", name: "Dev Tester" }, logStdout: LOG_STDOUT });
  assert.equal(await run({ root: "/r", days: 1, me: true, llm: false }, world), 0);
  assert.match(logs.join("\n"), /4 commits by Dev Tester/);
});
await check("same-area grouping: newest subject headlines, count is honest", async () => {
  const stdout = [
    rec("D", "d@x", String(T_A), "AUTH-12: fix the flaky login retry"),
    rec("D", "d@x", String(T_A + 100), "AUTH-12: add retry tests"),
  ].join("\n");
  const { world, logs } = fakeWorld({ logStdout: stdout });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: false }, world), 0);
  const bullets = logs.join("\n").split("\n").filter((l) => l.startsWith("- "));
  assert.deepEqual(bullets, ["- AUTH-12 — add retry tests (2 commits)"]);
});
await check("out-of-window-only commits → exit 1 (T_OLD is out on every timezone)", async () => {
  const stdout = rec("D", "d@x", String(T_OLD), "old: before the window");
  const { world } = fakeWorld({ logStdout: stdout });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: false }, world), 1);
});
await check("fetch-cap note prints when the cap is hit", async () => {
  const recs: string[] = [];
  for (let i = 0; i < 1000; i++) recs.push(rec("D", "d@x", String(T_B), `work-${i}: thing`));
  const { world, logs } = fakeWorld({ logStdout: recs.join("\n") });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: false }, world), 0);
  assert.match(logs.join("\n"), /fetch cap 1000 hit/);
});

// --- --llm (injected fake; the real provider path is CLI-tested below) ---
await check("--llm: polish prints under the draft; exit 0", async () => {
  const calls: { system: string; user: string }[] = [];
  const { world, logs } = fakeWorld({
    logStdout: LOG_STDOUT,
    llm: async (req) => { calls.push(req); return "Polished: shipped the auth retry fix."; },
  });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: true }, world), 0);
  assert.match(logs.join("\n"), /— tone pass/);
  assert.match(logs.join("\n"), /Polished: shipped the auth retry fix/);
  assert.match(calls[0].user, /AUTH-12/, "the prompt carries the real commit subjects");
});
await check("--llm: empty response → exit 2, base draft still printed (never lost)", async () => {
  const { world, logs } = fakeWorld({ logStdout: LOG_STDOUT, llm: async () => "   " });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: true }, world), 2);
  const out = logs.join("\n");
  assert.match(out, /AUTH-12 — fix the flaky login retry/, "draft before the failure");
  assert.match(out, /tone pass failed/);
});
await check("--llm: provider throws → exit 2, draft survives, reason named", async () => {
  const { world, logs } = fakeWorld({ logStdout: LOG_STDOUT, llm: async () => { throw new Error("HTTP 503 from endpoint"); } });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: true }, world), 2);
  assert.match(logs.join("\n"), /HTTP 503/);
});
await check("--llm requested but no llm wired → exit 2 (defensive seam check)", async () => {
  const { world, logs } = fakeWorld({ logStdout: LOG_STDOUT });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: true }, world), 2);
  assert.match(logs.join("\n"), /no LLM is wired/);
});

// --- CLI subprocess edges (exit matrix, pipe-free assertions come from rung 2) ---
const cli = (args: string[], env?: NodeJS.ProcessEnv) =>
  spawnSync(process.execPath, [join(here, "standup-prep.ts"), ...args], { encoding: "utf8", cwd: here, env: env ?? process.env });

await check("CLI: unknown flag → usage exit 2, no stack", () => {
  const r = cli(["--bogus"]);
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stderr ?? "", /\n\s+at /);
});
await check("CLI: two positionals → usage exit 2", () => {
  assert.equal(cli(["a", "b"]).status, 2);
});
await check("CLI: --days 0 / --days 99 / --days abc → exit 2", () => {
  assert.equal(cli(["--days", "0"]).status, 2);
  assert.equal(cli(["--days", "99"]).status, 2);
  assert.equal(cli(["--days", "abc"]).status, 2);
});
await check("CLI: --since garbage → exit 2", () => {
  assert.equal(cli(["--since", "not-a-date"]).status, 2);
});
await check("CLI: --llm without any key → exit 2 BEFORE git work, naming the env vars", () => {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.STANDUP_LLM_KEY;
  const r = cli(["--llm"], env);
  assert.equal(r.status, 2);
  assert.match(r.stdout ?? "", /needs STANDUP_LLM_KEY or OPENAI_API_KEY/);
  assert.doesNotMatch(r.stdout ?? "", /standup draft/, "fail fast: no draft, no half-delivered run");
});

// --- end-to-end against real git (the provider itself; dates pinned via env) ---
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

await check("real git end-to-end: window filter, --me by config, empty-message honesty, area grouping", () => {
  const dir = mkdtempSync(join(tmpdir(), "standup-prep-repo-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "dev@test"]);
  git(dir, ["config", "user.name", "Dev Tester"]);
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, ["add", "-A"], { date: "2026-11-01T12:00:00Z" });
  git(dir, ["commit", "-q", "-m", "old work: before the window"], { date: "2026-11-01T12:00:00Z" });
  // in-window (everywhere): 2 dev commits, same area; 1 other-author; 1 empty-message
  writeFileSync(join(dir, "b.txt"), "b\n");
  git(dir, ["add", "-A"], { date: "2026-11-04T18:00:00Z" });
  git(dir, ["commit", "-q", "-m", "AUTH-99: real end-to-end work"], { date: "2026-11-04T18:00:00Z" });
  git(dir, ["commit", "-q", "--allow-empty-message", "-m", "", "--allow-empty"], { date: "2026-11-04T19:00:00Z" });
  writeFileSync(join(dir, "c.txt"), "c\n");
  git(dir, ["add", "-A"], { date: "2026-11-04T20:00:00Z", name: "Other Person", email: "other@x" });
  git(dir, ["commit", "-q", "-m", "chore(deps): bump vite"], { date: "2026-11-04T20:00:00Z", name: "Other Person", email: "other@x" });

  const env = { ...process.env, STANDUP_PREP_FAKE_NOW: String(1_793_890_800) };
  const all = cli([dir, "--days", "1"], env);
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout ?? "", /· 3 commits\)/, "hand-count: AUTH-99 + empty-message + other's = 3 in-window (T_OLD excluded)");
  assert.match(all.stdout ?? "", /AUTH-99 — real end-to-end work/);
  assert.match(all.stdout ?? "", /\(no message\)/, "real git's empty message renders honestly");
  assert.ok(!(all.stdout ?? "").includes("old work"), "T_OLD is outside every timezone's window");

  const mine = cli([dir, "--days", "1", "--me"], env);
  assert.equal(mine.status, 0);
  assert.match(mine.stdout ?? "", /2 commits by dev@test/, "hand-count: AUTH-99 + empty, other excluded");
  assert.ok(!(mine.stdout ?? "").includes("bump vite"), "Other Person filtered by config identity");
});

await check("real git: --since date-only covers the same commits as --days (window math agrees)", () => {
  const dir = mkdtempSync(join(tmpdir(), "standup-prep-since-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "dev@test"]);
  git(dir, ["config", "user.name", "Dev Tester"]);
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, ["add", "-A"], { date: "2026-11-04T18:00:00Z" });
  git(dir, ["commit", "-q", "-m", "AUTH-77: since-window work"], { date: "2026-11-04T18:00:00Z" });
  const env = { ...process.env, STANDUP_PREP_FAKE_NOW: String(1_793_890_800) };
  const r = cli([dir, "--since", "2026-11-03"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout ?? "", /AUTH-77 — since-window work/);
});
await check("real git: --since is LOCAL midnight, not UTC — a commit in the local-vs-UTC gap is in", () => {
  // TZ=UTC+14: local midnight of 2026-11-03 = 2026-11-02T10:00Z; UTC midnight = 11-03T00:00Z.
  // A commit at 11-02T18:00Z is LOCAL-DATE 11-03 but BEFORE UTC midnight — a raw
  // new Date("2026-11-03") (UTC) would exclude it; the local parser must include it.
  const dir = mkdtempSync(join(tmpdir(), "standup-prep-since-local-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "dev@test"]);
  git(dir, ["config", "user.name", "Dev Tester"]);
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, ["add", "-A"], { date: "2026-11-02T18:00:00Z" });
  git(dir, ["commit", "-q", "-m", "AUTH-88: gap-window work"], { date: "2026-11-02T18:00:00Z" });
  const env = { ...process.env, STANDUP_PREP_FAKE_NOW: String(1_793_890_800), TZ: "XXX-14" };
  const r = cli([dir, "--since", "2026-11-03"], env);
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stdout} ${r.stderr}`);
  assert.match(r.stdout ?? "", /AUTH-88 — gap-window work/, "local-midnight window includes the UTC-gap commit");
});

// --- adversarial-pass regressions (F# = day-08 findings, each reproduced twice upstream) ---

await check("F2: all-inert window → exit 1 but the inert note is NOT swallowed", async () => {
  const stdout = [
    rec("D", "d@x", String(T_B), "has\x1funit separator"),
    rec("D", "d@x", String(T_B), "also\x1fbroken"),
  ].join("\n");
  const { world, logs } = fakeWorld({ logStdout: stdout });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: false }, world), 1);
  const out = logs.join("\n");
  assert.match(out, /\(2 unparseable log records skipped/);
  assert.match(out, /no commits in/);
  assert.ok(out.indexOf("unparseable") < out.indexOf("no commits"), "the fetch note precedes the verdict");
});

await check("F3: a same-name stranger with a different email never enters my draft", async () => {
  const stdout = [
    rec("Dev Tester", "me@x", String(T_A), "AUTH-1: mine"),
    rec("Dev Tester", "other@x", String(T_B), "AUTH-2: not mine, same NAME"),
    rec("Collab", "me@x", String(T_B), "AUTH-3: not mine, but MY email wrote it"),
  ].join("\n");
  const { world, logs } = fakeWorld({ config: { email: "me@x", name: "Dev Tester" }, logStdout: stdout });
  const code = await run({ root: "/r", days: 1, me: true, llm: false }, world);
  assert.equal(code, 0);
  const out = logs.join("\n");
  assert.match(out, /2 commits by me@x/, "hand-count: my email wrote AUTH-1 and AUTH-3");
  assert.ok(!out.includes("AUTH-2"), "name-only match excluded when email is authoritative");
});

await check("F4: future-dated commits excluded and counted; header stays true", async () => {
  const stdout = [
    rec("D", "d@x", String(T_F), "AUTH-9: dated tomorrow"),
    rec("D", "d@x", String(T_B), "AUTH-10: dated today"),
  ].join("\n");
  const { world, logs } = fakeWorld({ logStdout: stdout });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: false }, world), 0);
  const out = logs.join("\n");
  assert.match(out, /· 1 commit\)/, "singular, and the future commit is out");
  assert.match(out, /\(1 commit dated after now excluded/);
  assert.ok(!out.includes("AUTH-9"));
});

await check("F5: cap-full fetch still prints the cap note when inert records ate the count", async () => {
  const recs: string[] = [];
  for (let i = 0; i < 999; i++) recs.push(rec("D", "d@x", String(T_B), `work-${i}: thing`));
  recs.push(rec("D", "d@x", String(T_B), "broken\x1fsubject")); // the 1000th record, inert
  const { world, logs } = fakeWorld({ logStdout: recs.join("\n") });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: false }, world), 0);
  const out = logs.join("\n");
  assert.match(out, /fetch cap 1000 hit/, "fetched = 999 parsed + 1 inert = 1000 ≥ cap");
  assert.match(out, /1 unparseable log record skipped/);
});

await check("F6: bare repo → exit 2 naming the real reason (it IS a repository)", () => {
  const dir = mkdtempSync(join(tmpdir(), "standup-prep-src-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "dev@test"]);
  git(dir, ["config", "user.name", "Dev Tester"]);
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, ["add", "-A"], { date: "2026-11-04T18:00:00Z" });
  git(dir, ["commit", "-q", "-m", "AUTH-6: bare source"], { date: "2026-11-04T18:00:00Z" });
  const bare = mkdtempSync(join(tmpdir(), "standup-prep-bare-")) + "/r.git";
  git(dir, ["clone", "-q", "--bare", dir, bare]);
  const r = cli([bare]);
  assert.equal(r.status, 2);
  assert.match(r.stdout ?? "", /bare repository/);
  assert.doesNotMatch(r.stdout ?? "", /not a git repository/, "the old reason was false");
});

await check("F7: git binary missing → 'git is not available', not 'not a repository'", () => {
  const env = { ...process.env, PATH: "/nonexistent" };
  const r = cli([here], env);
  assert.equal(r.status, 2);
  assert.match(r.stdout ?? "", /git is not available|spawn failed/);
});

await check("F8: garbage-but-numeric FAKE_NOW falls back to the real clock — no NaN, no lie", () => {
  const dir = mkdtempSync(join(tmpdir(), "standup-prep-fake-now-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "dev@test"]);
  git(dir, ["config", "user.name", "Dev Tester"]);
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, ["add", "-A"], { date: "2026-01-01T00:00:00Z" });
  git(dir, ["commit", "-q", "-m", "AUTH-8: old commit"], { date: "2026-01-01T00:00:00Z" });
  const env = { ...process.env, STANDUP_PREP_FAKE_NOW: "99999999999999999999" };
  const r = cli([dir, "--days", "1"], env);
  assert.equal(r.status, 1, "real clock, real window, repo is stale → honest empty");
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  assert.ok(!out.includes("NaN"), `no NaN: ${out.slice(0, 200)}`);
  assert.ok(!out.includes("undefined"), "no undefined in the window label");
});

await check("F9: hostile LLM output cannot repaint the terminal", async () => {
  const { world, logs } = fakeWorld({ logStdout: LOG_STDOUT, llm: async () => "\x1b[31mRED\x1b[0m\rX\x07Y" });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: true }, world), 0);
  const out = logs.join("\n");
  assert.ok(!out.includes("\x1b"), "no raw ESC");
  assert.ok(!out.includes("\r"), "no raw CR");
  assert.ok(!out.includes("\x07"), "no raw BEL");
  assert.ok(out.includes("␛[31mRED"), "ANSI shown as pictures");
  assert.ok(out.includes("␍X␇Y"));
});

await check("F11: a real BEL and literal '\\u0007' text render DISTINCTLY", async () => {
  const stdout = [
    rec("D", "d@x", String(T_B), "real \x07 bell here"),
    rec("D", "d@x", String(T_B), "literal \\u0007 text here"),
  ].join("\n");
  const { world, logs } = fakeWorld({ logStdout: stdout });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: false }, world), 0);
  const bullets = logs.join("\n").split("\n").filter((l) => l.startsWith("- "));
  assert.deepEqual(bullets, ["- real ␇ bell here", "- literal \\u0007 text here"]);
});

await check("F12: a swallowed token ('feat(scope):') still shows the subject, never '(no message)'", async () => {
  const stdout = rec("D", "d@x", String(T_B), "feat(scope):");
  const { world, logs } = fakeWorld({ logStdout: stdout });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: false }, world), 0);
  assert.match(logs.join("\n"), /- scope — feat\(scope\):/);
});

await check("F13: raw CR in a subject renders as a picture, terminal-safe", async () => {
  const stdout = rec("D", "d@x", String(T_B), "bad\rcarriage return here");
  const { world, logs } = fakeWorld({ logStdout: stdout });
  assert.equal(await run({ root: "/r", days: 1, me: false, llm: false }, world), 0);
  const out = logs.join("\n");
  assert.ok(!out.includes("\r"));
  assert.match(out, /bad␍carriage return here/);
});

await check("F1 (agent repro, Kolkata): a 03:00 commit ON the requested date is in", () => {
  // 2026-11-04T03:00+05:30 = 2026-11-03T21:30Z → local-date Nov 4 in Kolkata
  const dir = mkdtempSync(join(tmpdir(), "standup-prep-f1-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "dev@test"]);
  git(dir, ["config", "user.name", "Dev Tester"]);
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, ["add", "-A"], { date: "2026-11-03T21:30:00Z" });
  git(dir, ["commit", "-q", "-m", "AUTH-F1: kolkata three-am commit"], { date: "2026-11-03T21:30:00Z" });
  const env = { ...process.env, STANDUP_PREP_FAKE_NOW: String(1_793_890_800), TZ: "Asia/Kolkata" };
  const r = cli([dir, "--since", "2026-11-04"], env);
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stdout} ${r.stderr}`);
  assert.match(r.stdout ?? "", /AUTH-F1 — kolkata three-am commit/);
  assert.match(r.stdout ?? "", /window Nov 4 00:00/, "local midnight, not UTC");
});

console.log(`\nself-check: ${n} checks passed (${NOW.toISOString()} fixed clock)`);
