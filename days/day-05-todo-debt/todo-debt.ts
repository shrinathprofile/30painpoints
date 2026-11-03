#!/usr/bin/env node
// todo-debt — index TODO/FIXME/HACK marker comments with author + age from git
// blame, and ratchet PRs that add net-new debt (exit 1) vs pay it down (exit 0).
//
// ponytail: single-file CLI, zero dependencies — git ls-files / diff / blame are
// the provider (age comes from blame, never from dates parsed out of comments),
// node:util parseArgs, native TS type-stripping (Node >= 22.18). No action.yml:
// a PR-triggered workflow is the platform feature (day-02 finding — composite
// actions can't carry triggers). Upgrade trigger: a second subcommand or a
// second VCS provider.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// ---------- types ----------

export type ScanHit = { line: number; marker: string; note: string };
export type Row = { file: string; line: number; marker: string; note: string; author: string; ageDays: number | null };
export type DiffHit = { file: string; line: number; marker: string; note: string };
export type BlameEntry = { author: string; time: number };

// ---------- pure logic (all of it exercised by self-check.ts) ----------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Markers match as whole words, case exactly as given — uppercase TODO is the
 *  convention, lowercase "todo" is prose. Custom markers arrive via --markers.
 *  ponytail: a marker word in prose indexes too ("TODO-debt indexer" in a doc) —
 *  grep has the same eyes; a code-only allowlist waits for a user who needs it. */
export function markerRegex(markers: string[]): RegExp {
  // lookarounds, not \b: \b needs a word char on the marker's own edge, so "@todo" never matched
  return new RegExp(`(?<!\\w)(?:${markers.map(escapeRe).join("|")})(?!\\w)`);
}

/** Marker hits in one file's text. Binary content (NUL byte) has no debt. */
export function scanText(content: string, re: RegExp): ScanHit[] {
  if (content.includes("\u0000")) return [];
  const out: ScanHit[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const note = lines[i].slice(m.index + m[0].length).replace(/^\s*:?\s*/, "").trim();
    out.push({ line: i + 1, marker: m[0], note });
  }
  return out;
}

/** `git blame --line-porcelain` → final line number → {author, epoch seconds}.
 *  Header: `<sha> <orig> <final> [<count>]`; metadata until the `\t<content>` line. */
export function parseBlame(porcelain: string): Map<number, BlameEntry> {
  const map = new Map<number, BlameEntry>();
  let finalLine = 0;
  let cur: BlameEntry = { author: "", time: 0 };
  for (const raw of porcelain.split("\n")) {
    const h = raw.match(/^[0-9a-f]+ \d+ (\d+)(?: \d+)?$/);
    if (h) {
      finalLine = Number(h[1]);
      cur = { author: "", time: 0 };
    } else if (raw.startsWith("author ")) cur.author = raw.slice(7);
    else if (raw.startsWith("author-time ")) cur.time = Number(raw.slice(12));
    else if (raw.startsWith("\t")) map.set(finalLine, cur); // the content line closes the block
  }
  return map;
}

const UNCOMMITTED = "Not Committed Yet";

/** Blame entry → row fields. Uncommitted lines carry no age (they are age 0
 *  only in the sense that nothing has accepted them yet — show them, don't guess). */
function blameFields(e: BlameEntry | undefined, now: Date): { author: string; ageDays: number | null } {
  if (!e) return { author: "?", ageDays: null }; // blame ran but the line wasn't found (moved/unmerged)
  if (e.author === UNCOMMITTED) return { author: "uncommitted", ageDays: null };
  return { author: e.author, ageDays: Math.floor((now.getTime() / 1000 - e.time) / 86_400) };
}

/** `git diff --unified=0` → marker hits on added (+) and removed (-) lines, with
 *  line numbers counted inside each hunk. The @@ trailing context is ignored —
 *  only +N/-N lines are content, and "--- a/" / "+++ b/" headers are not content. */
export function parseDiff(text: string, re: RegExp): { added: DiffHit[]; removed: DiffHit[] } {
  const added: DiffHit[] = [];
  const removed: DiffHit[] = [];
  let plusFile = "", minusFile = "", plusAt = 0, minusAt = 0, inHunk = false;
  // headers exist only OUTSIDE hunks; content only INSIDE — that split is what
  // tells a real "+++ TODO" content line apart from a "+++ b/file" header
  const hit = (s: string) => {
    const m = s.match(re);
    return m ? { marker: m[0], note: s.slice(m.index + m[0].length).replace(/^\s*:?\s*/, "").trim() } : null;
  };
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) inHunk = false; // next file section — no hunks yet
    // trimEnd: git suffixes a TAB onto header paths containing spaces ("+++ b/my file.ts\t")
    else if (!inHunk && raw.startsWith("--- ")) minusFile = headerPath(raw).replace(/^a\//, "");
    else if (!inHunk && raw.startsWith("+++ ")) plusFile = headerPath(raw).replace(/^b\//, "");
    else if (raw.startsWith("@@")) {
      const h = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/); // trailing context after @@ is never content
      if (h) { minusAt = Number(h[1]); plusAt = Number(h[2]); inHunk = true; }
    } else if (inHunk) {
      if (raw.startsWith("+")) {
        const m = hit(raw.slice(1));
        if (m && plusFile) added.push({ file: plusFile, line: plusAt, ...m });
        plusAt++;
      } else if (raw.startsWith("-")) {
        const m = hit(raw.slice(1));
        if (m && minusFile) removed.push({ file: minusFile, line: minusAt, ...m });
        minusAt++;
      }
    }
  }
  return { added, removed };
}

/** "+++ b/x" → "b/x". git C-quotes paths with tabs/quotes/backslashes ("b/q\"x.ts") even
 *  with core.quotepath=false; those escapes are JSON-compatible (octal only appears with quotepath on). */
function headerPath(raw: string): string {
  const p = raw.slice(4).trimEnd();
  if (!p.startsWith('"')) return p;
  try { return JSON.parse(p) as string; } catch { return p; }
}

export const netDebt = (added: number, removed: number) => added - removed;
export const exitCode = (net: number) => (net > 0 ? 1 : 0);

// ---------- rendering ----------

const cell = (s: string, n: number) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, n);
const age = (d: number | null) => (d === null ? "—" : `${d}d`);

export function indexMarkdown(rows: Row[], filesScanned: number): string {
  if (!rows.length) return `## ✅ todo-debt — no marker comments in ${filesScanned} tracked file(s)\n`;
  const byAge = [...rows].sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
  const top = byAge.slice(0, 50); // ponytail: summary table caps at 50 — the console prints everything
  const body = top.map((r) => `| ${age(r.ageDays)} | ${r.author || "?"} | ${r.marker} | \`${cell(`${r.file}:${r.line}`, 60)}\` | ${cell(r.note, 40)} |`).join("\n");
  const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.marker] = (a[r.marker] ?? 0) + 1), a), {});
  const oldest = byAge[0].ageDays;
  return `## ⏳ todo-debt — ${rows.length} marker item(s) in ${filesScanned} tracked file(s) · oldest ${age(oldest)}\n\n| Age | Author | Type | Location | Note |\n|---|---|---|---|---|\n${body}\n${byAge.length > top.length ? `\n_+${byAge.length - top.length} more (console shows all)_\n` : ""}\n_Totals: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ")} · age and author from \`git blame\`, never from dates in comments._\n`;
}

export function driftMarkdown(added: DiffHit[], removed: DiffHit[]): string {
  const net = netDebt(added.length, removed.length);
  const line = (p: "+" | "-", h: DiffHit) => `| ${p} | \`${cell(`${h.file}:${h.line}`, 60)}\` | ${h.marker} | ${cell(h.note, 40)} |`;
  const rows = [...added.map((h) => line("+", h)), ...removed.map((h) => line("-", h))].join("\n");
  return [
    net > 0 ? `## ⚠️ todo-debt drift — net +${net} in this PR` : `## ✅ todo-debt — debt repaid (net ${net})`,
    ``,
    `| Δ | Location | Type | Note |`,
    `|---|---|---|---|`,
    rows,
    ``,
    net > 0
      ? `${added.length} added · ${removed.length} removed. Every marker line gets an author and a birthday from git blame — new debt deserves an expiry date or a \`ponytail:\` comment naming its trigger.`
      : `${added.length} added · ${removed.length} removed. The ratchet allows paying down while spending; net zero or better passes.`,
    `<!-- todo-debt-report -->`,
    ``,
  ].join("\n");
}

// ---------- GitHub REST client (the only network surface; --post only) ----------

export type Comment = { id: number; body: string };
export type Api = {
  listComments(pr: number): Promise<Comment[]>;
  postComment(pr: number, body: string): Promise<void>;
  updateComment(id: number, body: string): Promise<void>;
};

export function createApi(cfg: { repo: string; token?: string; baseUrl?: string; fetchImpl?: typeof fetch }): Api {
  const base = (cfg.baseUrl ?? "https://api.github.com").replace(/\/$/, "");
  // ponytail: one page of comments (100) searched for our marker — a PR with
  // >100 comments moves our report off page 1; update-in-place makes that rare.
  const call = async (path: string, init?: RequestInit): Promise<unknown> => {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
    const res = await (cfg.fetchImpl ?? fetch)(`${base}${path}`, { ...init, headers });
    if (!res.ok) {
      let detail = "";
      try { detail = ((await res.json()) as { message?: string }).message ?? ""; } catch { /* non-JSON error body */ }
      throw new Error(`GitHub API ${res.status} on ${path}${detail ? ` — ${detail}` : ""}`);
    }
    if (res.status === 204) return undefined;
    return res.json();
  };
  return {
    listComments: (pr) => call(`/repos/${cfg.repo}/issues/${pr}/comments?per_page=100`) as Promise<Comment[]>,
    postComment: (pr, body) => call(`/repos/${cfg.repo}/issues/${pr}/comments`, { method: "POST", body: JSON.stringify({ body }) }),
    updateComment: (id, body) => call(`/repos/${cfg.repo}/issues/comments/${id}`, { method: "PATCH", body: JSON.stringify({ body }) }),
  };
}

const MARKER = "<!-- todo-debt-report -->";

// ---------- orchestrator (world injected: git + read + clock, like day-01's probe) ----------

export type GitResult = { ok: boolean; stdout: string; stderr: string };
export type World = {
  git: (args: string[]) => GitResult; // args arrive WITHOUT -C root; the real one prepends it
  read: (rel: string) => string;      // may throw (unreadable file → skipped with a reason, day-03 lesson)
  now: () => Date;
  log: (s: string) => void;
  summary?: (md: string) => void;
};

export type RunOpts = { root: string; markers: string[]; base?: string; post?: boolean; pr?: number | null; repo?: string | null; api?: Api };

export async function run(opts: RunOpts, world: World): Promise<number> {
  const re = markerRegex(opts.markers);
  const inside = world.git(["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    world.log(`todo-debt: not a git repository: ${opts.root}`);
    return 2; // cannot check — must not read as "no debt" or as "drift found"
  }

  if (opts.base) {
    // validate the posting config before diffing — a misconfigured action must
    // fail fast as exit 2, not report drift (1) and then die half-delivered
    if (opts.post && (!opts.api || !opts.pr || !opts.repo)) {
      world.log("todo-debt: --post needs a PR number (--pr or GITHUB_REF=refs/pull/N/…) and GITHUB_TOKEN");
      return 2;
    }
    const d = world.git(["-c", "core.quotepath=false", "diff", "--unified=0", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", `${opts.base}...HEAD`]);
    // pinned flags: a user's color.diff=always made every line unparseable → net 0 → a false green
    if (!d.ok) {
      world.log(`todo-debt: cannot diff ${opts.base}...HEAD — ${firstLine(d.stderr) || "git failed"}`);
      return 2;
    }
    const { added, removed } = parseDiff(d.stdout, re);
    const net = netDebt(added.length, removed.length);
    world.log(`todo-debt drift — ${opts.base}...HEAD (${added.length} added · ${removed.length} removed · net ${net > 0 ? `+${net}` : net})`);
    for (const h of added) world.log(` + ${h.file}:${h.line}  ${h.marker}  ${h.note}`);
    for (const h of removed) world.log(` - ${h.file}:${h.line}  ${h.marker}  ${h.note}`);
    const verdict = net > 0 ? `net +${net} → this change adds debt → exit 1` : net < 0 ? `net ${net} → debt repaid → exit 0` : `net 0 → no debt movement → exit 0`;
    world.log(verdict);
    world.summary?.(driftMarkdown(added, removed));
    if (opts.post) {
      const pr = opts.pr!; // non-null guaranteed by the fail-fast check above
      const api = opts.api!;
      try {
        // one living report per PR: update our own comment if it exists, else post
        const ours = (await api.listComments(pr)).find((c) => c.body.includes(MARKER));
        const body = driftMarkdown(added, removed);
        if (ours) await api.updateComment(ours.id, body);
        else if (net > 0) await api.postComment(pr, body); // clean PRs get no comment — noise discipline
        world.log(`drift report ${ours ? "updated on" : net > 0 ? "posted to" : "not needed on"} PR #${pr}`);
      } catch (e) {
        world.log(`todo-debt: cannot post report — ${(e as Error).message}`);
        return 2;
      }
    }
    return exitCode(net);
  }

  // index mode — informational: existing debt never fails CI (that's how tools
  // get ignored); only the --base ratchet above exits 1 (day-04 lesson)
  const ls = world.git(["ls-files", "-z"]); // -z: raw paths — default output C-quotes ünicode/tab/quote names, which then fail to read
  if (!ls.ok) {
    world.log(`todo-debt: git ls-files failed — ${firstLine(ls.stderr) || "git failed"}`);
    return 2;
  }
  const now = world.now();
  const files = ls.stdout.split("\0").filter(Boolean);
  const rows: Row[] = [];
  let unblamable = 0;
  for (const f of files) {
    let content: string;
    try {
      content = world.read(f);
    } catch {
      unblamable++;
      continue; // unreadable (permissions, gone between ls-files and read) — skip with the count, never crash
    }
    const hits = scanText(content, re);
    if (!hits.length) continue;
    // ponytail: one blame spawn per file-WITH-hits, never per file scanned or per
    // hit — fine at every sane repo size; batch blame is the trigger if perf reports arrive
    const b = world.git(["blame", "--line-porcelain", "-w", "--", f]);
    const map = b.ok ? parseBlame(b.stdout) : null;
    if (!b.ok) unblamable++;
    for (const h of hits) {
      const { author, ageDays } = blameFields(map?.get(h.line), now);
      rows.push({ file: f, ...h, author, ageDays });
    }
  }
  rows.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1)); // oldest first — the whole point
  const mw = Math.max(...opts.markers.map((m) => m.length), 6); // "ponytail" needs its column too
  world.log(`todo-debt — ${opts.root} (markers: ${opts.markers.join(", ")} · ${files.length} tracked file(s))`);
  for (const r of rows) {
    world.log(` ${String(r.ageDays === null ? "—" : `${r.ageDays}d`).padStart(5)}  ${(r.author || "?").slice(0, 14).padEnd(14)} ${r.marker.padEnd(mw)} ${`${r.file}:${r.line}`.slice(0, 48).padEnd(48)} ${r.note.slice(0, 40)}`);
  }
  world.log(`\n ${rows.length} item(s) · ${new Set(rows.map((r) => r.file)).size} file(s)${rows.length ? ` · oldest ${age(rows[0].ageDays)}` : ""}${unblamable ? ` · ${unblamable} file(s) skipped or unblamable` : ""}`);
  world.summary?.(indexMarkdown(rows, files.length));
  return 0;
}

const firstLine = (s: string) => s.split("\n")[0]?.trim() ?? "";

// ---------- CLI ----------

function main(): void {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        markers: { type: "string" }, // comma-separated, default TODO,FIXME,HACK — e.g. --markers TODO,ponytail
        base: { type: "string" },    // ratchet mode: exit 1 if base...HEAD adds net-new markers
        post: { type: "boolean" },   // drift mode only: report as a PR comment (updated, not duplicated)
        pr: { type: "string" },      // PR number; default parsed from GITHUB_REF (refs/pull/N/…)
      },
    }));
  } catch (e) {
    // unknown flag / missing value is a usage error (2), not "debt found" (1)
    console.error(`todo-debt: ${(e as Error).message}\nrun with --help for usage`);
    process.exitCode = 2;
    return;
  }
  if (values.help) {
    console.log(`usage: todo-debt [path] [--markers a,b,c] [--base <ref>] [--post] [--pr N]
  default: index marker comments (TODO/FIXME/HACK) with author + age from git blame
  --base:  ratchet — exit 1 if <base>...HEAD adds net-new marker lines
  env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_REF, GITHUB_STEP_SUMMARY (Actions sets all)`);
    return;
  }
  const root = resolve(positionals[0] ?? ".");
  if (!existsSync(root)) {
    console.error(`todo-debt: path not found: ${root}`);
    process.exitCode = 2;
    return;
  }
  const markers = (values.markers ?? "TODO,FIXME,HACK").split(",").map((m) => m.trim()).filter(Boolean);
  if (!markers.length) {
    console.error(`todo-debt: --markers needs at least one marker, got "${values.markers}"`);
    process.exitCode = 2;
    return;
  }
  if (values.post && !values.base) {
    console.error("todo-debt: --post reports drift and needs --base <ref>");
    process.exitCode = 2;
    return;
  }
  const pr = values.pr ? Number(values.pr) : Number(process.env.GITHUB_REF?.match(/^refs\/pull\/(\d+)\//)?.[1] ?? NaN);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  run(
    {
      root,
      markers,
      base: values.base,
      post: !!values.post,
      pr: Number.isInteger(pr) && pr > 0 ? pr : null,
      repo: process.env.GITHUB_REPOSITORY ?? null,
      api: values.post && process.env.GITHUB_TOKEN ? createApi({ repo: process.env.GITHUB_REPOSITORY ?? "", token: process.env.GITHUB_TOKEN, baseUrl: process.env.GITHUB_API_URL }) : undefined,
    },
    {
      git: (args) => {
        const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
        return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
      },
      read: (rel) => readFileSync(resolve(root, rel), "utf8"),
      now: () => new Date(),
      log: (s) => console.log(s),
      summary: summaryPath ? (md) => appendFileSync(summaryPath, md + "\n") : undefined,
    },
  ).then(
    (code) => { process.exitCode = code; },
    (e) => { console.error(`todo-debt: unexpected failure — ${(e as Error).message}`); process.exitCode = 2; },
  );
}

// realpath: running through a symlink (npm bin / npx) must still trigger main()
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
