#!/usr/bin/env python3
"""self-check for remote-job-radar — plain asserts, zero frameworks, zero network.

Run directly (python3 self_check.py) or under pytest. Expected values hand-derived
from fixtures/ (D05 rule: fixtures counted twice; the tool's own output is never
the oracle — except where the assertion pins the OUTPUT of a hand-traced run).

Fixture census (recorded 2026-11-12, trimmed real responses; counted twice):
  greenhouse GitLab 4: closed(US) closed(CA;PL;UK) open(Bangalore, India) closed(Canada)
  ashby Zapier     3: open(APAC) closed(NAMER) closed("South America ")
  lever Kinsta     2: closed(Manila) closed(Budapest)
  eightfold Insight 2: closed(Perth,Australia) closed(Adelaide,Australia)  [company is flex-only: "Hybrid"]
  remoteok         3: +1 legal notice (never a job) — unclear("") closed(Menlo Park) unclear("")
  remotive         2: open(Worldwide) open(Worldwide)
  himalayas        3: open(India) closed(United States) closed(Europe list)
"""

import csv
import io
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import job_radar as jr  # noqa: E402

FIX = Path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures"))
PY = sys.executable

FIXTURES = {n: json.loads((FIX / f"{n}.json").read_text()) for n in
            ("greenhouse", "ashby", "lever", "eightfold", "remoteok", "remotive", "himalayas")}

# the four feed-backed companies of the test CSV, keyed by URL substring
STUB_MAP = [("gitlab", "greenhouse"), ("zapier", "ashby"), ("kinsta", "lever"),
            ("apaccareers.insight.com", "eightfold"),
            ("remoteok.com/api", "remoteok"), ("remotive.com", "remotive"), ("himalayas.app", "himalayas")]

TEST_CSV = [
    ("GitLab", "High", "Remote-first (all-remote)", "greenhouse", "gitlab"),
    ("Zapier", "High", "Remote-first", "ashby", "zapier"),
    ("Kinsta", "Medium", "Remote-first", "lever", "kinsta"),
    ("Insight", "High", "Hybrid", "eightfold", "apaccareers.insight.com|insight.com"),
    ("Deel", "High", "Remote-first", "", ""),
    ("Doist", "Low", "Remote-first (all-remote)", "", ""),
]


def make_fetch(fail=(), shape_broken=(), not_json=()):
    """URL-substring -> fixture; names in fail/shape_broken/not_json get that failure."""
    def fetch(url):
        for name in fail:
            if name in url:
                raise urllib.error.HTTPError(url, 404, "Not Found", {}, io.BytesIO(b""))
        for name in not_json:
            if name in url:
                raise json.JSONDecodeError("Expecting value", "<doc>", 0)
        for name in shape_broken:
            if name in url:
                return {}  # every adapter rejects {} — the wrong-shape case
        for sub, name in STUB_MAP:
            if sub in url:
                return FIXTURES[name]
        raise urllib.error.URLError(urllib.error.URLError("no stub for " + url))
    return fetch


def world(tmp, rows=TEST_CSV, profile=None, priority="all"):
    """Write CSV+profile into tmp; return an argv pointing run() at them."""
    d = Path(tmp)
    with open(d / "companies.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Company", "Priority", "Remote Model", "ats", "slug"])
        w.writerows(rows)
    (d / "profile.json").write_text(json.dumps(
        profile if profile is not None else
        {"keywords": ["engineer", "analyst", "coach", "manager"], "exclude": ["director"], "priority": priority}))
    return ["--companies", str(d / "companies.csv"), "--profile", str(d / "profile.json"),
            "--store", str(d / "seen.sqlite3")]


def run(argv, fetch):
    buf, err = io.StringIO(), io.StringIO()
    old = sys.stderr
    sys.stderr = err
    try:
        rc = jr.run(argv, fetch=fetch, out=buf)
    finally:
        sys.stderr = old
    return rc, buf.getvalue() + err.getvalue()


# ---------- 1. adapters: one recorded fixture per source shape ----------

def test_adapters_match_hand_counts():
    for name, n, fn in [("greenhouse", 4, jr.parse_greenhouse), ("ashby", 3, jr.parse_ashby),
                        ("lever", 2, jr.parse_lever), ("eightfold", 2, jr.parse_eightfold),
                        ("remoteok", 3, jr.parse_remoteok), ("remotive", 2, jr.parse_remotive),
                        ("himalayas", 3, jr.parse_himalayas)]:
        jobs = list(fn(FIXTURES[name], "CSV-Label"))
        assert len(jobs) == n, f"{name}: {len(jobs)} jobs, hand-count says {n}"
        for j in jobs:
            assert j.title and j.url, f"{name}: empty title/url on {j}"
            assert isinstance(j.location, str), f"{name}: location not a string"


def test_greenhouse_carries_feed_company_name():
    jobs = list(jr.parse_greenhouse(FIXTURES["greenhouse"], "Whatever"))
    assert all(j.feed_name == "GitLab" for j in jobs)  # the namesake proof lives in the payload


def test_wrong_shape_is_named_not_crashed():
    for name, fn in [("greenhouse", jr.parse_greenhouse), ("ashby", jr.parse_ashby),
                     ("lever", jr.parse_lever), ("eightfold", jr.parse_eightfold),
                     ("remoteok", jr.parse_remoteok), ("remotive", jr.parse_remotive),
                     ("himalayas", jr.parse_himalayas)]:
        try:
            list(fn({}, "X"))
            raise AssertionError(f"{name}: {{}} accepted")
        except jr.ShapeError as e:
            assert name in str(e), f"{name}: reason does not name the source: {e}"


def test_himalayas_empty_restrictions_is_worldwide():
    jobs = list(jr.parse_himalayas({"jobs": [{"title": "T", "applicationLink": "u", "locationRestrictions": []}]}, "X"))
    assert jobs[0].location == "Worldwide"  # the API's own semantics: no restriction stated


# ---------- 2. remoteok's element-0 legal notice ----------

def test_remoteok_notice_never_a_job():
    raw = FIXTURES["remoteok"]
    assert "legal" in raw[0] and "position" not in raw[0]  # the fixture really carries the notice
    assert len(list(jr.parse_remoteok(raw, "X"))) == len(raw) - 1


# ---------- 3. location verdict table (brief traps verbatim) ----------

def test_verdict_table():
    cases = {
        # open — India-workable
        "Remote (India)": "open", "Bangalore, India": "open", "APAC": "open",
        "Worldwide": "open", "Anywhere": "open", "Asia-Pacific": "open",
        "EMEA or APAC": "open", "us or asia": "open", "Remote (Worldwide) or Berlin": "open",
        # unclear — kept, labelled, never guessed into open
        "Remote": "unclear", "": "unclear", "London or Remote": "unclear",
        "Remote/Hybrid": "unclear", "   ": "unclear", "Remote.": "unclear",
        # closed — named region that excludes India
        "Remote - US": "closed", "US only": "closed", "Canada": "closed", "Remote - EMEA": "closed",
        "Indiana, US": "closed", "Anywhere in Europe": "closed", "Global - US only": "closed",
        "Singapore": "closed", "Remote, Canada; Remote, Poland": "closed",
        "Albania, Andorra, Austria": "closed", "Australasia": "closed",
    }
    for loc, want in cases.items():
        got = jr.verdict(loc)
        assert got == want, f"{loc!r}: got {got}, want {want}"


# ---------- 4. keyword filter: whole word, case-insensitive ----------

def test_keyword_whole_word():
    java = jr.word_re("java")
    assert java.search("Senior Java Developer")           # hit
    assert not java.search("Senior JavaScript Developer")  # substring non-hit — the brief's trap
    assert java.search("JAVA BACKEND")                     # case-insensitive
    full = jr.word_re("full stack")
    assert full.search("Full  Stack Engineer")             # multi-word tolerates whitespace


# ---------- 5. seen-store: second run is empty; --all still lists ----------

def test_second_run_empty_then_all_still_lists():
    with tempfile.TemporaryDirectory() as tmp:
        argv = world(tmp)
        rc1, out1 = run(argv, make_fetch())
        # hand-trace: shown new = GH Benefits Analyst(open), RO Coach(unclear),
        # RO Data Engineer(unclear), Remotive Tier III(open), Himalayas BizAdmin Manager(open);
        # dropped closed = GH Backend Eng, Zapier Finance Mgr, Zapier Sr TAM, Kinsta Acct Mgr,
        # Himalayas Product Mgr, Himalayas Cybersecurity Eng; keyword-skipped = 8
        assert rc1 == 0 and "**5 new** — 3 open · 2 unclear · 0 flex-only · 6 dropped: closed location · 8 skipped: keyword filter" in out1, out1
        rc2, out2 = run(argv, make_fetch())
        assert rc2 == 1 and "_(nothing matched)_" in out2, out2
        rc3, out3 = run(argv + ["--all"], make_fetch())
        assert rc3 == 1 and out3.count("- **") == 5  # --all lists them again (nothing NEW)


# ---------- 6. exit matrix + partial failure ----------

def test_exit_2_when_every_source_fails():
    with tempfile.TemporaryDirectory() as tmp:
        argv = world(tmp)
        rc, out = run(argv, make_fetch(fail=[s for s, _ in STUB_MAP]))
        assert rc == 2 and "every source failed (7 attempted)" in out, out


def test_one_source_fails_others_succeed():
    with tempfile.TemporaryDirectory() as tmp:
        rc, out = run(world(tmp), make_fetch(fail=["kinsta"]))
        assert rc == 0, out  # still 0 — new matches exist
        assert "failed: HTTP 404 · Kinsta (lever:kinsta)" in out, out
        assert "- ok 4 · GitLab (greenhouse:gitlab)" in out, out


def test_bad_profile_priority_is_named_exit_2():
    with tempfile.TemporaryDirectory() as tmp:
        rc, out = run(world(tmp, profile={"keywords": [], "priority": "urgent"}), make_fetch())
        assert rc == 2 and "not one of" in out, out


def test_bad_flag_is_exit_2():
    try:
        rc = jr.run(["--priority", "mega"], fetch=make_fetch())
    except SystemExit as e:
        rc = e.code
    assert rc == 2


# ---------- 7. malformed input: named reason, no traceback ----------

def test_not_json_receipt_line():
    with tempfile.TemporaryDirectory() as tmp:
        rc, out = run(world(tmp), make_fetch(not_json=["zapier"]))
        assert rc == 0 and "failed: not JSON · Zapier (ashby:zapier)" in out, out


def test_wrong_shape_receipt_line():
    with tempfile.TemporaryDirectory() as tmp:
        rc, out = run(world(tmp), make_fetch(shape_broken=["zapier"]))
        assert rc == 0 and "failed: ashby: expected object with .jobs[] · Zapier (ashby:zapier)" in out, out


def test_missing_files_subprocess_no_traceback():
    with tempfile.TemporaryDirectory() as tmp:
        p = subprocess.run([PY, "job_radar.py", "--profile", f"{tmp}/none.json",
                            "--companies", "companies.csv"], capture_output=True, text=True)
        assert p.returncode == 2
        assert "cannot check: no none.json" in p.stderr
        assert "Traceback" not in p.stderr
        p2 = subprocess.run([PY, "job_radar.py", "--profile", "profile.example.json",
                             "--companies", f"{tmp}/none.csv"], capture_output=True, text=True)
        assert p2.returncode == 2 and "cannot read none.csv" in p2.stderr
        assert "Traceback" not in p2.stderr


def test_missing_columns_named():
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        (d / "c.csv").write_text("Company,Priority\nX,High\n")
        p = subprocess.run([PY, "job_radar.py", "--profile", "profile.example.json",
                            "--companies", str(d / "c.csv"), "--store", str(d / "s.db")],
                           capture_output=True, text=True)
        assert p.returncode == 2 and "missing columns" in p.stderr and "Traceback" not in p.stderr


# ---------- 8. feedless companies: named, counted (66 in today's real CSV) ----------

def test_feedless_named_and_counted_small_csv():
    with tempfile.TemporaryDirectory() as tmp:
        rc, out = run(world(tmp), make_fetch())
        assert rc == 0 and "- no feed (2): Deel, Doist" in out, out


def test_feedless_count_on_the_real_csv():
    with tempfile.TemporaryDirectory() as tmp:
        argv = world(tmp)
        argv[argv.index("--companies") + 1] = str(Path(jr.__file__).parent / "companies.csv")
        rc, out = run(argv, make_fetch())
        assert rc in (0, 1)
        # 67 since the build itself: greenhouse:remote proved to be General
        # Assembly's board (first-sighting line), Remote's row moved to feedless
        assert "- no feed (67):" in out and "Automattic" in out and "Remote," in out and "DuckDuckGo" in out, out
        assert "job radar — " in out and "59 sources (56 feeds + 3 boards)" in out, out


# ---------- 9. namesake guard + flex-only + dedupe + display safety ----------

def test_first_sighting_then_silence():
    with tempfile.TemporaryDirectory() as tmp:
        rc1, out1 = run(world(tmp), make_fetch())
        assert "## first sightings" in out1, out1
        assert 'GitLab (greenhouse:gitlab) — feed says "GitLab"' in out1, out1  # payload's own name
        assert "Zapier (ashby:zapier) — sample: Sales Assist Representative" in out1, out1
        _, out2 = run(world(tmp), make_fetch())
        assert "first sightings" not in out2, out2  # once per source, ever


def test_flex_only_company_labelled_never_open():
    rows = [("FlexCo", "High", "Hybrid", "greenhouse", "gitlab")]
    with tempfile.TemporaryDirectory() as tmp:
        rc, out = run(world(tmp, rows=rows, profile={"keywords": ["analyst"], "exclude": []}), make_fetch())
        assert rc == 0 and "`flex-only`" in out and "**0 open**" not in out, out
        assert "**FlexCo** — Benefits Analyst · `flex-only` · Bangalore, India" in out, out


def test_same_url_across_sources_listed_once():
    rows = [("One", "High", "Remote-first", "greenhouse", "gitlab"),
            ("Two", "High", "Remote-first", "greenhouse", "gitlab")]
    with tempfile.TemporaryDirectory() as tmp:
        rc, out = run(world(tmp, rows=rows, profile={"keywords": ["analyst"], "exclude": []}), make_fetch())
        assert rc == 0 and out.count("Benefits Analyst") == 1, out  # deduped by URL


def test_display_safety():
    assert jr.clean("<b>Eng</b>ineer&nbsp;X") == "Engineer\xa0X"  # inline tag must not split the word; &nbsp; is \xa0
    assert jr.clean("a\x07b") == "a␇b"                    # C0 picture
    assert jr.clean("a‮b") == "a<U+202E>b"               # bidi marker can't impersonate text
    assert jr.clean("x" * 100) == "x" * 80                 # clip at the rune cap
    assert jr.clean("line\nbreak\ttab") == "line break tab"


def test_priority_filter_narrows_sources():
    with tempfile.TemporaryDirectory() as tmp:
        rc, out = run(world(tmp) + ["--priority", "high"], make_fetch())
        # High rows: GitLab, Zapier, Insight, Deel(feedless); Kinsta(Medium) and Doist(Low) gone
        assert "priority: high" in out and "Kinsta" not in out and "- no feed (1): Deel" in out, out


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"ok   {name}")
            except AssertionError as e:
                fails += 1
                print(f"FAIL {name}: {e}")
    print(f"\n{len([n for n in globals() if n.startswith('test_')]) - fails} passed, {fails} failed")
    sys.exit(1 if fails else 0)
