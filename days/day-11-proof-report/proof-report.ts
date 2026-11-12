#!/usr/bin/env node
// proof-report — day 11 of the 30-day series.
// Compiles a repo's recent commits into a shareable daily proof-of-work
// report: every commit a receipt with a short hash, headline stats, tickets
// and areas — the counter-argument to presence surveillance. The complaint:
// "My company tracks whether you open Slack within 15 minutes of start"
// (r/remotework, 8.8K upvotes / 479 comments). Output, not online-status.
//
//   node proof-report.ts [root] [--days N] [--since YYYY-MM-DD] [--me]
//
// Exit trichotomy: 0 report printed · 1 no commits in window (honest empty) ·
// 2 cannot check (not a repo / git failed / bad flags).
//
// Zero deps. The second importer of packages/git-digest (day-08 is the
// first) — window math, identity, refusal truthfulness, and display safety
// all come from the package; only the hash+numstat porcelain (a different
// record shape) lives here, with its only consumer.

import { realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  type Commit,
  type World,
  MAX_FETCH,
  clip,
  envClock,
  filterMine,
  localDate,
  localHM,
  makeGit,
  parseSince,
  probeRepo,
  readIdentity,
  sanitize,
  subjectArea,
  windowFilter,
  windowStart,
} from "../../packages/git-digest/git-digest.ts";

// ---------- the hash+numstat porcelain (day-11's own record shape) ----------
//
// Same discipline as the package's parseLog: NUL-prefixed records (impossible
// inside a commit message), \x1f-joined fields, strict-shape-or-inert. The
// numstat block rides AFTER the header line — one `ins\tdel\tpath` line per
// file, blank line before the next record, `-` for binary files, exotic
// paths C-quoted by git (quoted tabs are two characters, so the 3-field
// shape holds). Strict header checks (ts digits, hash hex) are what catch
// field-shift corruption — a shifted record counts as inert, never guessed.
const FIELD = "\x1f";
const DETAILED_FORMAT = `%x00%H${FIELD}%an${FIELD}%ae${FIELD}%at${FIELD}%s`;

export type Stat = { ins: number; del: number; path: string }; // binary: ins/del 0, file still counts
export type Detailed = Commit & { hash: string; stats: Stat[] };

// git C-quotes any path with non-ASCII or special characters (`café.md` →
// `"caf\303\251.md"`, a tab → `"a\tb.md"`); testing suffixes or deduping on
// the QUOTED form counts a doc file as none (D11 F1, adversarial — found by
// execution on real non-ASCII filenames, missed by every ASCII fixture).
// Decodes the escape forms git emits (\\ \" \a \b \f \n \r \t \v \NNN octal)
// back to bytes → UTF-8. Malformed sequences decode to replacement chars —
// fine here: paths feed suffix tests and Set keys, never re-encoding.
// ponytail: non-fatal UTF-8 decode (U+FFFD on malformed bytes). Ceiling:
// counting/display only. Trigger: a need for byte-exact recovered paths.
function dequotePath(p: string): string {
  if (p.length < 2 || !p.startsWith('"') || !p.endsWith('"')) return p;
  const s = p.slice(1, -1);
  const bytes: number[] = [];
  const SIMPLE: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, '"': 34 };
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c !== "\\") {
      for (const b of Buffer.from(c, "utf8")) bytes.push(b); // literal char → its UTF-8 bytes
      i++;
      continue;
    }
    const n = s[i + 1] ?? "";
    if (n >= "0" && n <= "7") {
      bytes.push(parseInt(s.slice(i + 1, i + 4), 8)); // \NNN octal byte
      i += 4;
      continue;
    }
    if (SIMPLE[n] !== undefined) {
      bytes.push(SIMPLE[n]);
      i += 2;
      continue;
    }
    for (const b of Buffer.from(n, "utf8")) bytes.push(b); // unknown escape kept literally
    i += 2;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes));
}

export function parseDetailed(stdout: string): { commits: Detailed[]; inert: number; badStat: number } {
  const commits: Detailed[] = [];
  let inert = 0;
  let badStat = 0;
  for (const rec of stdout.split("\0")) {
    if (rec === "") continue; // the format's leading separator
    const lines = rec.split("\n");
    const f = lines[0].split(FIELD);
    // hash: 40-hex (SHA-1) or 64-hex (SHA-256 repos) — anything else is a shifted record
    if (f.length !== 5 || !/^\d+$/.test(f[3]) || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(f[0])) { inert++; continue; }
    const stats: Stat[] = [];
    for (const line of lines.slice(1)) {
      if (line === "") continue; // record terminator / trailing newline — both endings parse
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) { badStat++; continue; }
      stats.push({ ins: m[1] === "-" ? 0 : Number(m[1]), del: m[2] === "-" ? 0 : Number(m[2]), path: dequotePath(m[3]) });
    }
    commits.push({ hash: f[0], author: f[1], email: f[2], ts: Number(f[3]), subject: f[4], stats });
  }
  return { commits, inert, badStat };
}

// ---------- aggregation ----------

export function tally(commits: Detailed[]): { ins: number; del: number; files: number; docs: number } {
  let ins = 0;
  let del = 0;
  const paths = new Set<string>();
  const docs = new Set<string>();
  for (const c of commits) {
    for (const s of c.stats) {
      ins += s.ins;
      del += s.del;
      paths.add(s.path);
      // ponytail: docs = unique .md-suffixed paths — .mdx/rst/adoc don't count.
      // Trigger: a repo whose docs live in another suffix and a user who says so.
      if (s.path.endsWith(".md")) docs.add(s.path);
    }
  }
  return { ins, del, files: paths.size, docs: docs.size };
}

// tickets harvested ANYWHERE in the subject — unlike the package's leading
// TICKET match (which keys areas), "fix: handle AUTH-12 retry" still carries
// a ticket worth listing. Same key shape as the package's, global scan.
export function harvestTickets(commits: Detailed[]): string[] {
  const keys = new Set<string>();
  const re = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;
  for (const c of commits) for (const m of c.subject.matchAll(re)) keys.add(m[1]);
  return [...keys].sort(); // codepoint order — byte-stable, no locale (D08)
}

// area tally via the package's subjectArea; deterministic order: count desc,
// then label asc, "unlabeled" forced last (sentinel, not localeCompare).
export function tallyAreas(commits: Detailed[]): { area: string | null; n: number }[] {
  const m = new Map<string | null, number>();
  for (const c of commits) m.set(subjectArea(c.subject), (m.get(subjectArea(c.subject)) ?? 0) + 1);
  const label = (a: string | null) => a ?? "\uffff";
  return [...m.entries()]
    .map(([area, n]) => ({ area, n }))
    .sort((x, y) => y.n - x.n || (label(x.area) < label(y.area) ? -1 : label(x.area) > label(y.area) ? 1 : 0));
}

// ---------- the report ----------

export function renderReport(commits: Detailed[], now: Date, start: Date, me: string | null): string {
  const ordered = commits.slice().sort((a, b) => b.ts - a.ts); // newest first — chosen, not inherited (D02)
  const n = ordered.length;
  const plural = n === 1 ? "" : "s";
  const who = me ? ` by ${me}` : "";
  const t = tally(ordered);

  // the landing span is WHEN WORK LANDED (first → last commit timestamp) —
  // never hours-at-desk. This tool answers presence surveillance; it must
  // not smuggle presence back in as a span-shaped hours claim.
  // D11 F4 (adversarial): equal first/last timestamps collapse to one time —
  // an arrow pointing at itself says nothing.
  // ponytail: minute precision (localHM drops seconds) — a sub-minute span
  // renders as one time. Ceiling: cosmetic. Trigger: a user who schedules.
  const first = new Date(Math.min(...ordered.map((c) => c.ts)) * 1000);
  const last = new Date(Math.max(...ordered.map((c) => c.ts)) * 1000);
  const span = first.getTime() === last.getTime() ? `landed ${localHM(last)}` : `landed ${localHM(first)} → ${localHM(last)}`;

  const lines: string[] = [];
  lines.push(`proof of work — ${localDate(now)} (window ${localHM(start)} → ${localHM(now)} · ${n} commit${plural}${who})`);
  lines.push("");
  lines.push(`**${n} commit${plural} · ${t.files} file${t.files === 1 ? "" : "s"} · +${t.ins} −${t.del}${t.docs > 0 ? ` · ${t.docs} doc${t.docs === 1 ? "" : "s"}` : ""}** · ${span}`);
  lines.push("");
  // receipts are VERBATIM subjects — a receipt the tool edited is a weaker
  // receipt (day-08 cleans tokens for a spoken draft; this is the other tool)
  for (const c of ordered) {
    const subject = c.subject.trim() ? clip(sanitize(c.subject), 100) : "(no message)";
    lines.push(`- \`${c.hash.slice(0, 7)}\` ${subject}`);
  }
  lines.push("");
  lines.push(`**areas:** ${tallyAreas(ordered).map((a) => `${a.area ?? "unlabeled"} ×${a.n}`).join(" · ")}`);
  const tickets = harvestTickets(ordered);
  if (tickets.length > 0) lines.push(`**ticket${tickets.length === 1 ? "" : "s"}:** ${tickets.join(" · ")}`);
  lines.push("");
  lines.push("every line is one `git show <hash>` away — output, not online-status.");
  return lines.join("\n");
}

// ---------- orchestrator ----------

export type RunOpts = { root: string; days: number; since?: string; me: boolean };

export async function run(opts: RunOpts, world: World): Promise<number> {
  const refusal = probeRepo(world, opts.root);
  if (refusal) {
    world.log(`proof-report: ${refusal}`);
    return 2;
  }

  // resolve the author filter before any fetch — a filter we cannot satisfy
  // honestly must fail fast as 2 (day-08 rule)
  let identity: { email: string | null; name: string | null } | null = null;
  if (opts.me) {
    identity = readIdentity(world);
    if (!identity.email && !identity.name) {
      world.log("proof-report: --me has nothing to match — set user.email or user.name in this repo's git config");
      return 2;
    }
  }

  const now = world.now();
  let start: Date;
  if (opts.since) {
    const sinceTs = parseSince(opts.since);
    if (sinceTs === null) {
      world.log(`proof-report: --since is not a usable date: ${opts.since}`);
      return 2;
    }
    start = new Date(sinceTs);
  } else {
    start = windowStart(now, opts.days);
  }
  if (start.getTime() > now.getTime()) {
    world.log(`proof-report: window starts in the future (${opts.since})`);
    return 2;
  }

  const lg = world.git(["log", "--no-color", "--no-merges", `--max-count=${MAX_FETCH}`, "--pretty=format:" + DETAILED_FORMAT, "--numstat"]);
  if (!lg.ok) {
    world.log(`proof-report: git log failed — ${lg.stderr.split("\n")[0].trim() || "git failed"}`);
    return 2;
  }
  const { commits: all, inert, badStat } = parseDetailed(lg.stdout);

  let { commits, future } = windowFilter(all, start, now);
  let me: string | null = null;
  if (identity) {
    const mine = filterMine(commits, identity);
    commits = mine.commits;
    me = mine.identity;
  }

  // notes about the FETCH come before any verdict — an honest-empty exit 1
  // must not swallow them (day-08 F2), and the cap note counts FETCHED
  // records, parsed + inert, not the parsed slice alone (F5)
  if (inert > 0) world.log(`(${inert} unparseable log record${inert === 1 ? "" : "s"} skipped — shown here, never guessed at)`);
  if (badStat > 0) world.log(`(${badStat} unparseable numstat line${badStat === 1 ? "" : "s"} skipped — counts stay honest, lines are never guessed)`);
  if (all.length + inert >= MAX_FETCH) world.log(`(fetch cap ${MAX_FETCH} hit — older commits in the window may be missing)`);
  if (future > 0) world.log(`(${future} commit${future === 1 ? "" : "s"} dated after now excluded — clock skew or rewritten dates)`);

  if (commits.length === 0) {
    const who = me ? ` by ${me}` : "";
    world.log(`proof-report: no commits${who} in ${localHM(start)} → ${localHM(now)} (merges excluded) — no output to report is an honest sentence, not a failed one, exit 1`);
    return 1;
  }
  world.log(renderReport(commits, now, start, me));
  return 0;
}

// ---------- CLI ----------

const USAGE = `proof-report — your day's output as receipts, from git. Usage:
  node proof-report.ts [root] [--days N] [--since YYYY-MM-DD] [--me]
  --days N    window = local midnight N days back (default 1 = yesterday 00:00 → now)
  --since D   window starts at this local date ("2026-11-04") or ISO datetime (overrides --days)
  --me        only your commits (matches git config user.email / user.name)
Prints Markdown: one receipt line per commit (short hash + verbatim subject),
headline stats (+/− lines, files, docs), areas, tickets.
Exits: 0 report · 1 no commits in window · 2 cannot check.`;

function makeRealWorld(root: string): World {
  return {
    git: makeGit(root),
    // pinned-clock knob (package envClock): PROOF_REPORT_FAKE_NOW=<epoch seconds>
    now: envClock("PROOF_REPORT_FAKE_NOW"),
    log: (s: string) => console.log(s),
  };
}

async function main(): Promise<number> {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        days: { type: "string" },
        since: { type: "string" },
        me: { type: "boolean" },
      },
    }));
  } catch (e) {
    console.log(USAGE);
    return 2;
  }
  if (positionals.length > 1) {
    console.log(USAGE);
    return 2;
  }
  const root = positionals[0] ?? ".";
  let days = 1;
  if (values.days !== undefined) {
    if (!/^\d+$/.test(values.days) || Number(values.days) < 1 || Number(values.days) > 30) {
      console.log("proof-report: --days wants 1–30\n");
      console.log(USAGE);
      return 2;
    }
    days = Number(values.days);
  }
  let since: string | undefined;
  if (values.since !== undefined) {
    if (parseSince(values.since) === null) {
      console.log("proof-report: --since wants YYYY-MM-DD or an ISO datetime\n");
      console.log(USAGE);
      return 2;
    }
    since = values.since; // passed through; run() re-parses via the same rules
  }

  return run({ root, days, since, me: values.me === true }, makeRealWorld(root));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((e) => { console.error(`proof-report: unexpected failure — ${(e as Error).message}`); process.exitCode = 2; });
}
