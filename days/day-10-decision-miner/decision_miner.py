#!/usr/bin/env python3
"""decision-miner — transcript in, accountability out.

Usage:
  python3 decision_miner.py <transcript.txt|.vtt|.srt> [--llm] [-o report.md]

Exit codes:
  0  report produced with at least one decision/action/question
  1  transcript readable but nothing decidable (report still printed)
  2  cannot check: unreadable/undecodable file, bad flags, --llm requested
     but undeliverable (never silently falls back to heuristics)

Python 3.10+ stdlib only. Formats: `Name: text` turns with optional
`[HH:MM:SS]`/`HH:MM:SS` timestamps, WebVTT (.vtt, <v Name> voice tags), and
SRT (.srt) — no speaker diarization, unlabeled prose yields "owners unknown".
The heuristic core needs no key; `--llm` adds one pass over any
OpenAI-compatible endpoint (DECISION_LLM_KEY or OPENAI_API_KEY; optional
DECISION_LLM_URL / OPENAI_BASE_URL, DECISION_LLM_MODEL) whose EVERY item
must quote the transcript verbatim — unverifiable claims are dropped and
counted, never shown.
"""

from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from dataclasses import dataclass, field

USAGE = "usage: python3 decision_miner.py <transcript> [--llm] [-o report.md]"

# ---------- text hygiene (D08's one-sanitize rule, now on LLM output too) ----------

_C0_PICTURES = {i: chr(0x2400 + i) for i in range(0x20)} | {0x7F: "␡", 0x85: "␥"}
_WS_RUN = re.compile(r"\s+")


def sanitize(text: str, cap: int = 200) -> str:
    """Control chars -> visible markers; newline -> space; cap length.

    C0/DEL become Unicode pictures (D08); C1 + bidi/format controls have no
    picture block, so they become explicit <U+XXXX> markers — typed text can
    impersonate neither. Python str clip is codepoint-safe (no mid-rune risk),
    and strict UTF-8 decoding upstream means no lone surrogates ever arrive.
    """
    out: list[str] = []
    for c in text:
        if c == "\n":
            out.append(" ")
        elif ord(c) in _C0_PICTURES:
            out.append(_C0_PICTURES[ord(c)])
        elif unicodedata.category(c) in ("Cc", "Cf"):
            out.append(f"<U+{ord(c):04X}>")
        else:
            out.append(c)
    return _WS_RUN.sub(" ", "".join(out)).strip()[:cap]


def fold(text: str) -> str:
    """Match-normalize: NFKD, strip combining marks, casefold, one-space ws.

    D09's rule: diacritics fold THROUGH the combining mark, so 'İstanbul'
    and 'Pe\x07tro' compare against their cleaned forms.
    """
    stripped = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return _WS_RUN.sub(" ", stripped).casefold().strip()


# ---------- transcript parsing (log-shaped lines vote; decorations never do — D06) ----------

@dataclass
class Line:
    no: int          # 1-based file line number (the human citation unit)
    ts: str | None   # "HH:MM[:SS]" if the line carried one
    speaker: str | None
    text: str


_VTT_VOICE = re.compile(r"<v[. ]([^>]+)>")   # <v Name> / <v.Name>
_TAG = re.compile(r"<[^>]+>")                 # inline <00:00:05.000> tags, leftover markups
# a cue line must START with a timestamp: "00:00:01,000 --> …" is a cue,
# "we'll use the A --> B mapping" is speech that happens to contain an arrow
_CUE = re.compile(r"^\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*-->")
# ponytail: timestamps echoed unvalidated ([99:99] cited as-is) — citations stay honest to
# the file. Trigger: a report where a garbage timestamp misled someone.
_TS_LEAD = re.compile(r"^\[?(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)\]?\s*")
_SPEAKER = re.compile(r"^([^\s:][^:]{0,40}?)\s*(?:\([^)]*\))?:\s*(.*)$")
_SRT_SEQ = re.compile(r"^\d+$")


def parse_transcript(text: str) -> list[Line]:
    lines: list[Line] = []
    last_cue_ts: str | None = None   # VTT/SRT: the --> header carries the ts for the text after it
    in_block = False                 # VTT NOTE/STYLE blocks run until the next blank line
    # CRLF normalized first; a \r-ONLY file (\r present, \n absent) is an old-Mac
    # transcript whose separator IS \r — normalize or every turn bleeds into line 1
    text = text.replace("\r\n", "\n")
    if "\r" in text and "\n" not in text:
        text = text.replace("\r", "\n")
    # split on \n ONLY from here: splitlines() would also break on lone \r / \v /
    # \f / \x85 mid-line, drifting line numbers away from what an editor shows;
    # stray controls stay in-line and get pictured by sanitize()
    for no, raw in enumerate(text.split("\n"), start=1):
        s = raw.strip("\ufeff").strip()
        if in_block:
            if not s:
                in_block = False
            continue
        if not s or s == "WEBVTT" or s.startswith(("Kind:", "Language:", "Region")):
            continue
        if s.startswith(("NOTE", "STYLE")):   # comment/style BLOCKS, not speech
            in_block = True
            continue
        m = _CUE.match(s)
        if m:
            last_cue_ts = m.group(1)
            continue
        if _SRT_SEQ.match(s):
            continue
        ts = None
        m = _TS_LEAD.match(s)
        if m:
            ts, s = m.group(1), s[m.end():]
        ts = ts or last_cue_ts
        voice = _VTT_VOICE.search(s)
        speaker = voice.group(1).strip() if voice else None
        s = _TAG.sub("", _VTT_VOICE.sub("", s)).strip()
        if not s:
            continue
        if speaker is None:
            m = _SPEAKER.match(s)
            if m and _looks_like_name(m.group(1)):
                speaker, s = m.group(1).strip(), m.group(2).strip()
        lines.append(Line(no, ts, speaker, s))
    return lines


_NAME_STOPWORDS = {
    "okay", "so", "last", "first", "next", "quick", "well", "the", "this",
    "that", "then", "also", "note", "lastly", "finally", "anyway", "wait",
    "http", "https", "www",
}


def _looks_like_name(tok: str) -> bool:
    """A speaker label, not a sentence lead-in. Curated + marked below."""
    if not tok or not tok[0].isalpha() or any(c in tok for c in "/\\@"):
        return False
    # ponytail: curated stop-set; a miss demotes the line to plain text (no wrong
    # owner), add words per report of a mis-parsed label
    return tok.split()[0].casefold() not in _NAME_STOPWORDS


_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")
# ponytail: naive sentence split — abbreviations (e.g. / etc.) split early; costs
# recall only. Real tokenizer if a report shows real misses.


def sentences(line: Line) -> list[tuple[Line, str]]:
    return [(line, s.strip()) for s in _SENT_SPLIT.split(line.text) if s.strip()]


# ---------- cue lists (hand-curated, D09-alias style; refusal > wrong guess) ----------
# ponytail: cue-list precision ceiling — idioms/passives can false-positive ("dropping the
# ball", "budget will be approved"); the LLM pass is the precision path. Trigger: a report
# of a misleading cue hit.

_DECISION = re.compile(
    r"\b(?:we(?:'re|'ll| are| will)?(?: going| gonna go| go)? with|let'?s go with|"
    r"we'?ll (?:use|switch to|adopt|migrate to|standardize on)|"
    r"decided(?: to| on|:)?|decision(?: is|:)|agreed(?: to| on|:)?|"
    r"sign(?:ed)? off(?: on)?|approved|green-?light(?:ed)?|"
    r"final(?: call| answer)|that'?s settled|sticking with|"
    r"we(?:'re)? (?:switching|migrating) to|option [a-z0-9] wins|"
    r"we'?re (?:shipping|dropping))\b",
    re.IGNORECASE,
)
_REVERSAL = re.compile(r"\b(?:actually|wait|on second thought|scratch that|"
                       r"never ?mind)\b", re.IGNORECASE)
# "instead" alone removed: it supersedes unrelated decisions; a bare "instead"
# without actually/wait/scratch is not evidence of a flip
_PARKING = re.compile(r"\b(?:take (?:that|this) offline|table (?:that|it)|"
                      r"park (?:that|it)|let'?s discuss (?:that|this) later)\b", re.IGNORECASE)
_QUESTION = re.compile(
    r"\b(?:open question|need(?:s)? to figure out|not sure (?:about|how|if|whether)|"
    r"unclear (?:if|whether)|tbd|to be determined|what do we do|"
    r"do we know (?:if|whether)|we (?:still )?need to decide|question is)\b|"
    r"^(?:what|who|when|where|should we|do we|are we|can we|is there)\b.*\?$",
    re.IGNORECASE,
)
_I_WILL = re.compile(r"\b(?:i'?ll|i will|i can)\b", re.IGNORECASE)
_WE_COMMIT = re.compile(
    r"\bwe(?:'ll| will| should| can)\s+(?:send|share|draft|review|update|create|"
    r"check|book|schedul\w*|ping|sync\w*|archiv\w*|own|write|migrat\w*|ship|"
    r"handle|set up|follow up|take|cover|circle back)\b",
    re.IGNORECASE,
)
_YOU_ASK = re.compile(r"^\s*(?:can|could|would) you\b.*\?$|^\s*please\s+[a-z]", re.IGNORECASE)
# a capitalized non-stopword committing a third party: "Arjun will own it",
# "Maya Patel will send it" (multi-word names kept whole)
_NAME_WILL = re.compile(r"\b((?:[A-Z][a-z]+ ){0,2}[A-Z][a-z]+)\s+(?:will|'ll|should|needs? to)\s+[a-z]")
# a negated commitment is not a commitment: "I can't attend before Friday"
_NEGATED = re.compile(r"\b(?:won'?t|will not|can'?t|cannot|don'?t|doesn'?t|"
                      r"didn'?t|not going to|n't)\b", re.IGNORECASE)
_COMMIT_STOPWORDS = _NAME_STOPWORDS | {
    "we", "i", "they", "you", "it", "there", "tomorrow", "today", "everyone",
    "somebody", "someone", "sprint", "team", "legal", "week", "monday",
    "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
}
_DUE_VOCAB = (r"(?:eod|end of (?:the )?(?:day|week|month|sprint|quarter)|tomorrow|"
              r"today|tonight|next (?:week|month|sprint)|monday|tuesday|wednesday|"
              r"thursday|friday|saturday|sunday|the \d{1,2}(?:st|nd|rd|th))")
_DUE_MID = re.compile(rf"\b(?:by|before|due|for)\s+({_DUE_VOCAB})(?!['’]s)\b", re.IGNORECASE)
_DUE_END = re.compile(rf"^(.+?)\s+({_DUE_VOCAB})[.?!]?$", re.IGNORECASE)
# ponytail: hand-curated date vocabulary — "by the cutover"-style event anchors are
# NOT dates; add per report of a missed real due phrase


def find_due(sent: str) -> str | None:
    m = _DUE_MID.search(sent) or _DUE_END.match(sent.strip())
    return sanitize(m.group(m.lastindex)) if m else None


# ---------- mining ----------

@dataclass
class Item:
    kind: str                       # decision | action | question
    text: str                       # the sentence, verbatim — the verifiability
    no: int                         # file line it came from (citation)
    ts: str | None
    speaker: str | None
    owner: str | None = None        # actions only
    due: str | None = None
    id: str = ""                    # decisions: D1, D2 …
    supersedes: str | None = None   # set on a reversal decision
    superseded_by: str | None = None
    src: str = "cues"               # "cues" | "llm"
    quote: str | None = None        # llm items: the verbatim span that verified


@dataclass
class Report:
    name: str
    lines: list[Line] = field(default_factory=list)
    items: list[Item] = field(default_factory=list)
    mode: str = "deterministic cues"
    dropped_claims: int = 0
    unlabeled: bool = False
    llm_error: str | None = None   # set when the --llm pass failed: report still ships, exit is 2


def _owner_for(sent: str, speaker: str | None, speakers_f: set[str]) -> tuple[str | None, str | None]:
    """(owner, note). Refusal ('?') beats a wrong name — the D08 identity rule."""
    m = _NAME_WILL.search(sent)
    if m and m.group(1).casefold() not in _COMMIT_STOPWORDS:
        name = m.group(1).strip()
        if fold(name) in speakers_f:
            return name, None          # "Arjun will own it" — verified participant
        return None, None              # ponytail: a named committer who never speaks is
        # unverified — never promoted to owner; the --llm pass covers this seam
    if _I_WILL.search(sent):
        return (speaker, None) if speaker else ("?", "no speaker labels — owner unknown")
    if _YOU_ASK.search(sent):
        return "?", f"asked by {speaker}" if speaker else "asker unknown"
    if _WE_COMMIT.search(sent):
        return "team", None
    return None, None


def mine(name: str, lines: list[Line]) -> Report:
    rep = Report(name=name, lines=lines)
    speakers = {l.speaker for l in lines if l.speaker}
    speakers_f = {fold(s) for s in speakers}
    rep.unlabeled = bool(lines) and not speakers
    seen: set[tuple[str, str, str | None]] = set()
    decisions: list[Item] = []
    d_n = 0

    def add(it: Item) -> bool:
        nonlocal d_n
        key = (it.kind, fold(it.text), it.speaker)   # speaker in the key: twins stay
        if key in seen:
            return False
        seen.add(key)
        if it.kind == "decision":
            d_n += 1
            it.id = f"D{d_n}"
            decisions.append(it)
        rep.items.append(it)
        return True

    for line, sent in (s for l in lines for s in sentences(l)):
        if _PARKING.search(sent):
            continue                       # parking meta-talk routes around item-hood
        is_decision = bool(_DECISION.search(sent))
        if is_decision:
            it = Item("decision", sent, line.no, line.ts, line.speaker)
            # snapshot as bool — `and decisions` would alias the list add() mutates
            reversal = bool(_REVERSAL.search(sent)) and bool(decisions)
            if add(it) and reversal:
                prior = decisions[-2]      # [-1] is the just-added reversal itself
                # ponytail: a reversal supersedes the MOST RECENT decision only —
                # true subject matching needs semantics (the --llm pass reads it);
                # wrong-link reports get real subject matching
                prior.superseded_by = it.id
                it.supersedes = prior.id
        elif _QUESTION.search(sent):
            add(Item("question", sent, line.no, line.ts, line.speaker))
        if _NEGATED.search(sent):
            continue                       # a negated commitment is not a commitment
        owner, note = _owner_for(sent, line.speaker, speakers_f)
        if owner is not None:
            a = Item("action", sent, line.no, line.ts, line.speaker, owner=owner,
                     due=find_due(sent))
            if note:
                a.text = f"{sent} ({note})"
            add(a)
    return rep


# ---------- LLM pass (output is untrusted until every quote verifies) ----------

class LLMError(Exception):
    pass


_LLM_PROMPT = """You extract meeting accountability from a transcript.
Return ONLY a JSON object: {"items": [...]} where each item is
{"type": "decision"|"action"|"question", "text": "<one-line summary>",
 "owner": "<speaker name or null>", "due": "<date phrase or null>",
 "quote": "<VERBATIM contiguous span of the transcript that proves it>"}.
Rules: a quote that is not a verbatim substring of the transcript makes the
item invalid and it will be dropped. Later decisions supersede earlier
contradicted ones — extract only the final call. No invented owners, no
invented dates. Transcript follows:\n\n"""


def _locate(quote: str, folded_lines: list[tuple[str, Line]]) -> Line | None:
    """Find the transcript line an LLM quote came from — restores citation +
    chronological ordering (D02: never inherit the provider's ordering).
    Multi-line quotes fall back to a prefix probe (sanitize space-joined them)."""
    frag = fold(quote)
    if len(frag) >= 8:
        for f, l in folded_lines:
            if frag in f:
                return l
        prefix = " ".join(frag.split()[:4])   # first words only: a 60-char probe
        for f, l in folded_lines:             # would run past line 1 of a multiline quote
            if prefix in f:
                return l
    return None


def llm_extract(text: str, lines: list[Line], call_llm) -> tuple[list[Item], int]:
    """Returns (verified items, total claims seen). Raises LLMError when the
    endpoint's output can't even be parsed — caller exits 2, no fallback."""
    raw = call_llm(_LLM_PROMPT + text)
    try:
        m = re.search(r"[\[{]", raw, re.S)
        if not m:
            raise ValueError("no JSON value found")
        # raw_decode: exactly one value, trailing ``` fences ignored
        data, _ = json.JSONDecoder().raw_decode(raw[m.start():])
        if isinstance(data, list):
            data = {"items": data}
        claims = data.get("items") if isinstance(data, dict) else None
        if not isinstance(claims, list):
            raise ValueError("no items list")
    except (ValueError, json.JSONDecodeError, AttributeError) as e:
        raise LLMError(f"LLM returned unparseable output ({e})") from e

    speakers = {fold(s) for s in (l.speaker for l in lines) if s}
    folded_transcript = fold(text)
    folded_lines = [(fold(l.text), l) for l in lines]
    items: list[Item] = []
    seen_quotes: set[tuple[str, str]] = set()
    for claim in claims:
        if not isinstance(claim, dict) or claim.get("type") not in ("decision", "action", "question"):
            continue
        quote = sanitize(str(claim.get("quote") or ""), cap=400)
        fq = fold(quote)
        # evidence floor: an 8-char minimum kills vacuous quotes (combining-marks
        # mush, bare labels) that substring-match everything
        if len(fq) < 8 or fq not in folded_transcript:
            continue                     # unverifiable — dropped, counted by the diff
        if (claim["type"], fq) in seen_quotes:
            continue                     # duplicate claim, same evidence
        seen_quotes.add((claim["type"], fq))
        owner = sanitize(str(claim.get("owner") or "")) or None
        if owner and fold(owner) not in speakers:
            owner = None                 # unknown owner names null out — with no
            # speakers, EVERY owner is invented; never shown wrong either way
        src_line = _locate(quote, folded_lines)
        if src_line is None:
            continue                     # verified in the text but pinnable to no
            # line — no citation, no item (dropped, counted)
        t = claim.get("text")
        text_out = t if isinstance(t, str) and t.strip() else quote
        items.append(Item(claim["type"], sanitize(text_out),
                          src_line.no, src_line.ts, src_line.speaker,
                          owner=owner, due=sanitize(str(claim.get("due") or "")) or None,
                          src="llm", quote=quote))
    return items, len(claims)


def real_llm(env) -> "callable":
    key = env("DECISION_LLM_KEY") or env("OPENAI_API_KEY")
    base = env("DECISION_LLM_URL") or env("OPENAI_BASE_URL") or "https://api.openai.com/v1"
    model = env("DECISION_LLM_MODEL") or "gpt-4o-mini"
    url = base.rstrip("/") + "/chat/completions"

    def call(prompt: str) -> str:
        body = json.dumps({"model": model, "response_format": {"type": "json_object"},
                           "messages": [{"role": "user", "content": prompt}]}).encode()
        req = urllib.request.Request(url, data=body, headers={
            "Content-Type": "application/json", "Authorization": f"Bearer {key}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                payload = json.loads(r.read().decode("utf-8"))
            return payload["choices"][0]["message"]["content"] or ""
        except LLMError:
            raise
        # one net for everything a flaky endpoint can do: refused connection,
        # timeout, non-JSON body, alien shape — all become a named exit-2, never
        # a traceback wearing exit 1
        except (urllib.error.URLError, OSError, ValueError, KeyError, IndexError, TypeError) as e:
            raise LLMError(f"endpoint unreachable or unexpected shape ({e})") from e
    return call


# ---------- rendering (a citation on every line — the accountability) ----------

def _cite(it: Item) -> str:
    bits = [b for b in (sanitize(it.speaker) if it.speaker else None,
                        sanitize(it.ts) if it.ts else None,
                        f"line {it.no}" if it.no else None) if b]
    tag = " · llm" if it.src == "llm" else ""
    return ", ".join(bits) + tag


def render(rep: Report) -> str:
    out = [f"# Decisions mined — {sanitize(rep.name)}",
           f"_Every item quotes the transcript; verify before acting. Mode: {rep.mode}._", ""]
    if rep.unlabeled:
        out += ["> no speaker labels found in this transcript — owners unknown, "
                "items still cited by line", ""]
    decs = [it for it in rep.items if it.kind == "decision"]
    acts = [it for it in rep.items if it.kind == "action"]
    qs = [it for it in rep.items if it.kind == "question"]
    if not (decs or acts or qs):
        out.append("Nothing decidable found: no decision, action, or open-question "
                   "cue matched. The transcript is still there; grep can do the rest.")
        return "\n".join(out) + "\n"

    if decs:
        out += ["## Decisions", ""]
        for it in decs:
            head = f"{int(it.id[1:])}. "
            quote = f' — “{sanitize(it.quote, cap=160)}”' if it.quote else ""
            if it.superseded_by:
                out.append(f"{head}~~**{sanitize(it.text)}**{quote}~~ — _{_cite(it)}_ "
                           f"→ **superseded by {it.superseded_by}**")
            else:
                out.append(f"{head}**{sanitize(it.text)}**{quote} — _{_cite(it)}_"
                           + (f" _↩ replaces {it.supersedes}_" if it.supersedes else ""))
        out.append("")
    if acts:
        out += ["## Actions", ""]
        for it in acts:
            due = f" — **due {sanitize(it.due)}**" if it.due else ""
            quote = f' — “{sanitize(it.quote, cap=160)}”' if it.quote else ""
            out.append(f"- [ ] **{sanitize(it.owner or '?')}**: {sanitize(it.text)}{due}{quote} — _{_cite(it)}_")
        out.append("")
    if qs:
        out += ["## Open questions", ""]
        for it in qs:
            quote = f' — “{sanitize(it.quote, cap=160)}”' if it.quote else ""
            out.append(f"- {sanitize(it.text)}{quote} — _{_cite(it)}_")
        out.append("")
    out.append(f"_{len(decs)} decision(s) · {len(acts)} action(s) · {len(qs)} open question(s)"
               + (f" · {rep.dropped_claims} unverifiable LLM claim(s) dropped"
                  if rep.dropped_claims else "") + "_")
    return "\n".join(out) + "\n"


# ---------- process + CLI (one decode path — the trust boundary lives here) ----------

MAX_BYTES = 2 * 1024 * 1024   # 2 MB; a bigger "transcript" is not a transcript


class CannotCheck(Exception):
    pass


def merge_llm(rep: Report, llm_items: list[Item], claims_seen: int) -> None:
    """Verified LLM items join the report; cue items of the SAME kind their
    quotes prove get deduped — a question's quote must never delete a decision.
    Server + CLI both land here — two consumers, so the name lost its underscore."""
    rep.mode = "deterministic cues + LLM pass (quotes verified)"
    rep.dropped_claims = claims_seen - len(llm_items)
    pairs = [(li, fold(li.quote or "")) for li in llm_items]
    keep: list[Item] = []
    for it in rep.items:
        cover = next((li for li, q in pairs
                      if li.kind == it.kind and q and (fold(it.text) in q or q in fold(it.text))),
                     None)
        if cover is None:
            keep.append(it)
        elif it.kind == "decision" and (it.supersedes or it.superseded_by):
            # the LLM item IS this decision (its quote proves it) — the reversal
            # story must survive the model returning both sides pointer-less
            cover.supersedes = cover.supersedes or it.supersedes
            cover.superseded_by = cover.superseded_by or it.superseded_by
    rep.items = sorted(keep + llm_items, key=lambda i: (i.no or 10**9))
    # re-number decisions by final order and remap reversal pointers: LLM items
    # arrive without ids, and inserting them can reorder the cue decisions
    remap: dict[str, str] = {}
    for n, it in enumerate(x for x in rep.items if x.kind == "decision"):
        if it.id:
            remap[it.id] = f"D{n + 1}"
        it.id = f"D{n + 1}"
    live = {it.id for it in rep.items if it.kind == "decision"}
    for it in rep.items:
        if it.kind == "decision":
            it.supersedes = remap.get(it.supersedes or "", it.supersedes)
            it.superseded_by = remap.get(it.superseded_by or "", it.superseded_by)
            # a deduped twin can leave a pointer to an id that no longer renders — cut it
            it.supersedes = it.supersedes if it.supersedes in live else None
            it.superseded_by = it.superseded_by if it.superseded_by in live else None


def process_bytes(data: bytes, name: str, llm=None) -> Report:
    if len(data) > MAX_BYTES:
        raise CannotCheck(f"file is {len(data)} bytes, cap is {MAX_BYTES} — refusing to guess")
    try:
        text = data.decode("utf-8-sig")  # BOM tolerated (D04); anything else refuses loudly
    except UnicodeDecodeError as e:
        raise CannotCheck(f"not valid UTF-8 ({e}) — transcripts only, refuse to guess") from e
    rep = mine(name, parse_transcript(text))
    if llm is not None:
        try:
            llm_items, claims_seen = llm_extract(text, rep.lines, llm)
            merge_llm(rep, llm_items, claims_seen)
        except LLMError as e:
            # the cue report still ships; run() names the failure and exits 2 —
            # never a silent fallback, never a traceback (adversarial F1)
            rep.llm_error = str(e)
    return rep


def run(argv: list[str], world) -> int:
    flags: set[str] = set()
    args: list[str] = []
    out_path = None
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == "-o":
            if i + 1 >= len(argv):
                print("decision-miner: -o needs a file path\n" + USAGE, file=sys.stderr)
                return 2
            out_path = argv[i + 1]
            i += 2
            continue
        (flags.add(a) if a.startswith("-") else args.append(a))
        i += 1
    if len(args) != 1 or not flags <= {"--llm"}:
        print(USAGE, file=sys.stderr)
        return 2
    path = args[0]
    try:
        data = world.read_bytes(path)
    except OSError as e:
        print(f"decision-miner: cannot read {path}: {e}", file=sys.stderr)
        return 2
    call_llm = None
    if "--llm" in flags:
        if not (world.env("DECISION_LLM_KEY") or world.env("OPENAI_API_KEY")):
            # fail fast BEFORE any work (D05 posting-config rule): an undeliverable
            # --llm must not half-run
            print("decision-miner: --llm needs DECISION_LLM_KEY or OPENAI_API_KEY in the environment\n"
                  "(other providers: DECISION_LLM_URL for the full endpoint, or OPENAI_BASE_URL "
                  "for the api root; DECISION_LLM_MODEL, default gpt-4o-mini)", file=sys.stderr)
            return 2
        call_llm = world.llm(world.env)
    try:
        rep = process_bytes(data, path.replace("\\", "/").split("/")[-1], call_llm)
    except CannotCheck as e:
        print(f"decision-miner: {e}", file=sys.stderr)
        return 2
    md = render(rep)
    if out_path:
        try:
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(md)
        except OSError as e:
            print(f"decision-miner: cannot write {out_path}: {e}", file=sys.stderr)
            return 2
    else:
        world.out(md.rstrip() + "\n")
    if rep.llm_error:
        print(f"decision-miner: LLM pass failed — {rep.llm_error}\n"
              "(the deterministic report above is everything that could be grounded)",
              file=sys.stderr)
        return 2
    return 0 if rep.items else 1


def main() -> None:
    class RealWorld:
        read_bytes = staticmethod(lambda p: open(p, "rb").read())
        env = staticmethod(os.environ.get)
        llm = staticmethod(real_llm)
        out = staticmethod(print)
    try:
        code = run(sys.argv, RealWorld)
        sys.stdout.flush()   # surface EPIPE here, not as a shutdown "Exception ignored"
    except BrokenPipeError:
        # the reader closed the pipe (| head); the report WAS produced — die
        # quietly instead of tracebacking through the exit-flush
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        raise SystemExit(0) from None
    sys.exit(code)


if __name__ == "__main__":
    main()
