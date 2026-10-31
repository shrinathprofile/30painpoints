"""test_drift — the one runnable check. Plain asserts, no framework APIs.

Runs both ways, same functions:
    python3 test_drift.py      # stdlib runner (days 01-03 convention)
    pytest test_drift.py -q    # stack-of-the-day runner (optional)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docs_drift import extract, diff, load_documented_spec  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable  # the venv python running this file (has fastapi)
FIX_APP = "fixtures.demo_api:app"
FIX = lambda name: os.path.join(HERE, "fixtures", name)  # noqa: E731

CLI = lambda *a: subprocess.run(  # noqa: E731
    [PY, os.path.join(HERE, "docs_drift.py"), *a],
    capture_output=True, text=True, cwd=HERE, env={**os.environ, "NO_COLOR": "1"},
)


def ep(path_params=(), query=None, header=None):
    q = query or {}
    out = {"path": dict.fromkeys(path_params, True), "query": {k: bool(v) for k, v in q.items()}}
    if header:
        out["header"] = dict(header)
    return out


def one_path_spec(path="/x", method="get", params=None):
    return {"openapi": "3.1.0", "paths": {path: {method: {"parameters": params or [], "responses": {}}}}}


# --- extract: the OpenAPI subset we normalize ---

def test_extract_merges_path_item_and_operation_params():
    spec = {"paths": {"/x": {
        "parameters": [{"in": "query", "name": "shared", "required": True}],
        "get": {"parameters": [{"in": "query", "name": "own", "required": False},
                                {"in": "query", "name": "shared", "required": False}]}}}}
    assert extract(spec)[("get", "/x")]["query"] == {"shared": False, "own": False}


def test_extract_skips_path_item_metadata_keys():
    spec = {"paths": {"/x": {"summary": "s", "description": "d", "servers": [],
                             "get": {"responses": {}}, "parameters": []}}}
    assert set(extract(spec)) == {("get", "/x")}


def test_extract_normalizes_method_case_and_skips_bad_values():
    spec = {"paths": {"/x": {"GET": {"responses": {}}}, "/y": {"post": "not-a-dict"}}}
    assert set(extract(spec)) == {("get", "/x")}


def test_path_params_always_required_query_defaults_optional():
    spec = one_path_spec("/i/{id}", "delete", [
        {"in": "path", "name": "id", "required": False},   # lying file
        {"in": "query", "name": "q"},                      # required key absent
    ])
    assert extract(spec)[("delete", "/i/{id}")] == {"path": {"id": True}, "query": {"q": False}}


def test_extract_tolerates_empty_and_missing_paths():
    assert extract({}) == {} and extract({"paths": None}) == {} and extract({"paths": {}}) == {}


# --- diff: the three drift classes, pure ---

def test_diff_undocumented_and_ghost():
    live = {("get", "/x"): {}, ("post", "/x"): {}}
    doc = {("get", "/x"): {}, ("delete", "/y"): {}}
    titles = [(f.endpoint, f.title) for f in diff(live, doc)]
    assert titles == [("POST /x", "undocumented"), ("DELETE /y", "ghost")]  # sorted by (path, method)


def test_diff_param_extra_then_required_flip_in_emission_order():
    live = {("get", "/s"): ep(query={"q": True, "limit": False})}
    doc = {("get", "/s"): ep(query={"q": True, "limit": True, "cursor": False})}
    assert [f.detail for f in diff(live, doc)] == [
        'query param "cursor" is documented but the app ignores it',
        'query param "limit": spec says required, app says optional']


def test_diff_covers_header_params_too():
    live = {("post", "/i"): ep(path_params=("id",), header={"x-token": True})}
    doc = {("post", "/i"): ep(path_params=("id",), header={"x-token": False})}
    (f,) = diff(live, doc)
    assert f.detail == 'header param "x-token": spec says optional, app says required'


def test_diff_identical_specs_is_empty():
    assert diff(extract(json.load(open(FIX("openapi-synced.json")))),
                extract(json.load(open(FIX("openapi-synced.json"))))) == []


def test_trailing_slash_and_template_rename_are_drift():
    live = extract(one_path_spec("/items"))
    doc = extract(one_path_spec("/items/"))
    assert [f.title for f in diff(live, doc)] == ["undocumented", "ghost"]  # "/items" sorts first
    doc2 = extract(one_path_spec("/items/{id}"))
    live2 = extract(one_path_spec("/items/{item_id}"))
    assert [f.title for f in diff(live2, doc2)] == ["ghost", "undocumented"]  # "{id}" < "{item_id}"


# --- end-to-end on the real fixture app ---

def test_fixture_drifted_exactly_the_five_planted_findings():
    sys.path.insert(0, HERE)
    from fixtures.demo_api import app
    live = extract(app.openapi())
    doc = extract(json.load(open(FIX("openapi-drifted.json"))))
    planted = [(f.endpoint, f.title) for f in diff(live, doc)]
    assert planted == [
        ("DELETE /items/{item_id}", "undocumented"),
        ("GET /items/{item_id}", "param drift"),
        ("GET /reports", "ghost"),
        ("GET /search", "param drift"),
        ("GET /search", "param drift"),
    ]
    ghosts = [f for f in diff(live, doc) if f.title == "ghost"]
    assert ghosts and all("remove" in g.fix for g in ghosts), "ghost findings carry their fix"


def test_fixture_synced_is_in_sync():
    sys.path.insert(0, HERE)
    from fixtures.demo_api import app
    assert diff(extract(app.openapi()),
                extract(json.load(open(FIX("openapi-synced.json"))))) == []


# --- CLI: exit codes 0 / 1 / 2, never a stack trace ---

def test_cli_drifted_exits_1_synced_exits_0():
    bad = CLI(FIX_APP, FIX("openapi-drifted.json"))
    assert bad.returncode == 1 and "5 drift(s)" in bad.stdout
    good = CLI(FIX_APP, FIX("openapi-synced.json"))
    assert good.returncode == 0 and "in sync" in good.stdout


def test_cli_usage_errors_exit_2_with_one_line_no_stack():
    cases = [
        CLI("no.such.module:app", FIX("openapi-synced.json")),
        CLI(FIX_APP, FIX("does-not-exist.json")),
        CLI(FIX_APP, os.path.join(HERE, "README.md")),          # not JSON at all
    ]
    with open(os.path.join(HERE, ".bad.json"), "w") as f:
        f.write("{ not json")
    cases.append(CLI(FIX_APP, os.path.join(HERE, ".bad.json")))
    with open(os.path.join(HERE, ".swagger2.json"), "w") as f:
        json.dump({"swagger": "2.0", "paths": {}}, f)
    cases.append(CLI(FIX_APP, os.path.join(HERE, ".swagger2.json")))
    with open(os.path.join(HERE, ".paths-list.json"), "w") as f:
        json.dump({"openapi": "3.1.0", "paths": []}, f)
    cases.append(CLI(FIX_APP, os.path.join(HERE, ".paths-list.json")))
    cases.append(CLI("--bogus-flag"))
    for r in cases:
        assert r.returncode == 2, (r.args, r.stderr)
        assert "Traceback" not in r.stderr and "\n  " not in r.stderr
    assert "cannot import" in cases[0].stderr
    assert "cannot read spec" in cases[1].stderr
    assert "not valid JSON" in cases[3].stderr
    assert "Swagger" in cases[4].stderr and "re-export" in cases[4].stderr
    assert '"paths" as list' in cases[5].stderr
    for junk in (".bad.json", ".swagger2.json", ".paths-list.json"):
        os.unlink(os.path.join(HERE, junk))


def test_app_raising_at_import_is_usage_error_not_drift():
    # regression (found on a real repo): an app that raises TypeError while FastAPI
    # registers its routes printed a stack and exited 1 — CI would read that as drift
    # (module name must be importable: a leading "." made importlib raise its own TypeError
    # before the file ran, so this check once passed without ever executing the boom)
    cases = {
        "probe_boom_import": ("raise TypeError('Too few arguments for typing.Generator')\n",
                              "Too few arguments"),
        "probe_boom_exit": ("import sys\nsys.exit(1)\n", "SystemExit"),  # config guards do this
        "probe_boom_openapi": ("from fastapi import FastAPI\napp = FastAPI()\n"
                               "def boom(): raise ValueError('schema gen failed')\n"
                               "app.openapi = boom\n", "schema gen failed"),  # lazy schema build
    }
    for mod, (src, needle) in cases.items():
        path = os.path.join(HERE, f"{mod}.py")
        with open(path, "w") as f:
            f.write(src)
        try:
            r = CLI(f"{mod}:app", FIX("openapi-synced.json"))
            assert r.returncode == 2 and needle in r.stderr, (mod, r.returncode, r.stderr)
            assert "Traceback" not in r.stderr
        finally:
            os.unlink(path)


def test_cli_yaml_needs_pyaml_or_fails_clean():
    yaml_path = os.path.join(HERE, ".tmp-spec.yaml")
    with open(FIX("openapi-drifted.json")) as src, open(yaml_path, "w") as dst:
        dst.write(src.read())
    try:
        r = CLI(FIX_APP, yaml_path)
        try:
            import yaml  # noqa: F401
            assert r.returncode == 1 and "5 drift(s)" in r.stdout  # JSON is valid YAML
        except ImportError:
            assert r.returncode == 2 and "pyyaml" in r.stderr
    finally:
        os.unlink(yaml_path)


def test_the_printed_fix_command_actually_works():
    r = CLI(FIX_APP, FIX("openapi-drifted.json"))
    fix = next(line.split("→ fix all of the above: ", 1)[1]
               for line in r.stdout.splitlines() if "→ fix all of the above:" in line)
    assert fix.startswith("python3 "), "the fix must run on machines with python3 only"
    # redirect to a throwaway target: the real command re-exports OVER the stale spec (by design)
    target = os.path.join(HERE, ".tmp-reexport.json")
    venv_path = {"PATH": f"{os.path.dirname(PY)}{os.pathsep}{os.environ['PATH']}"}  # venv active, as in real use
    exported = subprocess.run(fix.rsplit("> ", 1)[0] + f"> {target}",
                              shell=True, capture_output=True, text=True, cwd=HERE, env=venv_path)
    try:
        assert exported.returncode == 0, exported.stderr
        sys.path.insert(0, HERE)
        from fixtures.demo_api import app
        assert json.load(open(target)) == app.openapi()  # the fix reproduces the truth
    finally:
        os.unlink(target)


def test_probe_found_bugs_regressions():
    # junk entry in a parameters list: skip, don't crash (found by adversarial probe)
    spec = one_path_spec("/x", "get", [{"in": "query", "name": "q"}, "junk-entry"])
    assert extract(spec)[("get", "/x")] == {"query": {"q": False}}
    # BOM-prefixed JSON (PowerShell/Windows exports) must parse as the synced spec
    bom_path = os.path.join(HERE, ".tmp-bom.json")
    with open(FIX("openapi-synced.json"), "rb") as src:
        data = b"\xef\xbb\xbf" + src.read()
    with open(bom_path, "wb") as dst:
        dst.write(data)
    try:
        sys.path.insert(0, HERE)
        from fixtures.demo_api import app
        assert diff(extract(app.openapi()), extract(load_documented_spec(bom_path))) == []
    finally:
        os.unlink(bom_path)
    # an app whose openapi() is overridden to return None: usage error, never a crash
    null_app = os.path.join(HERE, "probe_null_openapi.py")
    with open(null_app, "w") as f:
        f.write("from fastapi import FastAPI\n"
                "app = FastAPI()\n"
                "app.openapi = lambda: None\n")
    try:
        r = CLI("probe_null_openapi:app", FIX("openapi-synced.json"))
        assert r.returncode == 2 and "returned NoneType" in r.stderr and "Traceback" not in r.stderr
    finally:
        os.unlink(null_app)


if __name__ == "__main__":
    tests = sorted((name, fn) for name, fn in globals().items() if name.startswith("test_") and callable(fn))
    for name, fn in tests:
        fn()
        print(f"  ✓ {name}")
    print(f"\nself-check: {len(tests)} checks passed ({os.path.basename(PY)})")
