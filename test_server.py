"""DSH-1 server tests: happy paths, 405, 404, traversal, corrupt-file format.

Runs the real server (stdlib http.server) on an ephemeral loopback port
against a temporary FACTORY_ROOT fixture. Read-only: fixtures are created
by the tests, never by the server.
"""

import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

import server

LEDGER_ROWS = [
    {"event": "dispatch_completed", "ts": "2026-11-15T10:00:00Z", "story": "SKEL-1",
     "role": "coder", "repo": "media-ingestion-engine", "model": "test-model",
     "tokens": {"in": 100, "out": 200}, "cost_usd": None, "wall_s": 12.5,
     "human_min": None, "outcome": "ok"},
    {"event": "loop_converged", "ts": "2026-11-15T10:05:00Z", "story": "SKEL-1",
     "detail": {"rounds": 2}},
]

FINDINGS_ROWS = [
    {"ts": "2026-11-15T11:00:00Z", "repo": "media-ingestion-engine", "pr": 14,
     "round": 1, "source": "gate", "klass": "bug", "severity": "major",
     "summary": "off-by-one in retry loop", "escaped_gate": True,
     "escaped_review": False, "verified": True, "disposition": "fixed"},
    {"ts": "2026-11-15T11:01:00Z", "repo": "media-ingestion-engine", "pr": 14,
     "round": 1, "source": "review", "klass": "false-positive", "severity": "nit",
     "summary": "RESOLVED naming nit", "escaped_gate": False,
     "escaped_review": True, "verified": False, "disposition": "rejected"},
]


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls._tmp.name)
        write_jsonl(cls.root / "runs" / "run-a" / "ledger.jsonl", LEDGER_ROWS)
        (cls.root / "runs" / "run-no-ledger").mkdir(parents=True)  # excluded from /api/runs
        (cls.root / "runs" / "run-corrupt").mkdir(parents=True)
        (cls.root / "runs" / "run-corrupt" / "ledger.jsonl").write_text(
            '{"event": "ok"}\nnot json at all\n', encoding="utf-8")
        write_jsonl(cls.root / "state" / "findings.jsonl", FINDINGS_ROWS)
        cls.httpd = server.make_server(cls.root, port=0)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=5)
        cls._tmp.cleanup()

    def request(self, method, path, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.request(method, path, body=body)
            resp = conn.getresponse()
            return resp.status, json.loads(resp.read().decode("utf-8"))
        finally:
            conn.close()

    def test_runs_list(self):
        status, data = self.request("GET", "/api/runs")
        self.assertEqual(status, 200)
        self.assertEqual(data, ["run-a", "run-corrupt"])  # only dirs with a ledger.jsonl

    def test_ledger_rows(self):
        status, data = self.request("GET", "/api/ledger?run=run-a")
        self.assertEqual(status, 200)
        self.assertEqual(data, LEDGER_ROWS)

    def test_findings_rows(self):
        status, data = self.request("GET", "/api/findings")
        self.assertEqual(status, 200)
        self.assertEqual(data, FINDINGS_ROWS)

    def test_non_get_405(self):
        for method, path in [("POST", "/api/runs"), ("POST", "/api/findings"),
                             ("PUT", "/api/ledger?run=run-a"), ("DELETE", "/api/runs")]:
            status, data = self.request(method, path, body="{}")
            self.assertEqual(status, 405, f"{method} {path}")
            self.assertIn("error", data)

    def test_unknown_run_404(self):
        status, data = self.request("GET", "/api/ledger?run=does-not-exist")
        self.assertEqual(status, 404)
        self.assertIn("error", data)
        self.assertIsInstance(data["error"], str)

    def test_traversal_refused(self):
        for run in ["../../state", "..%2F..%2Fstate", "..", "run-a/../../state"]:
            status, data = self.request("GET", f"/api/ledger?run={run}")
            self.assertIn(status, (400, 404), f"run={run!r} was not refused")
            self.assertIn("error", data)
            self.assertNotIsInstance(data, list)  # never leak rows

    def test_missing_run_param(self):
        status, data = self.request("GET", "/api/ledger")
        self.assertEqual(status, 400)
        self.assertIn("error", data)

    def test_corrupt_ledger_error_format(self):
        status, data = self.request("GET", "/api/ledger?run=run-corrupt")
        self.assertEqual(status, 200)
        self.assertIsInstance(data, dict)
        self.assertIn("error", data)
        self.assertTrue(data["error"].startswith("runs/run-corrupt/ledger.jsonl: "),
                        f"error must be '<file>: <reason>', got {data['error']!r}")
        self.assertNotIn("rows", data)  # no partial/fabricated rows

    def test_corrupt_findings_error_format(self):
        findings = self.root / "state" / "findings.jsonl"
        original = findings.read_text(encoding="utf-8")
        findings.write_text("{broken json\n", encoding="utf-8")
        try:
            status, data = self.request("GET", "/api/findings")
        finally:
            findings.write_text(original, encoding="utf-8")
        self.assertEqual(status, 200)
        self.assertIsInstance(data, dict)
        self.assertTrue(data["error"].startswith("state/findings.jsonl: "),
                        f"error must be '<file>: <reason>', got {data['error']!r}")

    def test_unreadable_source_error_format(self):
        findings = self.root / "state" / "findings.jsonl"
        findings.rename(findings.with_suffix(".jsonl.bak"))
        try:
            status, data = self.request("GET", "/api/findings")
        finally:
            findings.with_suffix(".jsonl.bak").rename(findings)
        self.assertEqual(status, 200)
        self.assertIsInstance(data, dict)
        self.assertTrue(data["error"].startswith("state/findings.jsonl: "))


    def test_trace_and_connect_405(self):
        # F3 regression: AC says ANY non-GET -> 405 (was 501 for TRACE/CONNECT).
        for method in ("TRACE", "CONNECT"):
            conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
            try:
                conn.request(method, "/api/runs")
                resp = conn.getresponse()
                self.assertEqual(resp.status, 405, f"{method} must be 405")
                resp.read()
            finally:
                conn.close()

    def test_runs_excludes_hidden_dirs(self):
        # F4 regression: /api/runs must apply RUN_ID_RE (no .hidden dirs).
        hidden = self.root / "runs" / ".hidden"
        hidden.mkdir(parents=True, exist_ok=True)
        write_jsonl(hidden / "ledger.jsonl", LEDGER_ROWS)
        try:
            status, data = self.request("GET", "/api/runs")
            self.assertEqual(status, 200)
            self.assertNotIn(".hidden", data)
        finally:
            (hidden / "ledger.jsonl").unlink()
            hidden.rmdir()

    def test_error_no_absolute_path_leak(self):
        # F1/F2 regression: error responses must not contain the absolute
        # FACTORY_ROOT path, including inside OS exception messages.
        findings = self.root / "state" / "findings.jsonl"
        backup = findings.with_suffix(".jsonl.bak")
        findings.rename(backup)
        backup.chmod(0o000)
        try:
            status, data = self.request("GET", "/api/findings")
            self.assertEqual(status, 200)
            self.assertIn("error", data)
            self.assertNotIn(str(self.root), data["error"],
                             "absolute path leaked in error")
        finally:
            backup.chmod(0o644)
            backup.rename(findings)


if __name__ == "__main__":
    unittest.main()
