#!/usr/bin/env python3
"""docs_drift — fail CI when the OpenAPI spec you ship disagrees with the app you run.

Compares a committed spec file against what the FastAPI app *actually* serves,
by asking the app for its own spec (app.openapi()) — never by parsing source.
Reports undocumented endpoints, ghost endpoints, and param drift. Exits 0/1/2.

ponytail: stdlib only (argparse/json/importlib) — FastAPI is the provider under
test, not a dependency of this file. Upgrade trigger: a second subcommand or a
non-FastAPI provider (then this becomes a package with providers/).
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
from dataclasses import dataclass

# OpenAPI path-item operation keys; everything else (summary, parameters, servers…) is metadata
OPS = frozenset({"get", "put", "post", "delete", "options", "head", "patch", "trace"})


class UsageError(Exception):
    """Input we refuse to guess about: bad module, unreadable spec, wrong spec flavor."""


@dataclass
class Finding:
    level: str  # "error" | "ok"
    endpoint: str  # "GET /items/{id}"
    title: str
    detail: str = ""
    fix: str = ""


# ---------- pure logic (all of it exercised by test_drift.py) ----------

def extract(spec: dict) -> dict[tuple[str, str], dict[str, dict[str, bool]]]:
    """OpenAPI spec dict -> {(method, path): kind -> {name: required}}.
    Params merge path-item level then operation level (operation wins on the same name)."""
    out: dict[tuple[str, str], dict[str, dict[str, bool]]] = {}
    for path, item in (spec.get("paths") or {}).items():
        if not isinstance(item, dict):
            continue
        shared = _params(item.get("parameters"))
        for key, op in item.items():
            if key.lower() not in OPS or not isinstance(op, dict):
                continue
            params = {kind: dict(names) for kind, names in shared.items()}
            for kind, names in _params(op.get("parameters")).items():
                params.setdefault(kind, {}).update(names)
            out[(key.lower(), path)] = params
    return out


def _params(entries) -> dict[str, dict[str, bool]]:
    params: dict[str, dict[str, bool]] = {}
    for p in entries or []:
        if not isinstance(p, dict):
            continue  # hand-edited specs contain junk entries; skip, don't crash
        kind, name = p.get("in"), p.get("name")
        if kind and name:
            # path params are always required whatever the file says; the rest default optional
            params.setdefault(kind, {})[name] = True if kind == "path" else bool(p.get("required"))
    return params


def diff(live: dict, doc: dict) -> list[Finding]:
    """Drift between two endpoint maps (see extract).
    ponytail: only paths/methods/params compared — schema, response-model and
    description drift is invisible here. Trigger: a user report asking for it."""
    findings: list[Finding] = []
    for key in sorted(set(live) | set(doc), key=lambda k: (k[1], k[0])):
        method, path = key
        label = f"{method.upper()} {path}"
        if key not in doc:
            findings.append(Finding("error", label, "undocumented",
                "exists in the app, missing from the spec"))
            continue
        if key not in live:
            findings.append(Finding("error", label, "ghost",
                "documented, but the app doesn't serve it",
                fix=f"remove {method.upper()} {path} from the spec, or restore the route"))
            continue
        for kind in sorted(set(live[key]) | set(doc[key])):
            lp, dp = live[key].get(kind, {}), doc[key].get(kind, {})
            for name in sorted(set(lp) - set(dp)):
                findings.append(Finding("error", label, "param drift",
                    f'{kind} param "{name}" is in the app but missing from the spec'))
            for name in sorted(set(dp) - set(lp)):
                findings.append(Finding("error", label, "param drift",
                    f'{kind} param "{name}" is documented but the app ignores it'))
            for name in sorted(set(lp) & set(dp)):
                if lp[name] != dp[name]:
                    spec_says = "required" if dp[name] else "optional"
                    app_says = "required" if lp[name] else "optional"
                    findings.append(Finding("error", label, "param drift",
                        f'{kind} param "{name}": spec says {spec_says}, app says {app_says}'))
    return findings


# ---------- the world (imported app, spec file) ----------

def load_live_spec(ref: str) -> dict:
    """module:attr (uvicorn convention; attr defaults to 'app') -> its app.openapi()."""
    module_name, _, attr = ref.partition(":")
    attr = attr or "app"
    sys.path.insert(0, os.getcwd())  # same as uvicorn's --app-dir . default
    try:
        app = getattr(importlib.import_module(module_name), attr)
    except Exception as e:  # user code can raise anything at import; none of it is drift
        # (found the hard way: a real repo's app raised TypeError during FastAPI route
        # registration under newer typing-extensions — a raw stack + exit 1 would have
        # read as "docs drifted" in CI)
        raise UsageError(f'cannot import "{ref}" ({e.__class__.__name__}: {e}) — '
                         f"run from the repo root, uvicorn-style module:attr")
    openapi = getattr(app, "openapi", None)
    if not callable(openapi):
        raise UsageError(f'"{ref}" has no .openapi() — is it a FastAPI (Starlette) app?')
    spec = openapi()
    if not isinstance(spec, dict):
        raise UsageError(f'"{ref}".openapi() returned {type(spec).__name__}, not an OpenAPI document')
    return spec


def load_documented_spec(path: str) -> dict:
    try:
        text = open(path, encoding="utf-8-sig").read()  # -sig: accepts the BOM Windows/PowerShell exports carry
    except OSError as e:
        raise UsageError(f"cannot read spec: {e.strerror or e}: {path}")
    if path.endswith((".yaml", ".yml")):
        try:
            import yaml  # type: ignore
        except ImportError:
            # ponytail: YAML only if pyyaml already exists in the app's env; JSON is the native export
            raise UsageError(f"{path} is YAML but pyyaml isn't installed — "
                             "re-export the spec as JSON (app.openapi() dumps to JSON natively)")
        try:
            spec = yaml.safe_load(text)
        except yaml.YAMLError as e:
            raise UsageError(f"{path} is not valid YAML: {e}")
    else:
        try:
            spec = json.loads(text)
        except json.JSONDecodeError as e:
            raise UsageError(f"{path} is not valid JSON: line {e.lineno}, {e.msg}")
    if not isinstance(spec, dict):
        raise UsageError(f"{path} isn't an OpenAPI document (top level is {type(spec).__name__})")
    if "swagger" in spec and "openapi" not in spec:
        # ponytail: Swagger 2.0 rejected, not mangled — basePath/definitions would need translation
        raise UsageError(f"{path} is Swagger {spec['swagger']}, not OpenAPI 3; re-export from the app")
    return spec


# ---------- CLI ----------

def _paint(code: str, s: str) -> str:
    return f"\033[{code}m{s}\033[0m" if sys.stdout.isatty() and not os.environ.get("NO_COLOR") else s


def print_report(findings: list[Finding], n_live: int, export_cmd: str, ref: str, spec_path: str) -> None:
    print(f"docs-drift — {ref} vs {spec_path}\n")
    for f in findings:
        print(f' {_paint("31", "✗")} {f.endpoint} — {f.title}: {f.detail}')
        if f.fix:
            print(f'   {_paint("2", f"→ fix: {f.fix}")}')
    if findings:
        kinds: dict[str, int] = {}
        for f in findings:
            kinds[f.title] = kinds.get(f.title, 0) + 1
        breakdown = " · ".join(f"{n} {k}" for k, n in sorted(kinds.items()))
        print(f"\n{len(findings)} drift(s): {breakdown} — the spec is lying")
        if any(f.title != "ghost" for f in findings):
            print(_paint("2", f"→ fix all of the above: {export_cmd}"))
    else:
        print(f' {_paint("32", "✓")} in sync — app and spec agree on {n_live} endpoint(s)')
        if not n_live:
            print(f' {_paint("33", "!")} zero endpoints on both sides — did you point at the right app?')


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="docs_drift",
        description="Diff a committed OpenAPI spec against the app's real routes. Exits 1 on drift.")
    p.add_argument("app", help="the app, uvicorn-style: module:attr (attr defaults to 'app')")
    p.add_argument("spec", nargs="?", default="openapi.json", help="committed spec (default: openapi.json)")
    args = p.parse_args(argv)

    module, _, attr = args.app.partition(":")
    export_cmd = (f'python3 -c "import json; import {module} as m; '
                  f'print(json.dumps(m.{attr or "app"}.openapi(), indent=2))" > {args.spec}')
    try:
        live_spec = load_live_spec(args.app)
        doc_spec = load_documented_spec(args.spec)
    except UsageError as e:
        print(f"docs-drift: {e}", file=sys.stderr)
        return 2

    live, doc = extract(live_spec), extract(doc_spec)
    findings = diff(live, doc)
    print_report(findings, len(live), export_cmd, args.app, args.spec)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
