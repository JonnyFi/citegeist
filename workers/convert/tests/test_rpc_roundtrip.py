"""JSON-RPC 2.0 over stdio against a real worker subprocess."""

from __future__ import annotations

import hashlib
import json
import os
import queue
import subprocess
import sys
import threading
import time

import pytest
from conftest import fixture_pdf
from helpers import assert_docs_consistent, assert_schema_valid

from citegeist_convert import schemas


class Worker:
    def __init__(self, env=None):
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "citegeist_convert"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env={**os.environ, **(env or {})},
        )
        self.lines: queue.Queue[str] = queue.Queue()
        threading.Thread(target=self._pump, daemon=True).start()
        self.stderr: list[str] = []
        threading.Thread(target=lambda: [self.stderr.append(ln) for ln in self.proc.stderr], daemon=True).start()

    def _pump(self):
        for line in self.proc.stdout:
            self.lines.put(line)
        self.lines.put("")

    def send(self, obj):
        self.proc.stdin.write((obj if isinstance(obj, str) else json.dumps(obj)) + "\n")
        self.proc.stdin.flush()

    def recv(self, timeout=240):
        line = self.lines.get(timeout=timeout)
        assert line, "worker closed stdout"
        assert line.endswith("\n") and "\n" not in line[:-1], "one JSON object per line"
        return json.loads(line)

    def recv_response(self, rid, timeout=240):
        """Read until the response with this id arrives. Returns (response, notifications seen on the way)."""
        notes = []
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = self.recv(timeout=max(1, deadline - time.time()))
            if "method" in msg:
                notes.append(msg)
            elif msg.get("id") == rid:
                return msg, notes
            else:
                raise AssertionError(f"unexpected message {msg}")
        raise AssertionError("timeout")

    def close(self):
        self.proc.stdin.close()
        return self.proc.wait(timeout=60)


@pytest.fixture
def worker(models_ready):
    w = Worker()
    yield w
    if w.proc.poll() is None:
        w.proc.kill()


def test_protocol_errors_and_health(worker):
    worker.send({"jsonrpc": "2.0", "id": 1, "method": "health", "params": {}})
    resp, _ = worker.recv_response(1)
    result = resp["result"]
    assert resp["jsonrpc"] == "2.0"
    assert set(result) == {"version", "engines", "ready"} and isinstance(result["ready"], bool)
    assert result["engines"]["docling"] != "missing" and "grobid" in result["engines"]

    worker.send("this is not json")
    msg = worker.recv()
    assert msg["id"] is None and msg["error"]["code"] == -32700

    worker.send({"jsonrpc": "2.0", "id": 2, "method": "nope"})
    assert worker.recv_response(2)[0]["error"]["code"] == -32601

    worker.send({"jsonrpc": "2.0", "id": 3, "method": "convert", "params": {"kind": "pdf"}})
    err = worker.recv_response(3)[0]["error"]
    assert err["code"] == -32602 and err["data"]["code"] == "INVALID_PARAMS"
    assert schemas.errors("agent-error", err["data"]) == []

    params = {"sourcePath": "/does/not/exist.pdf", "source": "0123456789ab", "outDir": "/tmp/never", "kind": "pdf"}
    worker.send({"jsonrpc": "2.0", "id": 4, "method": "convert", "params": params})
    err = worker.recv_response(4)[0]["error"]
    assert err["data"]["code"] == "SOURCE_NOT_FOUND" and err["data"]["fix"]
    assert worker.close() == 0


def test_convert_round_trip_with_progress_and_concurrent_health(worker, tmp_path):
    pdf = fixture_pdf("nomos-huntington-review-1970")
    out = tmp_path / "derived"
    params = {
        "sourcePath": str(pdf),
        "source": hashlib.sha256(pdf.read_bytes()).hexdigest()[:12],
        "outDir": str(out),
        "kind": "pdf",
        "languages": ["de", "en"],
        "pageRangeHint": "257-261",
    }
    worker.send({"jsonrpc": "2.0", "id": "c1", "method": "convert", "params": params})
    worker.send({"jsonrpc": "2.0", "id": "h1", "method": "health"})
    # health answers while the convert is still running
    first, _ = worker.recv_response("h1")
    assert first["result"]["ready"] is True
    resp, notes = worker.recv_response("c1")
    assert "error" not in resp, resp
    assert schemas.errors("worker-convert-result", resp["result"]) == []
    assert resp["result"]["manifest"]["path"] == "digital"
    assert notes and all(n["method"] == "progress" and n["params"]["id"] == "c1" for n in notes)
    assert any("Converted" in n["params"]["message"] for n in notes)
    o = assert_schema_valid(out)
    assert_docs_consistent(o)
    assert [p["label"] for p in o["pages"]["pages"]] == ["257", "258", "259", "260", "261"]

    # second conversion with previousBlocks keeps the ids
    params2 = {**params, "previousBlocks": str(out / "blocks.jsonl")}
    worker.send({"jsonrpc": "2.0", "id": "c2", "method": "convert", "params": params2})
    resp2, _ = worker.recv_response("c2")
    assert any(f.startswith("id-retention:1.000") for f in resp2["result"]["manifest"]["flags"])

    # a notification (no id) gets no response, and the stream stays clean
    worker.send({"jsonrpc": "2.0", "method": "health"})
    worker.send({"jsonrpc": "2.0", "id": "h2", "method": "health"})
    assert worker.recv()["id"] == "h2"
    assert worker.close() == 0
    assert any("[progress]" in ln for ln in worker.stderr), "logs go to stderr"


def test_idle_exit(models_ready):
    w = Worker(env={"CITEGEIST_IDLE_SECONDS": "1"})
    assert w.proc.wait(timeout=60) == 0
