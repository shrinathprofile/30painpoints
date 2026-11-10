#!/usr/bin/env python3
"""self-check for decision-miner — plain asserts, zero frameworks.

Run directly (python3 self_check.py) or under pytest; both run the same
test_* functions. Expected values hand-derived from the fixtures (D05 rule:
fixtures counted twice; the tool's own output is never the oracle).
"""

import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import decision_miner as dm  # noqa: E402

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def _rep(fname: str, llm=None) -> dm.Report:
    with open(os.path.join(FIX, fname), "rb") as f:
        return dm.process_bytes(f.read(), fname, llm)


def _kinds(rep: dm.Report) -> dict[str, list[dm.Item]]:
    out: dict[str, list[dm.Item]] = {"decision": [], "action": [], "question": []}
    for it in rep.items:
        out[it.kind].append(it)
    return out


# ---------- parsing ----------

def test_parse_bracketed_ts_and_speaker():
    lines = dm.parse_transcript("[00:03:40] Maya: Okay, we'll go with Postgres.\n")
    assert len(lines) == 1
    assert lines[0].no == 1 and lines[0].ts == "00:03:40"
    assert lines[0].speaker == "Maya" and "Postgres" in lines[0].text


def test_parse_speaker_parenthetical():
    lines = dm.parse_transcript("Maya (to Arjun): you still own it.\n")
    assert lines[0].speaker == "Maya" and lines[0].text == "you still own it."


def test_parse_vtt_voice_tags_cue_ts_and_notes():
    text = ("WEBVTT\nNOTE auto\n\n00:00:05.000 --> 00:00:09.000\n"
            "<v Arjun>We'll use the <00:00:06.000>staging cluster.\n")
    lines = dm.parse_transcript(text)
    assert len(lines) == 1
    assert lines[0].speaker == "Arjun"
    assert lines[0].ts == "00:00:05.000"          # inherited from the cue header
    assert lines[0].text == "We'll use the staging cluster."  # inline tag stripped


def test_parse_srt_sequence_and_cue_lines_skipped():
    text = "1\n00:00:01,000 --> 00:00:02,000\nMaya: We decided to ship.\n\n2\n00:00:03,000 --> 00:00:04,000\nOkay.\n"
    lines = dm.parse_transcript(text)
    assert [l.speaker for l in lines] == ["Maya", None]


def test_parse_lone_cr_is_not_a_line_break():
    # splitlines() would split here; editors and wc -l do not — line numbers must not drift
    lines = dm.parse_transcript("Maya: sys\rtem for Q3.\n")
    assert len(lines) == 1 and "\r" in lines[0].text and lines[0].no == 1


def test_parse_bom_and_url_not_a_speaker():
    lines = dm.parse_transcript("\ufeffhttps://x.com/a is the doc.\n")
    assert lines[0].speaker is None and lines[0].text.startswith("https://x.com/a")


def test_parse_sentence_leadin_not_a_speaker():
    lines = dm.parse_transcript("Okay: we agreed on Supabase.\n")
    assert lines[0].speaker is None    # 'okay' is a curated stop-word


# ---------- sanitize / fold ----------

def test_sanitize_pictures_every_control():
    out = dm.sanitize("a\x07b\rc\td\x1be\x7ff\x85g")
    assert "\x07" not in out and "\r" not in out and "\x1b" not in out
    assert out == "a␇b␍c␉d␛e␡f␥g"
    # C1 + bidi have no picture block — explicit hex markers instead (F4)
    assert dm.sanitize("\x9b\u202e") == "<U+009B><U+202E>"
    assert dm.sanitize("we\x9b31mBOOM") == "we<U+009B>31mBOOM"


def test_sanitize_caps_and_keeps_runes():
    assert dm.sanitize("héllo wörld ü" * 30, cap=10) == "héllo wörl"
    assert dm.sanitize("  x  y  ") == "x y"


def test_fold_diacritics_through_combining_marks():
    assert dm.fold("İstanbul") == "istanbul"
    assert dm.fold("São  Paulo") == "sao paulo"


# ---------- main fixture: hand-verified expectations (counted twice) ----------

def test_product_sync_counts():
    rep = _rep("product-sync.txt")
    k = _kinds(rep)
    assert len(k["decision"]) == 3, [i.text for i in k["decision"]]
    assert len(k["action"]) == 6, [i.text for i in k["action"]]
    assert len(k["question"]) == 4, [i.text for i in k["question"]]


def test_product_sync_reversal_pointers():
    rep = _rep("product-sync.txt")
    d1, d2, d3 = _kinds(rep)["decision"]
    assert d1.no == 3 and "Postgres" in d1.text and d1.superseded_by == "D2"
    assert d2.no == 6 and "Supabase" in d2.text and d2.supersedes == "D1"
    assert d3.no == 15 and d3.superseded_by is None and "15th" in d3.text


def test_product_sync_action_owners_and_dues():
    acts = {(i.owner, i.due) for i in _kinds(_rep("product-sync.txt"))["action"]}
    # Arjun×3 (own migration / runbook / book sync), Chloe×2 (plan / checklist), team×1 (archive)
    assert acts == {("Arjun", None), ("Arjun", "next week"), ("Arjun", "Thursday"),
                    ("Chloe", "Friday"), ("Chloe", "today"), ("team", None)}, acts


def test_product_sync_citations_carry_ts_speaker_line():
    rep = _rep("product-sync.txt")
    d2 = _kinds(rep)["decision"][1]
    assert (d2.speaker, d2.ts, d2.no) == ("Ravi", "00:06:02", 6)


def test_product_sync_noise_rejected():
    rep = _rep("product-sync.txt")
    texts = " \n ".join(i.text for i in rep.items).casefold()
    for noise in ("dog", "thai place", "take that offline", "fine by me", "row-level locking"):
        assert noise not in texts, noise


def test_third_party_commit_from_another_speaker():
    # Maya says "Arjun will own it" and Arjun is a labeled speaker — owner Arjun,
    # citation Maya; if the named committer never speaks, no owner is guessed
    rep = dm.process_bytes(b"Maya: Okay, Arjun will own the migration.\nArjun: Sounds good.\n", "x")
    a = _kinds(rep)["action"][0]
    assert a.owner == "Arjun" and a.speaker == "Maya"
    rep2 = dm.process_bytes(b"Maya: Okay, Arjun will own the migration.\n", "x")
    assert not rep2.items                # unverified names never become owners (F9/F11)


def test_commit_stopwords_block_false_owners():
    rep = dm.process_bytes(b"Maya: Tomorrow will tell. The sprint will end Friday.\n", "x")
    assert not rep.items


def test_unlabeled_iwill_gets_owner_and_note():
    rep = dm.process_bytes(b"I'll send the deck by Friday.\n", "x")
    a = _kinds(rep)["action"][0]
    assert a.owner == "?" and "no speaker labels" in a.text and a.due == "Friday"
    assert rep.unlabeled


def test_can_you_ask_owner_unknown_asker_named():
    rep = dm.process_bytes(b"[00:01:00] Maya: Can you send the deck?\n", "x")
    a = _kinds(rep)["action"][0]
    assert a.owner == "?" and "asked by Maya" in a.text


def test_parking_meta_is_not_an_item():
    rep = dm.process_bytes(b"Maya: Can you two take that offline? Table it for the sync.\n", "x")
    assert not rep.items


def test_question_starters_but_not_smalltalk():
    rep = dm.process_bytes(b"Chloe: Has anyone tried the new Thai place?\n"
                           b"Maya: Should we delay the launch?\n", "x")
    qs = _kinds(rep)["question"]
    assert len(qs) == 1 and "delay" in qs[0].text


def test_exact_duplicate_sentence_deduped():
    rep = dm.process_bytes(b"Maya: I'll send the deck.\nMaya: I'll send the deck.\n", "x")
    assert len(_kinds(rep)["action"]) == 1


def test_reversal_without_prior_decision_is_just_a_decision():
    rep = dm.process_bytes(b"Maya: Actually, let's go with Supabase instead.\n", "x")
    d = _kinds(rep)["decision"][0]
    assert d.supersedes is None


def test_due_end_of_sentence_and_event_anchor_is_not_a_due():
    rep = dm.process_bytes(b"Maya: I'll update the checklist today. "
                           b"We'll archive it before the cutover.\n", "x")
    acts = _kinds(rep)["action"]
    dues = {i.due for i in acts}
    assert "today" in dues and None in dues and "the cutover" not in dues


def test_vtt_fixture_decision_and_action():
    rep = _rep("vtt-export.vtt")
    k = _kinds(rep)
    assert len(k["decision"]) == 1 and "staging cluster" in k["decision"][0].text
    a = k["action"][0]
    assert a.owner == "Chloe" and a.due == "tomorrow" and a.ts == "00:00:09.500"


def test_nothing_decidable_is_honest_empty():
    rep = _rep("nothing-decidable.txt")
    assert not rep.items and rep.unlabeled


def test_hostile_no_raw_control_bytes_in_markdown():
    md = dm.render(_rep("hostile.txt"))
    assert "\x07" not in md and "\r" not in md
    assert "␇" in md and "␍" in md          # pictured, and visible


# ---------- LLM pass: untrusted until every quote verifies ----------

_FAKE_OK = json.dumps({"items": [
    {"type": "action", "text": "Chloe drafts the migration plan", "owner": "Chloe",
     "due": "Friday", "quote": "I'll draft the migration plan by Friday."},
    {"type": "decision", "text": "Replatform to Kubernetes", "owner": "Ghost",
     "due": None, "quote": "we are replatforming to kubernetes as we speak"},
]})


def test_llm_fabricated_quote_dropped_and_counted():
    rep = _rep("product-sync.txt", llm=lambda p: _FAKE_OK)
    assert rep.dropped_claims == 1
    assert not any("Kubernetes" in i.text for i in rep.items)
    assert rep.mode.startswith("deterministic cues + LLM")


def test_llm_owner_normalized_to_null_when_not_a_speaker():
    # 'Ghost' is not in the transcript — must not be shown as an owner
    rep = _rep("product-sync.txt", llm=lambda p: json.dumps({"items": [
        {"type": "action", "text": "draft the plan", "owner": "Ghost", "due": None,
         "quote": "I'll draft the migration plan by Friday."}]}))
    llm_items = [i for i in rep.items if i.src == "llm"]
    assert llm_items and llm_items[0].owner is None


def test_llm_item_locates_its_line_and_dedups_cue_twin():
    rep = _rep("product-sync.txt", llm=lambda p: _FAKE_OK)
    llm_items = [i for i in rep.items if i.src == "llm"]
    assert llm_items[0].no == 5 and llm_items[0].speaker == "Chloe"
    # the cue action from line 5 is proven by the quote — deduped, not duplicated
    cue_twins = [i for i in rep.items if i.src == "cues" and i.no == 5
                 and i.kind == "action" and "migration plan" in i.text]
    assert not cue_twins


def test_llm_diacritic_owner_folds_to_speaker():
    body = b"Maya: I'll draft the plan by Friday.\n"
    rep = dm.process_bytes(body, "x", llm=lambda p: json.dumps({"items": [
        {"type": "action", "text": "draft", "owner": "MAYA", "due": None,
         "quote": "I'll draft the plan by Friday."}]}))
    assert [i for i in rep.items if i.src == "llm"][0].owner == "MAYA"  # fold-matched


def test_llm_markdown_fences_tolerated():
    fenced = "```json\n" + _FAKE_OK + "\n```"
    rep = _rep("product-sync.txt", llm=lambda p: fenced)
    assert rep.dropped_claims == 1          # parsed fine, verified fine


def test_llm_decision_renders_and_gets_an_id():
    # regression: llm decisions arrive with id="" — render's int(id[1:]) crashed
    claims = json.dumps({"items": [
        {"type": "decision", "text": "Ship the beta", "owner": None, "due": None,
         "quote": "final call: we're shipping on the 15th."}]})
    rep = _rep("product-sync.txt", llm=lambda p: claims)
    md = dm.render(rep)                      # must not raise
    llm_dec = [i for i in rep.items if i.src == "llm" and i.kind == "decision"][0]
    assert llm_dec.id.startswith("D")
    ids = [i.id for i in rep.items if i.kind == "decision"]
    assert ids == [f"D{n}" for n in range(1, len(ids) + 1)]   # dense, in order


def test_llm_insert_renumbers_and_remaps_reversal_pointers():
    # an llm decision that quotes the SUPERSEDED cue decision dedupes it; the
    # surviving reversal's pointer must be cut, not dangle at a dead D-id
    claims = json.dumps({"items": [
        {"type": "decision", "text": "Postgres for the migration", "owner": None, "due": None,
         "quote": "Okay, we'll go with Postgres then, and Arjun will own the migration."}]})
    rep = _rep("product-sync.txt", llm=lambda p: claims)
    md = dm.render(rep)
    decs = [i for i in rep.items if i.kind == "decision"]
    assert [i.id for i in decs] == [f"D{n}" for n in range(1, len(decs) + 1)]
    live = {i.id for i in decs}
    for it in decs:
        assert it.supersedes is None or it.supersedes in live
        assert it.superseded_by is None or it.superseded_by in live
    assert "replaces" in md                    # the reversal story survives the merge


def test_llm_unparseable_output_raises():
    # llm_extract raises; process_bytes captures it into the report (F1 contract)
    try:
        dm.llm_extract("x", [], lambda p: "the meeting was great, thanks everyone")
        assert False, "should have raised"
    except dm.LLMError as e:
        assert "unparseable" in str(e)
    rep = _rep("product-sync.txt", llm=lambda p: "the meeting was great, thanks everyone")
    assert rep.llm_error and "unparseable" in rep.llm_error
    assert rep.items                       # the grounded report survived


def test_llm_items_keep_transcript_order_not_provider_order():
    claims = json.dumps({"items": [
        {"type": "action", "text": "later item", "owner": None, "due": None,
         "quote": "I'll update the launch checklist today."},
        {"type": "action", "text": "earlier item", "owner": None, "due": None,
         "quote": "I'll draft the migration plan by Friday."},
    ]})
    rep = _rep("product-sync.txt", llm=lambda p: claims)
    llm_nos = [i.no for i in rep.items if i.src == "llm"]
    assert llm_nos == sorted(llm_nos)       # D02: ordering is ours, not the model's


# ---------- CLI exit matrix, pipe-free (D01/D04) ----------

class _World:
    def __init__(self, files: dict[str, bytes], env: dict[str, str] | None = None):
        self.files, self.env_over = files, env or {}
        from os import environ
        self.env_base = dict(environ)
        self.captured: list[str] = []

    def read_bytes(self, path):
        if path not in self.files:
            raise OSError(2, "No such file or directory", path)
        return self.files[path]

    def env(self, name):
        return self.env_over.get(name, self.env_base.get(name))

    def llm(self, env):
        return lambda prompt: _FAKE_OK

    def out(self, s):
        self.captured.append(s)


def test_run_exit_matrix_in_process():
    rep_bytes = open(os.path.join(FIX, "product-sync.txt"), "rb").read()
    assert dm.run(["x", "fixtures/product-sync.txt"], _World({"fixtures/product-sync.txt": rep_bytes})) == 0
    w = _World({"fixtures/nothing-decidable.txt":
                open(os.path.join(FIX, "nothing-decidable.txt"), "rb").read()})
    assert dm.run(["x", "fixtures/nothing-decidable.txt"], w) == 1
    assert "Nothing decidable" in w.captured[0]        # report still printed on 1
    assert dm.run(["x", "missing.txt"], _World({})) == 2
    assert dm.run(["x"], _World({})) == 2              # no positional
    assert dm.run(["x", "a", "b"], _World({"a": b"x", "b": b"x"})) == 2   # two positionals
    assert dm.run(["x", "a", "--bogus"], _World({"a": b"x"})) == 2
    assert dm.run(["x", "a", "--llm"], _World({"a": b"x"})) == 2          # no key
    assert dm.run(["x", "a", "-o"], _World({"a": b"x"})) == 2             # -o without path


def test_run_undecodable_refuses():
    assert dm.run(["x", "bad.bin"], _World({"bad.bin": b"\xff\xfe nope"})) == 2


def test_run_oversized_refuses():
    big = b"x" * (dm.MAX_BYTES + 1)
    assert dm.run(["x", "big.txt"], _World({"big.txt": big})) == 2


def test_run_o_writes_file_quietly():
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "r.md")
        w = _World({"fixtures/product-sync.txt":
                    open(os.path.join(FIX, "product-sync.txt"), "rb").read()})
        rc = dm.run(["x", "fixtures/product-sync.txt", "-o", out], w)
        assert rc == 0 and not w.captured    # unix-quiet on -o
        assert os.path.exists(out) and "Decisions mined" in open(out).read()


def test_subprocess_matrix_pipe_free():
    here = os.path.dirname(os.path.abspath(__file__))
    def cli(*args, env_extra=None):
        env = {**os.environ, **(env_extra or {})}
        env.pop("OPENAI_API_KEY", None); env.pop("DECISION_LLM_KEY", None)
        return subprocess.run([sys.executable, "decision_miner.py", *args],
                               capture_output=True, text=True, cwd=here, env=env).returncode
    assert cli("fixtures/product-sync.txt") == 0
    assert cli("fixtures/nothing-decidable.txt") == 1
    assert cli("does-not-exist.txt") == 2
    assert cli("fixtures/product-sync.txt", "--llm") == 2
    assert cli("fixtures/product-sync.txt", "--nonsense") == 2
    assert cli() == 2


def test_undecodable_via_subprocess_tmpfile():
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
        f.write(b"\x80\x81 not utf8")
        path = f.name
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        r = subprocess.run([sys.executable, "decision_miner.py", path],
                           capture_output=True, text=True, cwd=here)
        assert r.returncode == 2 and "not valid UTF-8" in r.stderr
    finally:
        os.unlink(path)


# ---------- adversarial regressions (F1-F22, fresh-context pass; each reproduces
# an executed finding twice before it earned this line) ----------

def test_f1_llm_failure_ships_report_and_exits_2():
    def boom(prompt):
        raise dm.LLMError("LLM returned unparseable output (no JSON value found)")
    w = _World({"fixtures/product-sync.txt":
                open(os.path.join(FIX, "product-sync.txt"), "rb").read()})
    w.llm = lambda env: boom                       # a flaky/garbage endpoint
    w.env_over = {"DECISION_LLM_KEY": "k"}
    rc = dm.run(["x", "fixtures/product-sync.txt", "--llm"], w)
    assert rc == 2                                  # not 1, not a traceback
    assert "Decisions mined" in w.captured[0]       # the grounded report still ships


def test_f1_real_llm_wraps_network_errors():
    env = {"DECISION_LLM_KEY": "k", "DECISION_LLM_URL":
           "http://127.0.0.1:5999/v1", "DECISION_LLM_MODEL": "m"}.get
    maker = dm.real_llm(env)
    try:
        maker("prompt")                             # nothing listens on 5999
        assert False, "should have raised LLMError"
    except dm.LLMError as e:
        assert "unreachable" in str(e)


def test_f2_vacuous_quotes_verify_nothing():
    for junk in ("́̂", "Maya:", "the"):
        rep = dm.process_bytes(b"Maya: We'll go with Postgres.\n", "x",
                               llm=lambda p, q=junk: json.dumps({"items": [
                                   {"type": "decision", "text": "Fire everyone Friday",
                                    "owner": None, "due": None, "quote": q}]}))
        assert not any("Fire everyone" in i.text for i in rep.items), repr(junk)


def test_f3_unwritable_out_path_exits_2():
    with tempfile.TemporaryDirectory() as d:
        w = _World({"fixtures/product-sync.txt":
                    open(os.path.join(FIX, "product-sync.txt"), "rb").read()})
        rc = dm.run(["x", "fixtures/product-sync.txt", "-o", d], w)   # -o a directory
        assert rc == 2


def test_f5_multiline_quote_verifies():
    body = b"Maya: Okay, we'll go with Postgres.\nRavi: What about backups for Postgres?\n"
    rep = dm.process_bytes(body, "x", llm=lambda p: json.dumps({"items": [
        {"type": "question", "text": "backups?", "owner": None, "due": None,
         "quote": "Okay, we'll go with Postgres.\nRavi: What about backups for Postgres?"}]}))
    assert any(i.src == "llm" for i in rep.items)
    assert rep.dropped_claims == 0


def test_f6_kindblind_dedup_is_gone():
    body = b"Maya: We'll go with Postgres. We'll archive the old cluster next week.\n"
    rep = dm.process_bytes(body, "x", llm=lambda p: json.dumps({"items": [
        {"type": "question", "text": "which db?", "owner": None, "due": None,
         "quote": "We'll go with Postgres. We'll archive the old cluster next week."}]}))
    k = _kinds(rep)
    assert len(k["decision"]) == 1 and len(k["action"]) == 1 and len(k["question"]) == 1


def test_f7_vtt_note_block_and_style_are_not_speech():
    vtt = ("WEBVTT\nSTYLE\ntext { color: yellow }\n\nNOTE discussion so far\n"
           "we'll go with the legacy cluster for now.\n\n00:00:05.000 --> 00:00:06.000\n"
           "<v Maya>Okay.\n")
    lines = dm.parse_transcript(vtt)
    assert [l.text for l in lines] == ["Okay."]
    assert not any("legacy" in l.text for l in lines)


def test_f8_cr_only_file_parses_turns_separately():
    rep = dm.process_bytes(b"Maya: We'll go with Postgres.\r"
                           b"Ravi: Actually, let's go with Supabase instead.\r"
                           b"Chloe: I'll send the plan by Friday.\r", "x")
    acts = _kinds(rep)["action"]
    assert [(a.speaker, a.owner) for a in acts] == [("Chloe", "Chloe")]
    assert {i.speaker for i in rep.items} == {"Maya", "Ravi", "Chloe"}


def test_f9_named_non_speaker_never_owns():
    rep = dm.process_bytes(b"Maya Patel: Maya Patel will send the brief by Friday.\n"
                           b"Ravi: Security will review the design before Monday.\n", "x")
    acts = _kinds(rep)["action"]
    owners = {a.owner for a in acts}
    assert "Patel" not in owners and "Security" not in owners
    assert "Maya Patel" in owners                    # full name, speaker-verified


def test_f10_unciteable_claim_dropped():
    # verifies against the JOINED text but pinnable to no single line and no prefix
    body = b"AAA bbb ccc\nDDD eee fff\n"
    rep = dm.process_bytes(body, "x", llm=lambda p: json.dumps({"items": [
        {"type": "question", "text": "spanning", "owner": None, "due": None,
         "quote": "bbb ccc DDD"}]}))
    assert not [i for i in rep.items if i.src == "llm"]   # dropped, counted
    assert rep.dropped_claims == 1


def test_f11_unlabeled_transcript_nulls_every_llm_owner():
    rep = dm.process_bytes(b"We'll go with Postgres.\n", "x", llm=lambda p: json.dumps(
        {"items": [{"type": "action", "text": "own it", "owner": "Zaphod Beeblebrox",
                    "due": None, "quote": "We'll go with Postgres."}]}))
    llm_items = [i for i in rep.items if i.src == "llm"]
    assert llm_items and llm_items[0].owner is None


def test_f12_duplicate_llm_claims_deduped():
    claim = {"type": "action", "text": "send results", "owner": None, "due": None,
             "quote": "I'll send the results by tomorrow."}
    rep = dm.process_bytes(b"Chloe: I'll send the results by tomorrow.\n", "x",
                           llm=lambda p: json.dumps({"items": [claim, dict(claim)]}))
    assert len([i for i in rep.items if i.src == "llm"]) == 1


def test_f13_llm_returning_both_sides_keeps_reversal():
    body = (b"Maya: Okay, we'll go with Postgres.\n"
            b"Ravi: Wait, actually, let's go with Supabase instead.\n")
    rep = dm.process_bytes(body, "x", llm=lambda p: json.dumps({"items": [
        {"type": "decision", "text": "Postgres", "owner": None, "due": None,
         "quote": "Okay, we'll go with Postgres."},
        {"type": "decision", "text": "Supabase", "owner": None, "due": None,
         "quote": "Wait, actually — let's go with Supabase instead."}]}))
    md = dm.render(rep)
    assert "superseded by" in md and "replaces" in md


def test_f14_arrow_line_is_speech_not_a_cue():
    rep = dm.process_bytes(b"Maya: We'll go with the A --> B mapping table.\n", "x")
    assert len(_kinds(rep)["decision"]) == 1


def test_f15_broken_pipe_dies_quietly():
    # 1200 decisions through a two-line reader: no BrokenPipeError traceback
    big = "".join(f"[00:00:{i % 60:02d}] Maya: We decided to ship thing {i}.\n"
                  for i in range(1200))
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        f.write(big)
        path = f.name
    here = os.path.dirname(os.path.abspath(__file__))
    r = subprocess.run(f'{sys.executable} decision_miner.py {path} | head -2',
                       shell=True, capture_output=True, text=True, cwd=here)
    try:
        assert "BrokenPipeError" not in r.stderr and "Traceback" not in r.stderr
    finally:
        os.unlink(path)


def test_f16_twin_commitments_both_kept():
    rep = dm.process_bytes(b"Chloe: I'll send the results by Friday.\n"
                           b"Arjun: I'll send the results by Friday.\n", "x")
    assert len(_kinds(rep)["action"]) == 2


def test_f18_negated_commitment_is_not_an_action():
    rep = dm.process_bytes(b"Ravi: I can't attend the review before Friday.\n"
                           b"Mei: I will not be here tomorrow.\n", "x")
    assert not rep.items


def test_f19_midsentence_please_is_not_an_ask():
    rep = dm.process_bytes(b"Maya: The docs say please click next to continue.\n", "x")
    assert not rep.items


def test_f20_possessive_day_is_not_a_due():
    rep = dm.process_bytes(b"Maya: I'll draft notes for Monday's standup.\n", "x")
    a = _kinds(rep)["action"][0]
    assert a.due is None


def test_f21_bare_instead_is_not_a_reversal():
    rep = dm.process_bytes(b"Maya: Final call: we're shipping on the 15th.\n"
                           b"Arjun: Also, we'll use the staging cluster instead.\n", "x")
    d = _kinds(rep)["decision"][0]
    assert d.superseded_by is None


def test_f22_label_without_space_and_long_names_parse():
    lines = dm.parse_transcript("Maya:We'll go with Postgres.\n")
    assert lines[0].speaker == "Maya"
    long = "Alexandria-Winthrop-Pemberton-Smythe: I'll send the deck.\n"
    rep = dm.process_bytes(long.encode(), "x")
    assert rep.items and rep.items[0].speaker.startswith("Alexandria")


def _main() -> None:
    tests = [(n, f) for n, f in sorted(globals().items())
             if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        fn()
        print(f"  ok  {name}")
    print(f"{len(tests)} checks green")


if __name__ == "__main__":
    _main()
