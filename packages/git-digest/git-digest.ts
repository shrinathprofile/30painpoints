// git-digest — the series' shared git-log porcelain kernel.
//
// Extracted VERBATIM from day-08's standup-prep.ts on day-11 (the extraction
// day-08's brief named "day-11, the named first importer"). Day-08's 41-check
// self-check pins this file's behavior byte-for-byte — run
// days/day-08-standup-prep/self-check.ts after ANY change here.
//
// What lives here: parsing git log's porcelain format into typed records,
// author-date window math, identity filtering, display safety (control
// pictures, rune-boundary clips), and the real-world adapters (git spawn,
// pinned clock). What does NOT: anything LLM, anything per-tool rendering.
//
// Importers: day-08 (standup-prep), day-11 (proof-report).

import { spawnSync } from "node:child_process";

// ---------- types (world injected: git + clock, day-05 idiom) ----------

export type GitResult = { ok: boolean; stdout: string; stderr: string };
export type World = {
  git: (args: string[]) => GitResult; // args arrive WITHOUT -C root; the real one prepends it
  now: () => Date;
  log: (s: string) => void;
};

export type Commit = { author: string; email: string; ts: number; subject: string };

// One record per commit, prefixed with NUL (impossible inside a normal commit
// message), fields joined with \x1f (unit separator). The strict epoch check
// below is what catches field-shift corruption — an author containing \x1f
// makes the ts field non-numeric and the record counts as inert, not wrong.
// (No hash: day-08's draft never shows one — a parsed-but-unused field is dead weight.)
const FIELD = "\x1f";
export const LOG_FORMAT = `%x00%an${FIELD}%ae${FIELD}%at${FIELD}%s`;

// ponytail: --max-count=1000 fetch cap — a window older than the newest 1000
// commits is silently short; the run prints a note when the cap is hit.
// Upgrade: stream `git log` (line-by-line read) when a real repo reports the cap.
export const MAX_FETCH = 1000;

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

// Hand-rolled formatters, not Intl: day-08's byte-stable-output contract
// (D08's determinism call — pin locales wherever output must reproduce).
const pad = (n: number) => String(n).padStart(2, "0");
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayMonth = (d: Date) => {
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${month} ${d.getDate()}`;
};
export const localHM = (d: Date) => `${dayMonth(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

// ---------- run()-shaped seams (lifted from day-08's run() on day-11;
// day-08's checks pin each behavior) ----------

// The truthful repo refusal (D08 F6/F7): git-missing ≠ not-a-repo ≠ bare ≠
// no-such-path are four different facts a user acts on differently. Returns
// the reason a run must print, or null when the repo is workable.
export function probeRepo(world: World, root: string): string | null {
  const inside = world.git(["rev-parse", "--is-inside-work-tree"]);
  if (inside.ok && inside.stdout.trim() === "true") return null;
  if (inside.stderr.startsWith("spawn failed")) {
    return `git is not available — ${inside.stderr}`;
  }
  // D11 F2 (adversarial): a nonexistent/inaccessible root is NOT "not a
  // repository" — git says "fatal: cannot change to '<path>'", and the user
  // acts differently on a typo'd path than on a non-repo.
  // ponytail: matched on git's stderr WORDING — stable for years, but a git
  // that rewords it falls back to the not-a-repo reason (still exit 2).
  // Trigger: a git release whose message differs.
  if (/cannot change to/.test(inside.stderr)) {
    return `cannot access ${root} — ${inside.stderr.split("\n")[0].trim()}`;
  }
  const bare = world.git(["rev-parse", "--is-bare-repository"]);
  if (bare.ok && bare.stdout.trim() === "true") {
    return `bare repository has no work tree — digests are drafted from a checkout: ${root}`;
  }
  return `not a git repository: ${root}`;
}

// git config identity reads; either side may be absent.
export function readIdentity(world: World): { email: string | null; name: string | null } {
  const email = world.git(["config", "--get", "user.email"]);
  const name = world.git(["config", "--get", "user.name"]);
  return {
    email: email.ok && email.stdout.trim() ? email.stdout.trim() : null,
    name: name.ok && name.stdout.trim() ? name.stdout.trim() : null,
  };
}

// --me two-pass identity (D08 F3): email is authoritative when it matches
// anything — a collaborator sharing my display name (same name, different
// email) must not enter my digest. Only when the email matches NOTHING (a
// rebase rewrote every address) does the name do the filtering; the header
// then names the identity that actually did the work.
export function filterMine(commits: Commit[], id: { email: string | null; name: string | null }): { commits: Commit[]; identity: string | null } {
  const byEmail = id.email ? commits.filter((c) => c.email === id.email) : [];
  if (byEmail.length > 0) return { commits: byEmail, identity: id.email };
  // D11 F3 (adversarial): when no email matches and NO name is configured,
  // the searched email — not null — is the identity the header should name;
  // "no commits" that hides which filter ran reads as unfiltered.
  const byName = id.name ? commits.filter((c) => c.author === id.name) : [];
  return { commits: byName, identity: id.name ?? id.email };
  // ponytail (carried from day-08): identity is email-when-it-matches else
  // name — a history MIXING both (old email pre-rebase, new email post)
  // loses the old-email side. Trigger: a user report of missing own commits
  // with both identities in one window.
}

// JS owns the window: git's --since filters on COMMITTER date, day windows
// key off AUTHOR date (%at) — the seam decides, not git (D05). %at is epoch
// SECONDS, getTime() is milliseconds — the seam decides that too (D08). And a
// header claiming "→ now" honors its own claim (D08 F4): future-dated commits
// are excluded and COUNTED, never mixed into a false window.
export function windowFilter(commits: Commit[], start: Date, now: Date): { commits: Commit[]; future: number } {
  const startTs = start.getTime();
  const nowTs = now.getTime();
  const kept: Commit[] = [];
  let future = 0;
  for (const c of commits) {
    const ms = c.ts * 1000;
    if (ms < startTs) continue;
    if (ms > nowTs) { future++; continue; }
    kept.push(c);
  }
  return { commits: kept, future };
}

// ---------- real-world adapters ----------

// The git spawn: -C root, output capped, and a spawn failure (git not
// installed, ENOENT) marked as a different fact from git answering "not a
// repository" — so refusals stay truthful (D08 F7).
export function makeGit(root: string): (args: string[]) => GitResult {
  return (args: string[]) => {
    const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    if (r.error) return { ok: false, stdout: "", stderr: `spawn failed — ${(r.error as NodeJS.ErrnoException).code ?? r.error.message}` };
    return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
}

// pinned-clock knob: <envVar>=<epoch seconds> reproduces a demo byte-for-byte
// (README samples, self-check end-to-end). Any value that isn't a sane epoch
// falls back to the real clock — a broken knob can't produce a broken clock
// that then lies "no commits" (D08 F8).
export function envClock(envVar: string): () => Date {
  return () => {
    const f = process.env[envVar];
    if (f && /^\d+$/.test(f)) {
      const d = new Date(Number(f) * 1000);
      if (!isNaN(d.getTime())) return d;
    }
    return new Date();
  };
}
