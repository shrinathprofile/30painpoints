#!/usr/bin/env python3
"""remote-job-radar — day 31 (bonus): one command asks every free public jobs
feed on the remote-companies list, keeps roles workable from India, and shows
only what's new since the last run.

Sources: the greenhouse/lever/ashby/eightfold slugs in companies.csv (56 of
123 rows today) plus three boards — RemoteOK, Remotive, Himalayas. Every
source gets a receipt line (ok N / failed: reason / no feed); a quiet list
must never read as "nothing new". Location verdicts: open · unclear (kept,
labelled — never guessed into open) · closed (dropped, counted).

Exit codes (series convention): 0 new matches · 1 ran clean, nothing new ·
2 cannot check (no profile.json, unreadable companies.csv, bad flags, every
source failed).

Stdlib only. profile.json is gitignored — copy profile.example.json first.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import csv
import json
import re
import sqlite3
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

DAY = Path(__file__).resolve().parent
TIMEOUT = 10   # seconds per request — one slow source is that source's receipt line, never a hang
WORKERS = 16
CLIP = 80      # runes; titles/locations are third-party text (D08/D10 display safety)
UA = "remote-job-radar/1.0 (personal CLI; links out to source boards, republishes nothing)"

# ats vendor -> URL template. eightfold's slug is "api-domain|company-domain".
FEED_URL = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{}/jobs",
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{}",
    "lever": "https://api.lever.co/v0/postings/{}?mode=json",
    "eightfold": "https://{}/api/apply/v2/jobs?domain={}&start=0&num=100",
}
BOARDS = {
    "remoteok": "https://remoteok.com/api",
    "remotive": "https://remotive.com/api/remote-jobs",
    # ponytail: first page only (20 jobs) per run — cursor pagination when a day's new postings overflow a page
    "himalayas": "https://himalayas.app/jobs/api?limit=100",
}


class ShapeError(ValueError):
    """Feed parsed 200-OK JSON of the wrong shape — named per source, exit stays per-run."""


# ---------- display safety (D08/D10 idiom: third-party text hits the terminal) ----------

class _Strip(HTMLParser):
    def __init__(self):
        super().__init__()
        self.out: list[str] = []

    def handle_data(self, d):
        self.out.append(d)


def clean(text: str, cap: int = CLIP) -> str:
    """HTML-strip -> control-char pictures -> single line -> clip.

    C0/DEL become Unicode pictures, C1/bidi markers become explicit <U+XXXX>
    (typed text can impersonate neither); titles and locations are untrusted.
    """
    if "<" in text:
        p = _Strip()
        try:
            p.feed(text)
            # join with "" — the parser splits data AT tags; a space would
            # break "<b>Eng</b>ineer" into two words (caught by self_check)
            text = "".join(p.out)
        except Exception:
            pass  # ponytail: malformed HTML keeps its raw text; the control pass below still applies
    out = []
    for ch in text:
        o = ord(ch)
        if ch == "\n" or ch == "\r" or ch == "\t":
            out.append(" ")
        elif o < 0x20 or o == 0x7F:
            out.append(chr(0x2400 + o) if o < 0x20 else "␡")
        elif 0x80 <= o <= 0x9F or o in (0x2028, 0x2029, 0x2060, 0xFEFF) or 0x200B <= o <= 0x200F or 0x202A <= o <= 0x202E:
            out.append(f"<U+{o:04X}>")
        else:
            out.append(ch)
    return "".join(out)[:cap]


# ---------- location verdict: the never-guess-into-open core ----------

# Named regions that exclude India, checked BEFORE open words so "Anywhere in
# Europe" or "Global - US only" cannot read as open. A city/name fallback is
# closed by default — default-deny, curated allow.
_CLOSED = re.compile(
    r"\b(us|usa|u\.s\.|united states|united kingdom|uk|u\.k\.|britain|england|europe|european|emea|americas?|canada)\b",
    re.I,
)
# India-inclusive markers. "australasia" and "indianapolis" are fended off by the \b.
_OPEN = re.compile(r"\b(worldwide|anywhere|globally|global|india|asia|asian|apac|apj)\b", re.I)
_BARE_REMOTE = {"remote", "hybrid", "remote role", "distributed"}
_RANK = ["closed", "unclear", "open"]  # index order IS the permissiveness order


def _piece(p: str) -> str:
    q = p.strip().strip(",;.").lower()
    if not q:
        return "unclear"
    if _CLOSED.search(q):
        return "closed"
    if _OPEN.search(q):
        return "open"
    if q in _BARE_REMOTE:
        return "unclear"
    return "closed"


def verdict(location: str) -> str:
    """open (workable from India) · unclear (kept, labelled) · closed (dropped, counted).

    A multi-location string is as open as its most permissive option:
    "London or Remote (Worldwide)" -> open, "US or Canada" -> closed,
    "Remote" alone says nothing about region -> unclear.
    """
    if not location or not location.strip():
        return "unclear"
    pieces = re.split(r"\s*,?\s+or\s+|/", location)
    return _RANK[max(_RANK.index(_piece(p)) for p in pieces)]


# ---------- sources & adapters: one seam per vendor, fixtures pin each shape ----------

@dataclass
class Job:
    company: str
    title: str
    location: str
    url: str
    feed_name: str = ""  # the feed's own company name when the payload carries one (namesake check)


@dataclass
class Source:
    sid: str          # receipt id, e.g. "greenhouse:gitlab" / "remoteok"
    label: str        # CSV company name, or the board's name
    url: str
    parse: object     # (obj, label) -> Iterable[Job]
    flex_only: bool = False  # Remote Model without the word "remote" (Insight's "Hybrid"): labelled, never `open`
    is_board: bool = False


def parse_greenhouse(obj, label):
    jobs = obj.get("jobs") if isinstance(obj, dict) else None
    if not isinstance(jobs, list):
        raise ShapeError("greenhouse: expected object with .jobs[]")
    for j in jobs:
        loc = j.get("location") or {}
        yield Job(label, j.get("title") or "", loc.get("name", "") if isinstance(loc, dict) else "",
                  j.get("absolute_url") or "", j.get("company_name") or "")


def parse_ashby(obj, label):
    jobs = obj.get("jobs") if isinstance(obj, dict) else None
    if not isinstance(jobs, list):
        raise ShapeError("ashby: expected object with .jobs[]")
    for j in jobs:
        yield Job(label, j.get("title") or "", j.get("location") or "", j.get("jobUrl") or "")


def parse_lever(obj, label):
    if not isinstance(obj, list):
        raise ShapeError("lever: expected top-level array")
    for j in obj:
        cats = j.get("categories") or {}
        yield Job(label, j.get("text") or "", cats.get("location", "") if isinstance(cats, dict) else "",
                  j.get("hostedUrl") or "")


def parse_eightfold(obj, label):
    pos = obj.get("positions") if isinstance(obj, dict) else None
    if not isinstance(pos, list):
        raise ShapeError("eightfold: expected object with .positions[]")
    for j in pos:
        yield Job(label, j.get("name") or "", j.get("location") or "", j.get("canonicalPositionUrl") or "")


def parse_remoteok(obj, label):
    if not isinstance(obj, list):
        raise ShapeError("remoteok: expected top-level array")
    for j in obj:
        if not isinstance(j, dict) or "position" not in j:
            continue  # element 0 is RemoteOK's legal notice, not a job
        yield Job(str(j.get("company") or label), j.get("position") or "", j.get("location") or "", j.get("url") or "")


def parse_remotive(obj, label):
    jobs = obj.get("jobs") if isinstance(obj, dict) else None  # '00-warning'/'0-legal-notice' siblings ignored
    if not isinstance(jobs, list):
        raise ShapeError("remotive: expected object with .jobs[]")
    for j in jobs:
        yield Job(str(j.get("company_name") or label), j.get("title") or "",
                  j.get("candidate_required_location") or "", j.get("url") or "")


def parse_himalayas(obj, label):
    jobs = obj.get("jobs") if isinstance(obj, dict) else None
    if not isinstance(jobs, list):
        raise ShapeError("himalayas: expected object with .jobs[]")
    for j in jobs:
        # locationRestrictions is a LIST of countries; empty = no restriction =
        # worldwide (the API's own semantics — the field name says restrictions)
        restr = j.get("locationRestrictions") or []
        yield Job(str(j.get("companyName") or label), j.get("title") or "",
                  ", ".join(restr) if restr else "Worldwide", j.get("applicationLink") or "")


ADAPTERS = {"greenhouse": parse_greenhouse, "ashby": parse_ashby,
            "lever": parse_lever, "eightfold": parse_eightfold}
BOARDS = {"remoteok": (BOARDS["remoteok"], parse_remoteok),
          "remotive": (BOARDS["remotive"], parse_remotive),
          "himalayas": (BOARDS["himalayas"], parse_himalayas)}


def feed_url(ats: str, slug: str) -> str:
    if ats == "eightfold":
        parts = slug.split("|")
        if len(parts) != 2:
            raise ShapeError(f"eightfold slug must be 'api-domain|company-domain', got {slug!r}")
        return FEED_URL[ats].format(*parts)
    return FEED_URL[ats].format(slug)


# ---------- keyword filter (whole word: "java" must not match "javascript") ----------

def word_re(word: str) -> re.Pattern:
    # escape each whitespace-separated part, THEN join with \s+ — re.escape
    # mangles the spaces if substituted after (caught by self_check: multi-word
    # keywords compiled to a literal backslash and never matched anything)
    return re.compile(r"\b" + r"\s+".join(re.escape(p) for p in word.split()) + r"\b", re.I)
    # ponytail: keywords ending in punctuation ("c++") lose the trailing \b and never match — no such keyword today


# ---------- fetching ----------

def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read())


def fetch_source(source: Source, fetch=fetch_json):
    """-> (jobs, None) | (None, reason). Every failure is a named receipt line."""
    try:
        obj = fetch(source.url)
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except urllib.error.URLError as e:
        reason = str(getattr(e, "reason", e))
        return None, "timeout" if "timed out" in reason.lower() else f"unreachable: {clean(reason, 60)}"
    except TimeoutError:
        return None, "timeout"
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, "not JSON"
    except Exception as e:  # ponytail: unknown transport error still gets a line, never a crash
        return None, f"{type(e).__name__}: {clean(str(e), 60)}"
    try:
        return list(source.parse(obj, source.label)), None
    except ShapeError as e:
        return None, str(e)


# ---------- loading ----------

def die(msg: str) -> int:
    print(f"cannot check: {msg}", file=sys.stderr)
    return 2


def load_profile(path: Path):
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return None, f"no {path.name} — copy profile.example.json to profile.json and edit your keywords"
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as e:
        return None, f"profile.json is not JSON ({e.msg})"
    if not isinstance(obj, dict) or not isinstance(obj.get("keywords", []), list):
        return None, "profile.json must be an object with a 'keywords' list"
    return obj, None


def load_companies(path: Path):
    try:
        with open(path, newline="", encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f))
    except OSError as e:
        return None, f"cannot read {path.name}: {e.strerror or e}"
    need = {"Company", "Priority", "Remote Model", "ats", "slug"}
    if not need.issubset(set(rows[0]) if rows else set()):
        return None, f"{path.name} is missing columns (need {', '.join(sorted(need))})"
    return rows, None


def open_store(path: Path):
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE IF NOT EXISTS seen(url TEXT PRIMARY KEY, first_seen TEXT NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS sources(sid TEXT PRIMARY KEY, sample TEXT NOT NULL)")
    return db


# ---------- the run ----------

PRIORITY_SETS = {"high": {"High"}, "medium": {"High", "Medium"}, "all": None}


def run(argv=None, fetch=fetch_json, out=sys.stdout) -> int:
    ap = argparse.ArgumentParser(
        prog="job_radar",
        description="Ask every free public jobs feed on the companies list; show what's new and workable from India.",
    )
    ap.add_argument("--priority", choices=sorted(PRIORITY_SETS), default=None,
                    help="filter companies.csv rows: high = High only, medium = High+Medium, all = everything (default)")
    ap.add_argument("--all", action="store_true", help="list every match, not just jobs unseen by the store")
    ap.add_argument("--profile", type=Path, default=DAY / "profile.json")
    ap.add_argument("--companies", type=Path, default=DAY / "companies.csv")
    ap.add_argument("--store", type=Path, default=DAY / "seen.sqlite3")
    args = ap.parse_args(argv)

    profile, why = load_profile(args.profile)
    if profile is None:
        return die(why)
    companies, why = load_companies(args.companies)
    if companies is None:
        return die(why)
    priority = args.priority or profile.get("priority") or "all"
    if priority not in PRIORITY_SETS:
        return die(f"profile priority {priority!r} is not one of {', '.join(sorted(PRIORITY_SETS))}")
    prio_set = PRIORITY_SETS[priority]

    sources: list[Source] = []
    feedless: list[str] = []
    for row in companies:
        if prio_set is not None and (row.get("Priority") or "").strip() not in prio_set:
            continue
        name = row["Company"]
        ats, slug = (row.get("ats") or "").strip(), (row.get("slug") or "").strip()
        if not ats or not slug or ats not in ADAPTERS:
            feedless.append(name)
            continue
        try:
            url = feed_url(ats, slug)
        except ShapeError as e:
            feedless.append(f"{name} ({e})")
            continue
        flex = not re.search(r"\bremote\b", row.get("Remote Model") or "", re.I)
        sources.append(Source(f"{ats}:{slug}", name, url, ADAPTERS[ats], flex_only=flex))
    sources += [Source(n, n, u, p, is_board=True) for n, (u, p) in BOARDS.items()]

    with cf.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(lambda s: fetch_source(s, fetch), sources))

    receipts, first_seen_jobs = [], []
    ok_sources = 0
    for src, (jobs, err) in zip(sources, results):
        if err:
            receipts.append(f"- failed: {err} · {src.label} ({src.sid})")
        else:
            ok_sources += 1
            receipts.append(f"- ok {len(jobs)} · {src.label} ({src.sid})" + (" · board" if src.is_board else ""))
            if jobs:
                first_seen_jobs.append((src, jobs[0]))
    if sources and ok_sources == 0:
        return die(f"every source failed ({len(sources)} attempted) — network, or the feeds moved")

    db = open_store(args.store)
    known_sources = {r[0] for r in db.execute("SELECT sid FROM sources")}
    seen = {r[0] for r in db.execute("SELECT url FROM seen")}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    shown, counts = [], {"open": 0, "unclear": 0, "flex-only": 0, "closed": 0, "kw": 0, "broken": 0}
    include = [word_re(w) for w in profile.get("keywords", [])]
    exclude = [word_re(w) for w in profile.get("exclude", [])]
    urls = set()
    for src, (jobs, _) in zip(sources, results):
        if not jobs:
            continue
        for job in jobs:
            if not job.url or not job.title:
                counts["broken"] += 1
                continue
            if job.url in urls:
                continue
            urls.add(job.url)
            if any(rx.search(job.title) for rx in exclude) or (include and not any(rx.search(job.title) for rx in include)):
                counts["kw"] += 1
                continue
            v = verdict(job.location)
            if v == "closed":
                counts["closed"] += 1
                continue
            label = "flex-only" if (v == "open" and src.flex_only) else v
            counts[label] += 1
            is_new = job.url not in seen
            if is_new or args.all:
                loc = clean(job.location) or "(unstated)"
                shown.append((is_new, f"- **{clean(job.company, 40)}** — {clean(job.title)} · `{label}` · {loc} · {job.url}"))

    new_lines = [line for is_new, line in shown if is_new]
    db.executemany("INSERT OR IGNORE INTO seen VALUES (?, ?)", [(u, now) for u in urls])
    db.executemany("INSERT OR IGNORE INTO sources VALUES (?, ?)",
                   [(src.sid, f"{src.label}: {clean(j.title, 60)} @ {clean(j.location, 40)}") for src, j in first_seen_jobs])
    db.commit()
    db.close()

    print(f"job radar — {datetime.now().astimezone():%Y-%m-%d %H:%M} · {len(sources)} sources "
          f"({len(sources) - len(BOARDS)} feeds + {len(BOARDS)} boards) · priority: {priority}", file=out)
    fresh = [(src, j) for src, j in first_seen_jobs if src.sid not in known_sources]
    if fresh:
        print("\n## first sightings (slugs are guessed — the sample proves whose jobs the feed carries)", file=out)
        for src, j in fresh:
            proof = f'feed says "{clean(j.feed_name, 40)}": ' if j.feed_name else ""
            print(f"- {src.label} ({src.sid}) — {proof}sample: {clean(j.title, 60)} @ {clean(j.location, 40)}", file=out)
    title = "all matches" if args.all else "new since last run"
    print(f"\n## {title} ({len(shown)})\n", file=out)
    for _, line in shown:
        print(line, file=out)
    if not shown:
        print("_(nothing matched)_", file=out)
    print(f"\n**{len(new_lines)} new** — {counts['open']} open · {counts['unclear']} unclear · {counts['flex-only']} flex-only "
          f"· {counts['closed']} dropped: closed location · {counts['kw']} skipped: keyword filter · {counts['broken']} broken (no url/title)",
          file=out)
    print("\n## receipts", file=out)
    for r in receipts:
        print(r, file=out)
    if feedless:
        print(f"- no feed ({len(feedless)}): {', '.join(feedless)} — add ats+slug columns, or scrape (the named next step)", file=out)
    return 0 if new_lines else 1


if __name__ == "__main__":
    sys.exit(run())
