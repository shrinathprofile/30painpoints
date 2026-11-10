#!/usr/bin/env python3
"""decision-miner server — the drop-zone face.

  uv run --with fastapi --with uvicorn python3 server.py   # http://127.0.0.1:5210

One endpoint (POST /mine, raw body = transcript bytes — no multipart, so the
browser's fetch and curl --data-binary share one path) plus this one page.
The mining, decoding and quote-verification all live in decision_miner.py —
this file only moves bytes and never re-implements a rule.
Set DECISION_LLM_KEY/OPENAI_API_KEY to enable the LLM pass server-side;
without a key the page says "deterministic cues" and never guesses.
"""

import os

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse

import decision_miner as dm

app = FastAPI()

_PAGE = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14' font-size='14'>⛏️</text></svg>">
<title>decision-miner</title>
<style>
 body{font:15px/1.5 ui-monospace,Menlo,monospace;margin:0;background:#0f1115;color:#e6e6e6;display:flex;min-height:100vh;flex-direction:column}
 header{padding:20px 24px 8px}h1{margin:0;font-size:19px}p{margin:4px 0 0;color:#9aa3b2;font-size:13px}
 main{flex:1;display:flex;gap:14px;padding:12px 24px 24px;flex-wrap:wrap}
 .pane{flex:1 1 340px;min-width:300px;display:flex;flex-direction:column}
 textarea,#out{flex:1;background:#161a22;border:1px solid #2a3140;border-radius:8px;color:inherit;padding:12px;min-height:300px;box-sizing:border-box;white-space:pre-wrap}
 #out:empty::before{content:"report appears here — every line cites the transcript";color:#5b6472}
 #drop.drag{border-color:#7aa2f7;outline:2px dashed #7aa2f7;outline-offset:-6px}
 footer{padding:0 24px 16px;color:#5b6472;font-size:12px}
 button{background:#7aa2f7;border:0;color:#0f1115;font:inherit;font-weight:700;border-radius:6px;padding:6px 12px;margin:8px 0;cursor:pointer}
</style>
<header><h1>decision-miner</h1><p id="mode">MODE</p></header>
<main>
 <div class="pane"><textarea id="drop" placeholder="drop a .txt/.vtt meeting transcript here — or paste it and press Mine" spellcheck="false"></textarea>
  <button id="go">Mine it</button><button id="sample">Load sample</button></div>
 <div class="pane"><pre id="out"></pre></div>
</main>
<footer>transcript in, accountability out — quotes verified, unverifiable claims dropped. nothing is stored.</footer>
<script>
const drop=document.getElementById('drop'),out=document.getElementById('out');
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag')});
drop.addEventListener('dragleave',()=>drop.classList.remove('drag'));
drop.addEventListener('drop',async e=>{e.preventDefault();drop.classList.remove('drag');
 const f=e.dataTransfer.files[0];if(f)drop.value=await f.text();mine(f?f.name:'transcript')});
document.getElementById('go').onclick=()=>mine('transcript');
document.getElementById('sample').onclick=async()=>{
 drop.value=await fetch('/sample').then(r=>r.text());};
async function mine(name){
 out.textContent='mining…';
 const r=await fetch('/mine?name='+encodeURIComponent(name),{method:'POST',body:drop.value});
 const j=await r.json();
 out.textContent=j.markdown||j.detail||'';
 document.getElementById('mode').textContent=j.mode+(j.llm_error?' — '+j.llm_error:'');
}
</script>"""

_SAMPLE = """[00:01:12] Maya: Quick agenda — the DB migration, staging data, and the launch date.
[00:03:40] Maya: Okay, we'll go with Postgres then, and Arjun will own the migration.
[00:05:15] Chloe: I'll draft the migration plan by Friday.
[00:06:02] Ravi: Wait, actually — let's go with Supabase instead.
[00:10:20] Arjun: We'll archive it before the cutover. I'll write the runbook by next week.
[00:12:00] Ravi: Not sure if the CDN budget covers this.
[00:18:02] Maya: We need to decide: ship on the 15th or push to December?
[00:19:31] Maya: Final call: we're shipping on the 15th.
"""


def _llm():
    if os.environ.get("DECISION_LLM_KEY") or os.environ.get("OPENAI_API_KEY"):
        return dm.real_llm(os.environ.get)
    return None


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    mode = "LLM pass armed (quotes verified)" if _llm() else "deterministic cues — no LLM key set"
    return _PAGE.replace("MODE", "mode: " + mode)


@app.get("/sample", response_class=PlainTextResponse)
def sample() -> str:
    return _SAMPLE


@app.post("/mine")
async def mine_ep(request: Request, name: str = "transcript", raw: bool = False):
    data = await request.body()
    try:
        rep = dm.process_bytes(data, name, _llm())  # LLM failures land in rep.llm_error
    except dm.CannotCheck as e:
        detail = str(e)
        return JSONResponse({"detail": detail}, status_code=413 if "cap is" in detail else 400)
    md = dm.render(rep)
    if raw:
        return PlainTextResponse(md)
    llm_error = (f"LLM pass failed ({rep.llm_error}) — cue report below, never a silent fallback"
                 if rep.llm_error else None)
    return {"markdown": md, "mode": rep.mode, "items": len(rep.items), "llm_error": llm_error}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "5210")))
