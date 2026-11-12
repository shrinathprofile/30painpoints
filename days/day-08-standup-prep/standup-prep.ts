#!/usr/bin/env node
// standup-prep — day 08 of the 30-day series.
// Reads a repo's recent commits and drafts the 30-second standup update you
// edit before the call. The complaint: composing the daily update is its own
// dread (r/ExperiencedDevs "Is this your situation too with daily standups?",
// 717 votes / 312 comments).
//
//   node standup-prep.ts [root] [--days N] [--since YYYY-MM-DD] [--me] [--llm]
//
// Exit trichotomy: 0 draft printed · 1 no commits in window (honest empty) ·
// 2 cannot check (not a repo / git failed / bad flags / LLM requested but
// undeliverable — never a silent fallback).
//
// Zero deps: node:util parseArgs, raw git spawn (day-05 World adapter),
// native TS type-stripping (Node >= 22.18). The LLM is plain fetch to an
// OpenAI-compatible endpoint, injected as a world function.
//
// day-11 extracted the parsing core verbatim into ../../packages/git-digest
// (the extraction this file's brief deferred to "day-11, the named first
// importer"). This file keeps the draft logic; the 41 checks in self-check.ts
// — unchanged — now pin the package through this import.

import { parseArgs } from "node:util";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  type Commit,
  type GitResult,
  type World as GitWorld,
  LOG_FORMAT,
  MAX_FETCH,
  clip,
  cleanSubject,
  envClock,
  filterMine,
  localDate,
  localHM,
  makeGit,
  parseLog,
  parseSince,
  probeRepo,
  readIdentity,
  sanitize,
  subjectArea,
  windowFilter,
  windowStart,
} from "../../packages/git-digest/git-digest.ts";

// re-exported: self-check.ts imports these from THIS file, as it always has
export { clip, cleanSubject, parseLog, parseSince, sanitize, subjectArea, windowStart, type GitResult } from "../../packages/git-digest/git-digest.ts";

// ---------- the day-08 world: git + clock + log (package) + llm (here) ----------

export type LlmReq = { system: string; user: string };
export type World = GitWorld & { llm?: (req: LlmReq) => Promise<string> };

// ---------- the draft ----------

type Bullet = { area: string | null; headline: string; ts: number; n: number };

export function draftBullets(commits: Commit[]): Bullet[] {
  // the headline falls back to the WHOLE subject before "(no message)": a
  // swallowed token ("feat(scope):" cleans to "") still had words — claiming
  // the commit had no message would be a lie (F12)
  const headline = (s: string) => cleanSubject(s) || s.trim() || "(no message)";
  const groups = new Map<string, { newest: Commit; n: number; ts: number }>();
  const singles: { c: Commit; n: number }[] = [];
  for (const c of commits) {
    const area = subjectArea(c.subject);
    if (area) {
      const g = groups.get(area);
      if (g) { g.n++; if (c.ts > g.ts) { g.newest = c; g.ts = c.ts; } }
      else groups.set(area, { newest: c, n: 1, ts: c.ts });
    } else {
      singles.push({ c, n: 1 });
    }
  }
  const bullets: Bullet[] = [
    ...[...groups.values()].map((g) => ({ area: subjectArea(g.newest.subject), headline: headline(g.newest.subject), ts: g.ts, n: g.n })),
    ...singles.map((s) => ({ area: null, headline: headline(s.c.subject), ts: s.c.ts, n: s.n })),
  ];
  return bullets.sort((a, b) => b.ts - a.ts); // newest work first — a standup leads with the freshest
}

export function renderDraft(commits: Commit[], now: Date, start: Date, me: string | null): string {
  const lines: string[] = [];
  const who = me ? ` by ${me}` : "";
  const n = commits.length;
  lines.push(`standup draft — ${localDate(now)} (window ${localHM(start)} → ${localHM(now)} · ${n} commit${n === 1 ? "" : "s"}${who})`);
  lines.push("");
  for (const b of draftBullets(commits)) {
    const label = b.area ? `${b.area} — ` : "";
    const count = b.n > 1 ? ` (${b.n} commits)` : "";
    lines.push(`- ${label}${clip(sanitize(b.headline), 90)}${count}`);
  }
  lines.push("");
  lines.push("git proves the done-list; today's plan and blockers are yours to say.");
  return lines.join("\n");
}

// ---------- orchestrator ----------

export type RunOpts = { root: string; days: number; since?: string; me: boolean; llm: boolean };

export async function run(opts: RunOpts, world: World): Promise<number> {
  // the refusal reason must be TRUE: git missing, bare repo, and not-a-repo
  // are three different facts a user acts on differently (F6/F7)
  const refusal = probeRepo(world, opts.root);
  if (refusal) {
    world.log(`standup-prep: ${refusal}`);
    return 2;
  }

  // resolve the author filter before any fetch — a filter we cannot satisfy
  // honestly must fail fast as 2, not silently return everyone's commits
  let identity: { email: string | null; name: string | null } | null = null;
  if (opts.me) {
    identity = readIdentity(world);
    if (!identity.email && !identity.name) {
      world.log("standup-prep: --me has nothing to match — set user.email or user.name in this repo's git config");
      return 2;
    }
  }

  const now = world.now();
  // --since re-parses through the SHARED parser: raw new Date("2026-11-03")
  // is UTC midnight, not the documented local midnight — the trap this date
  // format exists to avoid. main() pre-validated, but the seam re-checks.
  let start: Date;
  if (opts.since) {
    const sinceTs = parseSince(opts.since);
    if (sinceTs === null) {
      world.log(`standup-prep: --since is not a usable date: ${opts.since}`);
      return 2;
    }
    start = new Date(sinceTs);
  } else {
    start = windowStart(now, opts.days);
  }
  if (start.getTime() > now.getTime()) {
    world.log(`standup-prep: window starts in the future (${opts.since})`);
    return 2;
  }

  const lg = world.git(["log", "--no-color", "--no-merges", `--max-count=${MAX_FETCH}`, "--pretty=format:" + LOG_FORMAT]);
  if (!lg.ok) {
    world.log(`standup-prep: git log failed — ${firstLine(lg.stderr) || "git failed"}`);
    return 2;
  }
  const { commits: all, inert } = parseLog(lg.stdout);

  // JS owns the window (author date, epoch seconds → ms, future-dated
  // excluded and counted — D05/D08, now windowFilter in the package)
  let { commits, future } = windowFilter(all, start, now);

  // --me two-pass identity (F3, now filterMine in the package): email is
  // authoritative when it matches anything; the header names the identity
  // that actually did the work
  let me: string | null = null;
  if (identity) {
    const mine = filterMine(commits, identity);
    commits = mine.commits;
    me = mine.identity;
  }
  commits.sort((a, b) => a.ts - b.ts); // chronological inside the run; the draft re-sorts newest-first

  // notes about the FETCH come before any verdict — an honest-empty exit 1
  // must not swallow them (F2), and the cap note counts FETCHED records,
  // parsed + inert, not the parsed slice alone (F5)
  if (inert > 0) world.log(`(${inert} unparseable log record${inert === 1 ? "" : "s"} skipped — shown here, never guessed at)`);
  if (all.length + inert >= MAX_FETCH) world.log(`(fetch cap ${MAX_FETCH} hit — older commits in the window may be missing)`);
  if (future > 0) world.log(`(${future} commit${future === 1 ? "" : "s"} dated after now excluded — clock skew or rewritten dates)`);

  if (commits.length === 0) {
    const who = me ? ` by ${me}` : "";
    world.log(`standup-prep: no commits${who} in ${localHM(start)} → ${localHM(now)} (merges excluded) — nothing to draft, exit 1`);
    return 1;
  }
  world.log(renderDraft(commits, now, start, me));

  if (!opts.llm) return 0;

  // the LLM polishes; it never invents. The base draft is already printed —
  // a failed polish loses nothing and names itself (exit 2, no silent fallback)
  if (!world.llm) {
    world.log("standup-prep: --llm requested but no LLM is wired into this run");
    return 2;
  }
  const subjects = commits
    .slice()
    .reverse()
    .map((c) => `- ${sanitize(clip(c.subject, 120))}`)
    .join("\n");
  const bullets = draftBullets(commits)
    .map((b) => `- ${b.area ? `${b.area} — ` : ""}${sanitize(b.headline)}`)
    .join("\n");
  try {
    const polished = await world.llm({
      system:
        "You edit a standup update draft. Keep every fact in the bullets. Never invent or add work that is not listed. " +
        "Never drop a ticket or area label. Output ONLY the polished update text — no preamble, no markdown headings.",
      user:
        `Commit subjects (newest first):\n${subjects}\n\nDraft bullets:\n${bullets}\n\n` +
        `Polish these bullets into a natural 30-second spoken standup update. Under 120 words.`,
    });
    const text = polished.trim();
    if (!text) throw new Error("LLM returned no usable text");
    world.log("");
    world.log("— tone pass (LLM, verify every line is work you actually did) —");
    // LLM output is untrusted text at a trust boundary: the commit path
    // displays control chars as pictures, the LLM path must meet the same
    // bar — a hostile endpoint can't repaint the terminal (F9). Newlines
    // survive (paragraphs are wanted); ESC/CR/BEL become visible pictures.
    world.log(sanitize(text));
    return 0;
  } catch (e) {
    world.log(`standup-prep: tone pass failed — ${(e as Error).message} (the base draft above stands, exit 2)`);
    return 2;
  }
}

const firstLine = (s: string) => s.split("\n")[0].trim();

// ---------- CLI ----------

const USAGE = `standup-prep — draft your standup from git. Usage:
  node standup-prep.ts [root] [--days N] [--since YYYY-MM-DD] [--me] [--llm]
  --days N    window = local midnight N days back (default 1 = yesterday 00:00 → now)
  --since D   window starts at this local date ("2026-11-04") or ISO datetime (overrides --days)
  --me        only your commits (matches git config user.email / user.name)
  --llm       one tone pass via an OpenAI-compatible endpoint:
                STANDUP_LLM_KEY or OPENAI_API_KEY   (required)
                STANDUP_LLM_URL (full endpoint) or OPENAI_BASE_URL (api root)
                STANDUP_LLM_MODEL (default: gpt-4o-mini)
Exits: 0 draft · 1 no commits in window · 2 cannot check.`;

function makeRealWorld(root: string, llm?: (req: LlmReq) => Promise<string>): World {
  return {
    git: makeGit(root),
    // pinned-clock knob (package envClock): STANDUP_PREP_FAKE_NOW=<epoch seconds>
    // reproduces a demo byte-for-byte — the env NAME is this tool's only choice
    now: envClock("STANDUP_PREP_FAKE_NOW"),
    log: (s: string) => console.log(s),
    llm,
  };
}

// one attempt, 15s timeout, no retries — a standup draft is not worth a retry loop
function makeRealLlm(cfg: { url: string; key: string; model: string }): (req: LlmReq) => Promise<string> {
  return async ({ system, user }: LlmReq) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15_000);
    try {
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: cfg.model, temperature: 0.3, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${cfg.url}`);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? "";
    } finally {
      clearTimeout(timer);
    }
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
        llm: { type: "boolean" },
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
      console.log("standup-prep: --days wants 1–30\n");
      console.log(USAGE);
      return 2;
    }
    days = Number(values.days);
  }
  let since: string | undefined;
  if (values.since !== undefined) {
    const ts = parseSince(values.since);
    if (ts === null) {
      console.log("standup-prep: --since wants YYYY-MM-DD or an ISO datetime\n");
      console.log(USAGE);
      return 2;
    }
    since = values.since; // passed through; run() re-parses via the same rules
  }

  let llm: ((req: LlmReq) => Promise<string>) | undefined;
  if (values.llm) {
    const env = process.env;
    const key = env.STANDUP_LLM_KEY ?? env.OPENAI_API_KEY;
    // fail fast BEFORE any git work: an undeliverable --llm must not half-run (day-05 posting-config rule)
    if (!key) {
      console.log("standup-prep: --llm needs STANDUP_LLM_KEY or OPENAI_API_KEY in the environment\n" +
        "(other providers: STANDUP_LLM_URL for the full endpoint, or OPENAI_BASE_URL for the api root; STANDUP_LLM_MODEL, default gpt-4o-mini)");
      return 2;
    }
    const url = env.STANDUP_LLM_URL
      ?? (env.OPENAI_BASE_URL ? env.OPENAI_BASE_URL.replace(/\/+$/, "") + "/chat/completions" : "https://api.openai.com/v1/chat/completions");
    const model = env.STANDUP_LLM_MODEL ?? "gpt-4o-mini";
    llm = makeRealLlm({ url, key, model });
  }

  return run({ root, days, since, me: values.me === true, llm: values.llm === true }, makeRealWorld(root, llm));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((e) => { console.error(`standup-prep: unexpected failure — ${(e as Error).message}`); process.exitCode = 2; });
}
