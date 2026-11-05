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

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

// ---------- types (world injected: git + clock + llm, day-05 idiom) ----------

export type GitResult = { ok: boolean; stdout: string; stderr: string };
export type LlmReq = { system: string; user: string };
export type World = {
  git: (args: string[]) => GitResult; // args arrive WITHOUT -C root; the real one prepends it
  now: () => Date;
  log: (s: string) => void;
  llm?: (req: LlmReq) => Promise<string>;
};

export type Commit = { author: string; email: string; ts: number; subject: string };

// One record per commit, prefixed with NUL (impossible inside a normal commit
// message), fields joined with \x1f (unit separator). The strict epoch check
// below is what catches field-shift corruption — an author containing \x1f
// makes the ts field non-numeric and the record counts as inert, not wrong.
// (No hash: the draft never shows one — a parsed-but-unused field is dead weight.)
const FIELD = "\x1f";
const LOG_FORMAT = `%x00%an${FIELD}%ae${FIELD}%at${FIELD}%s`;

// ponytail: --max-count=1000 fetch cap — a window older than the newest 1000
// commits is silently short; the run prints a note when the cap is hit.
// Upgrade: stream `git log` (line-by-line read) when a real repo reports the cap.
const MAX_FETCH = 1000;

// ---------- parsing ----------

export function parseLog(stdout: string): { commits: Commit[]; inert: number } {
  const commits: Commit[] = [];
  let inert = 0;
  for (const rec of stdout.split("\0")) {
    if (rec === "") continue; // the format's leading separator
    // git's `format:` prettiness separates RECORDS with \n (terminates only
    // between) — the \n rides on the end of every chunk except the last;
    // %s itself never contains a newline, so stripping one is exact
    const body = rec.endsWith("\n") ? rec.slice(0, -1) : rec;
    const f = body.split(FIELD);
    if (f.length !== 4 || !/^\d+$/.test(f[2])) { inert++; continue; }
    commits.push({ author: f[0], email: f[1], ts: Number(f[2]), subject: f[3] });
  }
  return { commits, inert };
}

// The "area" of a commit = the leading token it already carries: a
// conventional-commit scope (`fix(auth): …` → auth), a ticket key
// (`AUTH-12: …` → AUTH-12), or a bare prefix (`day-07: …` → day-07). A bare
// type with no scope (`fix: …`) names no area — the bullet is just the
// cleaned subject. Grouping reads the subject's own words; no extra git spawns.
const CONVENTIONAL = /^(?:feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(?:\(([^)]+)\))?!?:\s*/;
const TICKET = /^([A-Z][A-Z0-9]{1,9}-\d+)(?:[:\s]\s*)/;
const COLON = /^([A-Za-z][A-Za-z0-9._-]{0,20}):\s+/;

export function subjectArea(subject: string): string | null {
  const c = subject.match(CONVENTIONAL);
  if (c) return c[1] || null;
  const t = subject.match(TICKET);
  if (t) return t[1];
  const k = subject.match(COLON);
  if (k) return k[1];
  return null;
}

// strip the grouping token back off for the bullet body
export function cleanSubject(subject: string): string {
  const c = subject.match(CONVENTIONAL);
  if (c) return subject.slice(c[0].length).trim();
  const t = subject.match(TICKET);
  if (t) return subject.slice(t[0].length).trim();
  const k = subject.match(COLON);
  if (k) return subject.slice(k[0].length).trim();
  return subject.trim();
}

// Truncate on code-point (rune) boundaries — mid-rune cuts emit invalid UTF-8 (D06 F7).
export function clip(s: string, max: number): string {
  const runes = Array.from(s);
  if (runes.length <= max) return s;
  return runes.slice(0, max).join("") + "…";
}

// Never print parsed control characters raw (D06 F6). Tab and newline stay
// (whitespace); anything else becomes its Unicode control picture (U+2400
// block): visible, single-rune, and distinct from literal "\u0007" text an
// author may have typed — the picture can't be impersonated by the words (F11).
// Single-rune also means sanitize can never grow a string, so clip-after-
// sanitize can never cut an escape mid-sequence (F10 dies structurally).
export function sanitize(s: string): string {
  return s.replace(/[\x00-\x1F\x7F]/g, (c) => {
    const code = c.charCodeAt(0);
    if (code === 0x09 || code === 0x0A) return c;
    return String.fromCodePoint(code === 0x7F ? 0x2421 : 0x2400 + code);
  });
}

// ---------- windows (local-time math on the injected clock) ----------

// "2026-11-04" → LOCAL midnight. new Date("2026-11-04") would be UTC — the
// classic off-by-hours trap; parse date-only strings by hand.
export function parseSince(s: string): number | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const d = new Date(y, mo - 1, da);
    // reject calendar rollover (2026-13-40 must not silently become 2027)
    if (isNaN(d.getTime()) || d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
    return d.getTime();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

// --days N → local midnight of (today − N). days=1 → yesterday 00:00 → now.
export function windowStart(now: Date, days: number): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayMonth = (d: Date) => {
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${month} ${d.getDate()}`;
};
const localHM = (d: Date) => `${dayMonth(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

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
  const inside = world.git(["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    // the refusal reason must be TRUE: git missing, bare repo, and not-a-repo
    // are three different facts a user acts on differently (F6/F7)
    if (inside.stderr.startsWith("spawn failed")) {
      world.log(`standup-prep: git is not available — ${inside.stderr}`);
      return 2;
    }
    const bare = world.git(["rev-parse", "--is-bare-repository"]);
    if (bare.ok && bare.stdout.trim() === "true") {
      world.log(`standup-prep: bare repository has no work tree — standups are drafted from a checkout: ${opts.root}`);
      return 2;
    }
    world.log(`standup-prep: not a git repository: ${opts.root}`);
    return 2;
  }

  // resolve the author filter before any fetch — a filter we cannot satisfy
  // honestly must fail fast as 2, not silently return everyone's commits
  let meEmail: string | null = null;
  let meName: string | null = null;
  if (opts.me) {
    const email = world.git(["config", "--get", "user.email"]);
    const name = world.git(["config", "--get", "user.name"]);
    meEmail = email.ok && email.stdout.trim() ? email.stdout.trim() : null;
    meName = name.ok && name.stdout.trim() ? name.stdout.trim() : null;
    if (!meEmail && !meName) {
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

  // JS owns the window: git's --since filters on COMMITTER date, the standup
  // window keys off AUTHOR date (%at) — the seam decides, not git (D05).
  // %at is epoch SECONDS, getTime() is milliseconds — the unit seam decides
  // too. And the header claims "→ now", so the filter honors its own claim
  // (F4): future-dated commits are excluded and COUNTED, never mixed in.
  const startTs = start.getTime();
  const nowTs = now.getTime();
  let future = 0;
  let commits = all.filter((c) => {
    const ms = c.ts * 1000;
    if (ms < startTs) return false;
    if (ms > nowTs) { future++; return false; }
    return true;
  });

  // --me two-pass identity (F3): email is authoritative when it matches
  // anything — a collaborator sharing my display name (same name, different
  // email) must not enter my draft. Only when the email matches NOTHING (a
  // rebase rewrote every address) does the name do the filtering; the header
  // then names the identity that actually did the work.
  let me: string | null = null;
  if (opts.me) {
    const byEmail = meEmail ? commits.filter((c) => c.email === meEmail) : [];
    if (byEmail.length > 0) {
      commits = byEmail;
      me = meEmail;
    } else {
      // ponytail: identity is email-when-it-matches else name — a history MIXING
      // both (old email pre-rebase, new email post) loses the old side. Trigger:
      // a user report of missing own commits with both identities in one window.
      commits = commits.filter((c) => c.author === meName);
      me = meName;
    }
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
    git: (args: string[]) => {
      const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      // a spawn failure (git not installed, ENOENT) is a different fact from
      // git answering "not a repository" — mark it so the refusal is truthful (F7)
      if (r.error) return { ok: false, stdout: "", stderr: `spawn failed — ${(r.error as NodeJS.ErrnoException).code ?? r.error.message}` };
      return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    // pinned-clock knob: STANDUP_PREP_FAKE_NOW=<epoch seconds> reproduces a
    // demo byte-for-byte (README samples, self-check end-to-end). Any value
    // that isn't a sane epoch falls back to the real clock — same treatment
    // non-digit garbage already got, so a broken knob can't produce a broken
    // clock that then lies "no commits" (F8)
    now: () => {
      const f = process.env.STANDUP_PREP_FAKE_NOW;
      if (f && /^\d+$/.test(f)) {
        const d = new Date(Number(f) * 1000);
        if (!isNaN(d.getTime())) return d;
      }
      return new Date();
    },
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
