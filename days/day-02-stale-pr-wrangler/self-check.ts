// self-check — the one runnable check. Assert-based, no framework.
// Run: node self-check.ts   (or: npm run check)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDigest, createApi, daysSince, exitCode, isStale, lastPingDate,
  needsPing, pickReviewer, renderPing, run,
  type Api, type Comment, type PR,
} from "./stale-pr.ts";

const here = dirname(fileURLToPath(import.meta.url));
const now = new Date("2026-10-27T12:00:00.000Z"); // fixed clock → deterministic everywhere
const prs: PR[] = JSON.parse(readFileSync(join(here, "fixtures/prs.json"), "utf8"));
const comments = (f: string): Comment[] => JSON.parse(readFileSync(join(here, "fixtures", f), "utf8"));
const TEAM = ["alice", "bob", "carol"];

let n = 0;
const check = async (label: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log(`  ✓ ${label}`); };

// --- pure logic ---
await check("daysSince: fraction, exact boundary, unparsable → -1", () => {
  assert.equal(daysSince("2026-10-27T06:00:00Z", now), 0.25);
  assert.equal(daysSince("2026-10-24T12:00:00Z", now), 3);
  assert.equal(daysSince("not-a-date", now), -1);
});
await check("isStale: >= threshold counts, drafts excluded, bad dates never stale", () => {
  assert.equal(isStale({ number: 1, title: "t", updated_at: "2026-10-24T12:00:00Z", html_url: "u" }, now, 3), true);
  assert.equal(isStale({ number: 1, title: "t", updated_at: "2026-10-24T13:00:00Z", html_url: "u" }, now, 3), false);
  assert.equal(isStale({ number: 1, title: "t", draft: true, updated_at: "2026-10-01T00:00:00Z", html_url: "u" }, now, 3), false);
  assert.equal(isStale({ number: 1, title: "t", updated_at: "", html_url: "u" }, now, 3), false);
});
await check("pickReviewer: PR-number rotation, stable, blank entries dropped, empty → null", () => {
  assert.equal(pickReviewer(41, TEAM), "carol"); // 41 % 3 = 2
  assert.equal(pickReviewer(42, TEAM), "alice"); // 42 % 3 = 0
  assert.equal(pickReviewer(41, TEAM), "carol"); // same PR → same reviewer, forever, no state
  assert.equal(pickReviewer(41, ["  ", "bob", ""]), "bob");
  assert.equal(pickReviewer(41, []), null);
});
await check("lastPingDate: latest marker wins, ignores non-marker comments, none → null", () => {
  assert.equal(lastPingDate(comments("comments-old-ping.json")), "2026-10-20");
  assert.equal(lastPingDate(comments("comments-no-ping.json")), null);
  assert.equal(lastPingDate([]), null);
});
await check("needsPing: fresh marker suppresses, aged marker re-arms, non-stale never pings", () => {
  const pr41 = prs.find((p) => p.number === 41)!;
  assert.equal(needsPing(pr41, comments("comments-no-ping.json"), now, 3), true);
  assert.equal(needsPing(pr41, comments("comments-recent-ping.json"), now, 3), false);
  assert.equal(needsPing(pr41, comments("comments-old-ping.json"), now, 3), true); // pinged 7d ago ≥ window
  assert.equal(needsPing(prs.find((p) => p.number === 44)!, [], now, 3), false);
});
await check("buildDigest: oldest waiter first, floors the days, counts open, rotation filled", () => {
  const d = buildDigest(prs, now, 3, TEAM);
  assert.deepEqual(d.rows.map((r) => r.pr.number), [41, 42]); // 9d, 6d — not the 10d draft (#43)
  assert.deepEqual(d.rows.map((r) => r.days), [9, 6]);
  assert.deepEqual(d.rows.map((r) => r.reviewer), ["carol", "alice"]);
  assert.equal(d.staleCount, 2);
  assert.equal(d.totalOpen, 5);
});
await check("markdown: header, both rows, reviewer tags, pipes in titles escaped", () => {
  const md = buildDigest(prs, now, 3, TEAM).markdown;
  assert.match(md, /## ⏳ stale-PR digest — 2 of 5 open PRs waiting > 3 days/);
  assert.match(md, /\[#41 Fix auth flow \\| retry on 401\]/);
  assert.match(md, /@carol/);
  assert.match(md, /@alice/);
  assert.ok(!md.includes("\n#")); // single H2, no raw newlines breaking the table
});
await check("markdown: clean repo renders the all-clear line", () => {
  const md = buildDigest([prs[0]], now, 3, TEAM).markdown;
  assert.match(md, /## ✅ stale-PR digest — nothing waiting > 3 days \(1 open\)/);
});
await check("renderPing: dated marker, reviewer tag, day count; no-team variant has no @", () => {
  const body = renderPing(prs.find((p) => p.number === 41)!, "carol", now);
  assert.match(body, /9 days/);
  assert.match(body, /@carol/);
  assert.match(body, /<!-- stale-pr-ping 2026-10-27 -->/);
  const bare = renderPing(prs.find((p) => p.number === 41)!, null, now);
  assert.ok(!bare.includes("@"));
  assert.match(bare, /someone with context/);
});
await check("exitCode: only --enforce + stale fails; informational runs stay green for cron", () => {
  assert.equal(exitCode(2, {}), 0);
  assert.equal(exitCode(2, { enforce: true }), 1);
  assert.equal(exitCode(0, { enforce: true }), 0);
});

// --- end-to-end with a fake API that records every write ---
const fakeApi = (commentMap: Record<number, Comment[]>, posts: [number, string][]): Api => ({
  listPRs: async () => prs,
  listComments: async (pr) => commentMap[pr] ?? [],
  postComment: async (pr, body) => { posts.push([pr, body]); },
});
const io = () => {
  const lines: string[] = [], summaries: string[] = [];
  return { log: (s: string) => lines.push(s), summary: (md: string) => summaries.push(md), lines, summaries };
};

await check("run() dry: digest + summary, zero writes", async () => {
  const posts: [number, string][] = [];
  const o = io();
  const code = await run({ repo: "acme/api", threshold: 3, reviewers: TEAM, post: false, enforce: false, now }, fakeApi({}, posts), o);
  assert.equal(code, 0);
  assert.equal(posts.length, 0);
  assert.match(o.lines.join("\n"), /#41 .*waiting 9 days/);
  assert.equal(o.summaries.length, 1);
  assert.match(o.summaries[0], /stale-PR digest/);
});
await check("run() --post: pings only PRs without a fresh marker, exactly one POST each", async () => {
  const posts: [number, string][] = [];
  const o = io();
  const code = await run(
    { repo: "acme/api", threshold: 3, reviewers: TEAM, post: true, enforce: false, now },
    fakeApi({ 41: comments("comments-no-ping.json"), 42: comments("comments-recent-ping.json") }, posts),
    o,
  );
  assert.equal(code, 0);
  assert.deepEqual(posts.map(([pr]) => pr), [41]); // #42 was pinged yesterday — left alone
  assert.match(posts[0][1], /@carol/);
  assert.match(posts[0][1], /<!-- stale-pr-ping 2026-10-27 -->/);
  assert.match(o.lines.join("\n"), /1 ping\(s\) posted/);
});
await check("run() --enforce: stale inventory fails the run (CI-gate use)", async () => {
  const o = io();
  const code = await run({ repo: "acme/api", threshold: 3, reviewers: TEAM, post: false, enforce: true, now }, fakeApi({}, []), o);
  assert.equal(code, 1);
});
await check("run() API failure: message logged, exit 1, no crash", async () => {
  const o = io();
  const failing: Api = { listPRs: async () => { throw new Error("GitHub API 403 on /repos/acme/api/pulls — rate limit"); }, listComments: async () => [], postComment: async () => {} };
  const code = await run({ repo: "acme/api", threshold: 3, reviewers: [], post: false, enforce: false, now }, failing, o);
  assert.equal(code, 1);
  assert.match(o.lines.join("\n"), /GitHub API 403/);
});
await check("createApi: auth header only with token, repo path interpolation", async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fakeFetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), headers: init.headers });
    return { ok: true, status: 200, json: async () => [] } as Response;
  }) as typeof fetch;
  await createApi({ repo: "acme/api", token: "t1", baseUrl: "https://api.github.com/", fetchImpl: fakeFetch }).listPRs();
  await createApi({ repo: "acme/api", fetchImpl: fakeFetch }).listComments(41);
  assert.equal(calls[0].url, "https://api.github.com/repos/acme/api/pulls?state=open&sort=updated&direction=asc&per_page=100");
  assert.equal(calls[0].headers.Authorization, "Bearer t1");
  assert.equal(calls[1].headers.Authorization, undefined); // anonymous read still works for public repos
  assert.match(calls[1].url, /\/issues\/41\/comments\?per_page=100&sort=created&direction=desc/);
});

// --- CLI surface ---
const cli = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [join(here, "stale-pr.ts"), ...args], { encoding: "utf8", env: { ...process.env, GITHUB_REPOSITORY: "", ...env } });
await check("CLI: missing repo and bad --days are usage errors (exit 2), not crashes", () => {
  assert.equal(cli([]).status, 2);
  assert.match(cli([]).stderr, /--repo owner\/name/);
  assert.equal(cli(["--repo", "acme/api", "--days", "x"]).status, 2);
  assert.equal(cli(["--repo", "acme/api", "--days", "0"]).status, 2);
});
await check("CLI: --help works through a symlink (npm bin / npx) — day-01's silent-exit bug, pre-empted", () => {
  const link = join(mkdtempSync(join(tmpdir(), "stale-pr-")), "stale-pr");
  symlinkSync(join(here, "stale-pr.ts"), link);
  const r = spawnSync(process.execPath, [link, "--help"], { encoding: "utf8", env: { ...process.env, GITHUB_REPOSITORY: "" } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /usage: stale-pr/);
});

console.log(`\nself-check: ${n} checks passed (clock fixed at ${now.toISOString()})`);
