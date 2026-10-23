"""JSON-RPC 2.0 over stdio, one JSON object per line. Methods `health` and `convert` as in packages/schema/src/worker.ts.

stdout carries only JSON-RPC messages. Logs and progress text go to stderr. While a convert runs, progress is also
sent as notifications: `{"jsonrpc":"2.0","method":"progress","params":{"id":<request id>,"message":"...","fraction":0.4}}`.
"""

from __future__ import annotations

import json
import os
import queue
import sys
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from importlib.metadata import PackageNotFoundError, version
from typing import Any, TextIO

from . import VERSION, convert, grobid, log, models, quality
from .errors import ConvertError

PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL = -32700, -32600, -32601, -32602, -32603
SERVER_ERROR = -32000  # ConvertError, data carries the AgentError


def _ver(pkg: str) -> str:
    try:
        return version(pkg)
    except PackageNotFoundError:
        return "missing"


def health(_params: dict[str, Any]) -> dict[str, Any]:
    engines = {
        "docling": _ver("docling"),
        "docling-models": ", ".join(f"{k.split('/')[-1]} {v}" for k, v in models.docling_model_status().items()),
        "pypdf": _ver("pypdf"),
        "trafilatura": _ver("trafilatura"),
        "lxml": _ver("lxml"),
        "ocr": f"apple-vision (ocrmac {_ver('ocrmac')})" if sys.platform == "darwin" else "rapidocr",
        "text-quality": "nsspellchecker" if quality.available() else "unavailable",
        "grobid": grobid.status(),
        "formulas": os.environ.get("CITEGEIST_FORMULAS", "auto"),
    }
    ready = engines["docling"] != "missing" and engines["pypdf"] != "missing"
    return {"version": VERSION, "engines": engines, "ready": ready}


class Server:
    def __init__(self, out: TextIO, idle_seconds: float | None = None) -> None:
        self.out = out
        self.write_lock = threading.Lock()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="convert")
        self.idle_seconds = idle_seconds
        self.active_id: Any = None
        self.pending = 0

    # -- output
    def send(self, obj: dict[str, Any]) -> None:
        line = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
        with self.write_lock:
            self.out.write(line + "\n")
            self.out.flush()

    def error(self, rid: Any, code: int, message: str, data: Any = None) -> None:
        err: dict[str, Any] = {"code": code, "message": message}
        if data is not None:
            err["data"] = data
        self.send({"jsonrpc": "2.0", "id": rid, "error": err})

    # -- dispatch
    def handle_line(self, line: str) -> None:
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as e:
            self.error(None, PARSE_ERROR, f"parse error: {e}")
            return
        if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
            rid = msg.get("id") if isinstance(msg, dict) else None
            self.error(rid, INVALID_REQUEST, "invalid request: expected a JSON-RPC 2.0 object with a method")
            return
        has_id = "id" in msg
        rid = msg.get("id")
        method = msg["method"]
        params = msg.get("params") or {}
        if method == "health":
            self.run(rid, has_id, health, params)
        elif method == "convert":
            self.pending += 1
            self.pool.submit(self.run_convert, rid, has_id, params)
        else:
            if has_id:
                self.error(rid, METHOD_NOT_FOUND, f"unknown method {method!r}", {"methods": ["health", "convert"]})

    def run(self, rid: Any, has_id: bool, fn, params: dict[str, Any]) -> None:
        try:
            result = fn(params)
        except Exception as e:  # noqa: BLE001
            self.fail(rid, has_id, e)
            return
        if has_id:
            self.send({"jsonrpc": "2.0", "id": rid, "result": result})

    def run_convert(self, rid: Any, has_id: bool, params: Any) -> None:
        try:
            if not isinstance(params, dict):
                self.error(rid, INVALID_PARAMS, "params must be an object")
                return
            self.active_id = rid
            log.set_progress_sink(lambda msg, frac: self.send(
                {"jsonrpc": "2.0", "method": "progress", "params": {"id": rid, "message": msg, "fraction": frac}}
            ))
            try:
                manifest = convert.run(params)
            finally:
                log.set_progress_sink(None)
                self.active_id = None
            if has_id:
                self.send({"jsonrpc": "2.0", "id": rid, "result": {"manifest": manifest}})
        except Exception as e:  # noqa: BLE001
            self.fail(rid, has_id, e)
        finally:
            self.pending -= 1

    def fail(self, rid: Any, has_id: bool, e: Exception) -> None:
        if isinstance(e, ConvertError):
            if has_id:
                self.error(rid, INVALID_PARAMS if e.code == "INVALID_PARAMS" else SERVER_ERROR, f"{e.code}: {e.message}", e.detail())
            return
        traceback.print_exc(file=sys.stderr)
        if has_id:
            detail = ConvertError(
                "INTERNAL_ERROR",
                f"{type(e).__name__}: {e}",
                "Read the worker stderr log. Retry once; if it repeats, report the source file.",
                recovery="retry",
                side_effects="unknown",
            ).detail()
            self.error(rid, INTERNAL, f"INTERNAL_ERROR: {type(e).__name__}: {e}", detail)

    # -- main loop
    def serve(self, stdin: TextIO) -> None:
        lines: queue.Queue[str | None] = queue.Queue()

        def reader() -> None:
            for line in stdin:
                if line.strip():
                    lines.put(line)
            lines.put(None)

        threading.Thread(target=reader, daemon=True).start()
        while True:
            try:
                line = lines.get(timeout=self.idle_seconds)
            except queue.Empty:
                if self.pending:
                    continue
                log.progress("idle, exiting")
                break
            if line is None:
                break
            self.handle_line(line)
        self.pool.shutdown(wait=True)
