#!/usr/bin/env python3
"""DSH-1 thin data server: read-only JSONL access for the factory dashboard.

Python 3 stdlib only. Binds 127.0.0.1 only; opens source files for reading
only; never writes factory state. Endpoints (GET only, anything else 405):

  /api/runs            -> JSON list of run ids that have a ledger.jsonl
  /api/ledger?run=<id> -> JSON array of that run's ledger rows
  /api/findings        -> JSON array of findings rows

Sources are read fresh on every request from FACTORY_ROOT (default
~/Work/software-factory): runs/*/ledger.jsonl and state/findings.jsonl.
A corrupt/unreadable source yields 200 {"error": "<file>: <reason>"} —
never a crash, never partial or fabricated rows.
"""

import argparse
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

DEFAULT_FACTORY_ROOT = os.path.expanduser("~/Work/software-factory")
DEFAULT_PORT = 8765
# Run ids are plain directory names: no separators, no dot-only names.
RUN_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")


def _reject_nonfinite(value):
    """json.loads parse_constant hook: NaN/Infinity/-Infinity are not valid
    JSON and would re-serialize as bare tokens, breaking response.json()."""
    raise ValueError(f"non-finite JSON constant: {value}")


def _no_overflow_float(s):
    """parse_float hook: a literal like 1e309 parses to inf; reject it."""
    f = float(s)
    if f != f or f in (float("inf"), float("-inf")):
        raise ValueError(f"non-finite JSON number: {s}")
    return f


def read_jsonl(path):
    """Parse a JSONL file into a list of rows.

    Returns (rows, None) on success or (None, "<file>: <reason>") on any
    read/parse failure. All-or-nothing: a corrupt line means no rows.
    Non-finite numbers (NaN/Infinity/overflow) are rejected so responses
    are always valid JSON (Copilot round-4 finding).
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            rows = []
            for line in fh:
                line = line.strip()
                if line:
                    rows.append(json.loads(
                        line, parse_constant=_reject_nonfinite,
                        parse_float=_no_overflow_float))
        return rows, None
    except (OSError, ValueError, UnicodeDecodeError) as exc:
        return None, f"{path}: {exc}"


class DashboardHandler(BaseHTTPRequestHandler):
    """GET-only handler; factory_root is injected by make_server."""

    factory_root: Path  # bound per-server by make_server()

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _refuse_non_get(self):
        self.send_response(405)
        self.send_header("Allow", "GET")  # RFC 7231: 405 MUST list allowed methods
        body = json.dumps({"error": "method not allowed: read-only GET API"}).encode("utf-8")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        # HEAD responses MUST NOT include a body (RFC 7231 §4.3.2).
        if self.command != "HEAD":
            self.wfile.write(body)

    def __getattr__(self, name):
        # Catch-all: ANY do_<METHOD> other than do_GET (including PROPFIND,
        # LOCK, or any exotic method) gets the JSON 405, never the base
        # class's HTML 501. Copilot round-2 finding.
        if name.startswith("do_") and name != "do_GET":
            return self._refuse_non_get
        raise AttributeError(name)

    def do_GET(self):
        # DNS-rebinding defense (Copilot round-3): loopback binding alone
        # does not stop a hostile page rebindng its hostname to 127.0.0.1.
        # Reject any Host header that is not a trusted loopback authority.
        if not self._host_allowed():
            self._send_json(403, {"error": "forbidden: untrusted Host header"})
            return
        try:
            parsed = urlparse(self.path)
        except ValueError as exc:
            # Malformed request target (e.g. bad IPv6 authority) -> JSON 400,
            # never an uncaught exception (Copilot round-5 finding).
            self._send_json(400, {"error": f"malformed request target: {exc}"})
            return
        if parsed.path == "/api/runs":
            self._runs()
        elif parsed.path == "/api/ledger":
            self._ledger(parse_qs(parsed.query))
        elif parsed.path == "/api/findings":
            self._findings()
        else:
            self._send_json(404, {"error": f"unknown endpoint: {parsed.path}"})

    def _host_allowed(self):
        """Allow only loopback Host authorities (localhost / 127.0.0.1 / [::1]),
        with any port. A missing Host header is refused (HTTP/1.1 requires it)."""
        host = self.headers.get("Host", "")
        if not host:
            return False
        # strip port: handle host:port, [::1]:port, bare host
        if host.startswith("["):
            hostname = host.split("]")[0] + "]"
        else:
            hostname = host.rsplit(":", 1)[0] if ":" in host else host
        return hostname.lower() in ("localhost", "127.0.0.1", "[::1]", "::1")

    def _runs(self):
        runs_dir = self.factory_root / "runs"
        try:
            ids = sorted(
                entry.name for entry in runs_dir.iterdir()
                if entry.is_dir() and RUN_ID_RE.fullmatch(entry.name)
                and (entry / "ledger.jsonl").is_file()
            )
        except OSError as exc:
            self._send_json(200, {"error": self._rel_error(f"{runs_dir}: {exc}")})
            return
        self._send_json(200, ids)

    def _ledger(self, query):
        run_ids = query.get("run", [])
        if not run_ids or not run_ids[0]:
            self._send_json(400, {"error": "missing required query parameter: run"})
            return
        run = run_ids[0]
        # Refuse traversal: ids must be plain directory names (parse_qs has
        # already percent-decoded), and the resolved path must stay inside
        # runs/ as a second line of defense. Lookup failures (e.g. overlong
        # ids raising OSError) return the per-source error, never a crash.
        if not RUN_ID_RE.fullmatch(run) or run in (".", ".."):
            self._send_json(400, {"error": f"invalid run id: {run!r}"})
            return
        try:
            runs_dir = (self.factory_root / "runs").resolve()
            ledger = (runs_dir / run / "ledger.jsonl").resolve()
            if not ledger.is_relative_to(runs_dir):
                self._send_json(400, {"error": f"invalid run id: {run!r}"})
                return
            if not ledger.is_file():
                self._send_json(404, {"error": f"unknown run: {run}"})
                return
        except OSError as exc:
            self._send_json(200, {"error": self._rel_error(f"runs/{run}/ledger.jsonl: {exc}")})
            return
        rows, error = read_jsonl(ledger)
        if error is not None:
            self._send_json(200, {"error": self._rel_error(error)})
            return
        self._send_json(200, rows)

    def _findings(self):
        findings = self.factory_root / "state" / "findings.jsonl"
        rows, error = read_jsonl(findings)
        if error is not None:
            self._send_json(200, {"error": self._rel_error(error)})
            return
        self._send_json(200, rows)

    def _rel_error(self, error):
        """Render '<file>: <reason>' with ALL absolute FACTORY_ROOT paths
        stripped — including paths embedded in OS exception messages (F2)."""
        prefix = str(self.factory_root) + os.sep
        error = error.replace(prefix, "")
        # OS exceptions quote the path independently: '/abs/path/file'
        error = error.replace(f"'{prefix}", "'")
        return error

    def log_message(self, format, *args):  # keep test/CI output quiet
        pass


def make_server(factory_root, port=DEFAULT_PORT):
    """Create a loopback-only server rooted at factory_root (a Path).

    The root is RESOLVED here so source paths and _rel_error redaction use
    the same prefix even when FACTORY_ROOT is relative or symlinked
    (Copilot round-2 finding)."""
    handler = type("BoundHandler", (DashboardHandler,),
                   {"factory_root": Path(factory_root).resolve()})
    return ThreadingHTTPServer(("127.0.0.1", port), handler)


def main():
    parser = argparse.ArgumentParser(description="Factory dashboard read-only data server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help=f"loopback port (default {DEFAULT_PORT})")
    args = parser.parse_args()
    root = Path(os.environ.get("FACTORY_ROOT", DEFAULT_FACTORY_ROOT))
    httpd = make_server(root, args.port)
    host, port = httpd.server_address[:2]
    print(f"factory dashboard data server: http://{host}:{port} (FACTORY_ROOT={root})")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
