#!/usr/bin/env node
// stale-pr — daily digest of a repo's oldest waiting PRs + rotating-reviewer nudges.
//
// ponytail: single-file CLI, zero dependencies — native fetch (Node >= 22), node:util
// parseArgs, native TS type-stripping (Node >= 22.18). A scheduled workflow is the
// whole "GitHub Action"; no action.yml packaging because composite actions can't
// carry a cron trigger — the consumer's workflow is the platform feature.
// Upgrade trigger: a second output channel (Slack etc.) or org-wide mode.

import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

// ---------- types (the GitHub REST shapes we consume, nothing more) ----------

export type PR = {
  number: number;
  title: string;
  draft?: boolean;
  updated_at: string;
  html_url: string;
  user?: { login: string } | null;
  requested_reviewers?: { login: string }[] | null;
};

export type Comment = { body: string; created_at: string };

export type Api = {
  listPRs(): Promise<PR[]>;
  listComments(pr: number, since: string): Promise<Comment[]>;
  postComment(pr: number, body: string): Promise<void>;
};

// ---------- pure logic (all of it exercised by self-check.ts) ----------

const DAY_MS = 86_400_000;

/** Whole-ish days since an ISO timestamp; -1 if unparsable (callers treat as "not stale" — never ping on bad data). */
export function daysSince(iso: string, now: Date): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return -1;
  return (now.getTime() - t) / DAY_MS;
}

/** Stale = open non-draft PR with no activity (push, edit, comment — updated_at) for >= threshold days. */
export function isStale(pr: PR, now: Date, threshold: number): boolean {
  if (pr.draft) return false;
  return daysSince(pr.updated_at, now) >= threshold;
}

/** Deterministic rotation: PR number % team. No state file — the PR number is the state. */
export function pickReviewer(seed: number, reviewers: string[]): string | null {
  const clean = reviewers.map((r) => r.trim()).filter(Boolean);
  return clean.length ? clean[Math.abs(seed) % clean.length] : null;
}

// our own machine-readable marker inside ping comments; ISO dates sort lexically
const MARKER = /<!--\s*stale-pr-ping (\d{4}-\d{2}-\d{2})\s*-->/;

export function lastPingDate(comments: Comment[]): string | null {
  let latest: string | null = null;
  for (const c of comments) {
    const m = c.body.match(MARKER);
    if (m && (!latest || m[1] > latest)) latest = m[1];
  }
  return latest;
}

/** Ping at most once per threshold window: a fresh marker suppresses, an aged one re-arms.
 *  Works whether or not our comment bumps the PR's updated_at — the marker date is ours. */
export function needsPing(pr: PR, comments: Comment[], now: Date, threshold: number): boolean {
  if (!isStale(pr, now, threshold)) return false;
  const last = lastPingDate(comments);
  if (!last) return true;
  return daysSince(last, now) >= threshold;
}

export type Row = { pr: PR; days: number; author: string; asked: string[]; reviewer: string | null };

export function buildDigest(
  prs: PR[],
  now: Date,
  threshold: number,
  reviewers: string[] = [],
): { rows: Row[]; markdown: string; staleCount: number; totalOpen: number } {
  const rows = prs
    .filter((p) => isStale(p, now, threshold))
    .map((p) => ({
      pr: p,
      days: Math.floor(daysSince(p.updated_at, now)),
      author: p.user?.login ?? "?",
      asked: (p.requested_reviewers ?? []).map((r) => r.login),
      // never nudge the author to review their own PR
      reviewer: pickReviewer(p.number, reviewers.filter((r) => r.trim() !== p.user?.login)),
    }))
    .sort((a, b) => b.days - a.days); // oldest waiter first — the whole point
  return { rows, staleCount: rows.length, totalOpen: prs.length, markdown: renderMarkdown(rows, prs.length, threshold) };
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 60);

// ponytail: we fetch one page of 100, so a full page means "at least 100", not "exactly 100"
export const openLabel = (n: number) => (n >= 100 ? `${n}+` : `${n}`);

function renderMarkdown(rows: Row[], totalOpen: number, threshold: number): string {
  if (!rows.length) return `## ✅ stale-PR digest — nothing waiting > ${threshold} days (${openLabel(totalOpen)} open)\n`;
  const head = `## ⏳ stale-PR digest — ${rows.length} of ${openLabel(totalOpen)} open PRs waiting > ${threshold} days\n\n| Waiting | PR | Author | Asked | Today's nudge |\n|---|---|---|---|---|\n`;
  const body = rows
    .map((r) =>
      `| ${r.days}d | [#${r.pr.number} ${cell(r.pr.title)}](${r.pr.html_url}) | ${r.author} | ${r.asked.length ? r.asked.join(", ") : "—"} | ${r.reviewer ? `@${r.reviewer}` : "—"} |`,
    )
    .join("\n");
  return head + body + `\n\n_Pings at most once per ${threshold}-day window · rotation = PR number % team size._\n`;
}

export function renderPing(pr: PR, reviewer: string | null, now: Date): string {
  const days = Math.floor(Math.max(0, daysSince(pr.updated_at, now)));
  const who = reviewer ? `@${reviewer}` : "someone with context on this area";
  return [
    `⏳ **stale-PR ping** — no activity on this PR for **${days} days**. It's one of the oldest still waiting in this repo.`,
    ``,
    `${who} — you're today's rotating reviewer (rotation = PR number % team). Please review it, or reply here with why it can't be reviewed yet.`,
    ``,
    `<!-- stale-pr-ping ${now.toISOString().slice(0, 10)} -->`,
  ].join("\n");
}

export function exitCode(staleCount: number, opts: { enforce?: boolean } = {}): number {
  return opts.enforce && staleCount > 0 ? 1 : 0;
}

// ---------- orchestrator (world injected: api + io, like day-01's probe) ----------

export type RunOpts = {
  repo: string;
  threshold: number;
  reviewers: string[];
  post: boolean;
  enforce: boolean;
  now?: Date;
};

export type RunIo = { log: (s: string) => void; summary?: (md: string) => void };

export async function run(opts: RunOpts, api: Api, io: RunIo): Promise<number> {
  const now = opts.now ?? new Date();
  try {
    const prs = await api.listPRs();
    const d = buildDigest(prs, now, opts.threshold, opts.reviewers);
    io.log(`stale-pr — ${opts.repo} (threshold: ${opts.threshold} days, ${openLabel(d.totalOpen)} open)`);
    if (!d.rows.length) io.log(` ✓ nothing waiting > ${opts.threshold} days`);
    for (const r of d.rows) {
      io.log(` ⏳ #${r.pr.number} · ${r.pr.title.slice(0, 50)} — waiting ${r.days} days${r.asked.length ? ` (asked: ${r.asked.join(", ")})` : ""} → nudge: ${r.reviewer ? `@${r.reviewer}` : "nobody configured"}`);
    }
    io.summary?.(d.markdown);
    let pings = 0;
    if (opts.post && d.rows.length) {
      for (const r of d.rows) {
        // only comments from inside the window can hold a marker that suppresses a ping
        const since = new Date(now.getTime() - opts.threshold * DAY_MS).toISOString();
        const comments = await api.listComments(r.pr.number, since);
        if (!needsPing(r.pr, comments, now, opts.threshold)) continue;
        await api.postComment(r.pr.number, renderPing(r.pr, r.reviewer, now));
        pings++;
      }
    }
    io.log(`${d.staleCount} stale · ${opts.post ? `${pings} ping(s) posted` : "dry-run (--post to nudge)"} · ${opts.enforce ? "enforcing" : "informational"}`);
    return exitCode(d.staleCount, { enforce: opts.enforce });
  } catch (e) {
    io.log(`error: ${(e as Error).message}`);
    return 1;
  }
}

// ---------- GitHub REST client (the only impure surface besides io) ----------

export function createApi(cfg: {
  repo: string;
  token?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Api {
  const base = (cfg.baseUrl ?? "https://api.github.com").replace(/\/$/, "");
  // ponytail: one page, sorted oldest-activity first — staleness lives at that end,
  // so on a 1000-PR repo page 1 is still the right page. A `Link: rel="next"` walk is
  // the upgrade trigger when someone legitimately has >100 simultaneously-stale PRs.
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
    const res = await (cfg.fetchImpl ?? fetch)(`${base}${path}`, { ...init, headers });
    if (!res.ok) {
      let detail = "";
      try { detail = ((await res.json()) as { message?: string }).message ?? ""; } catch { /* non-JSON error body */ }
      throw new Error(`GitHub API ${res.status} on ${path}${detail ? ` — ${detail}` : ""}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  };
  return {
    listPRs: () => call<PR[]>(`/repos/${cfg.repo}/pulls?state=open&sort=updated&direction=asc&per_page=100`),
    // `since`, not sort: the per-issue comments endpoint ignores sort/direction (always oldest-first),
    // so on a 500-comment PR a recent marker would sit on page 5. `since` keeps it on page 1.
    listComments: (pr, since) => call<Comment[]>(`/repos/${cfg.repo}/issues/${pr}/comments?per_page=100&since=${encodeURIComponent(since)}`),
    postComment: (pr, body) =>
      call<unknown>(`/repos/${cfg.repo}/issues/${pr}/comments`, { method: "POST", body: JSON.stringify({ body }) }),
  };
}

// ---------- CLI ----------

function main(): void {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        help: { type: "boolean", short: "h" },
        repo: { type: "string" },        // default: $GITHUB_REPOSITORY (set by Actions)
        days: { type: "string" },        // staleness threshold, default 3
        reviewers: { type: "string" },   // comma-separated logins, rotation pool
        post: { type: "boolean" },       // actually comment (default: dry-run)
        enforce: { type: "boolean" },    // exit 1 while anything is stale
      },
    }));
  } catch (e) {
    // unknown flag / missing value / stray positional is a usage error (2), not an API failure (1)
    console.error(`stale-pr: ${(e as Error).message}\nrun with --help for usage`);
    process.exitCode = 2;
    return;
  }
  if (values.help) {
    console.log(`usage: stale-pr [--repo owner/name] [--days N] [--reviewers a,b,c] [--post] [--enforce]
  env: GITHUB_TOKEN (private repos + --post), GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_STEP_SUMMARY`);
    return;
  }
  const repo = values.repo ?? process.env.GITHUB_REPOSITORY;
  const threshold = Number(values.days ?? 3);
  if (!repo || !repo.includes("/")) {
    console.error("stale-pr: need --repo owner/name (or run inside Actions where GITHUB_REPOSITORY is set)");
    process.exitCode = 2;
    return;
  }
  if (!Number.isInteger(threshold) || threshold < 1) {
    console.error(`stale-pr: --days must be a positive integer, got "${values.days}"`);
    process.exitCode = 2;
    return;
  }
  const reviewers = (values.reviewers ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  run(
    { repo, threshold, reviewers, post: !!values.post, enforce: !!values.enforce },
    createApi({ repo, token: process.env.GITHUB_TOKEN, baseUrl: process.env.GITHUB_API_URL }),
    {
      log: (s) => console.log(s),
      summary: summaryPath ? (md) => appendFileSync(summaryPath, md + "\n") : undefined,
    },
  ).then(
    (code) => { process.exitCode = code; },
    (e) => { console.error(`stale-pr: unexpected failure — ${(e as Error).message}`); process.exitCode = 1; },
  );
}

// realpath: running through a symlink (npm bin / npx) must still trigger main()
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
