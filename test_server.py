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


    def test_exotic_methods_405(self):
        # Copilot round-2: PROPFIND/LOCK/etc must also be JSON 405, not 501.
        for method in ("PROPFIND", "LOCK", "MKCOL"):
            conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
            try:
                conn.request(method, "/api/runs")
                resp = conn.getresponse()
                self.assertEqual(resp.status, 405, f"{method} must be 405")
                data = json.loads(resp.read().decode("utf-8"))
                self.assertIn("error", data)  # JSON, not HTML
            finally:
                conn.close()

    def test_overlong_run_id_no_crash(self):
        # Copilot round-2: path lookup failures must return JSON, not crash.
        # The exact status depends on the OS (404 unknown-run, 400 invalid,
        # or 200 per-source error) — the invariant is a JSON error, no crash.
        status, data = self.request("GET", "/api/ledger?run=" + "a" * 5000)
        self.assertIn(status, (200, 400, 404))
        self.assertIsInstance(data, dict)
        self.assertIn("error", data)

    def test_symlinked_root_no_path_leak(self):
        # Copilot round-2: relative/symlinked FACTORY_ROOT must not leak
        # absolute paths in error responses (root resolved at bind time).
        link = Path(self._tmp.name) / "root-link"
        link.symlink_to(self.root)
        httpd = server.make_server(link, port=0)
        port = httpd.server_address[1]
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        findings = self.root / "state" / "findings.jsonl"
        backup = findings.with_suffix(".jsonl.bak2")
        findings.rename(backup)
        backup.chmod(0o000)
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            conn.request("GET", "/api/findings")
            resp = conn.getresponse()
            data = json.loads(resp.read().decode("utf-8"))
            conn.close()
            self.assertIn("error", data)
            self.assertNotIn(str(self.root), data["error"])
            self.assertNotIn(str(link), data["error"])
        finally:
            backup.chmod(0o644)
            backup.rename(findings)
            httpd.shutdown()
            httpd.server_close()
            t.join(timeout=5)
            link.unlink()


    def test_dns_rebinding_host_refused(self):
        # Copilot round-3: a hostile Host header (DNS rebinding) must be 403,
        # while loopback Hosts are allowed. http.client sends Host automatically
        # from the connect address, so override it explicitly.
        for evil_host in ("evil.example.com", "attacker.test:8765"):
            conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
            try:
                conn.request("GET", "/api/runs", headers={"Host": evil_host})
                resp = conn.getresponse()
                self.assertEqual(resp.status, 403, f"Host {evil_host} must be 403")
                resp.read()
            finally:
                conn.close()
        # loopback Host with a port is allowed
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.request("GET", "/api/runs", headers={"Host": f"localhost:{self.port}"})
            resp = conn.getresponse()
            self.assertEqual(resp.status, 200)
            resp.read()
        finally:
            conn.close()


    def test_nonfinite_source_yields_error(self):
        # Copilot round-4: NaN/Infinity/1e309 in source must produce the
        # documented per-source error (valid JSON), not bare NaN tokens.
        run = self.root / "runs" / "run-nonfinite"
        run.mkdir(parents=True, exist_ok=True)
        ledger = run / "ledger.jsonl"
        for bad in ('{"x": NaN}', '{"x": Infinity}', '{"x": 1e309}'):
            ledger.write_text(bad + "\n", encoding="utf-8")
            status, data = self.request("GET", "/api/ledger?run=run-nonfinite")
            self.assertEqual(status, 200)
            self.assertIsInstance(data, dict)
            self.assertIn("error", data, f"{bad} must yield per-source error")
        ledger.unlink()
        run.rmdir()


if __name__ == "__main__":
    unittest.main()
