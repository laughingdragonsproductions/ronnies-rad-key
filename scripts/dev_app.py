#!/usr/bin/env python3
"""
Local Rad Key app — site at / plus Worker-style API on one origin.

Use instead of `python -m http.server` so search/meta/moment/rebuild work
without Cloudflare. Serves `site/` as the web root (http://127.0.0.1:8790/).
"""
from __future__ import annotations

import json
import mimetypes
import os
import subprocess
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
DATA = SITE / "data"
MOMENTS = DATA / "moments"
BUILD_SCRIPT = ROOT / "scripts" / "build_from_rcu.py"
HOST = os.environ.get("RADKEY_HOST", "127.0.0.1")
PORT = int(os.environ.get("RADKEY_PORT", "8790"))


def _search_documents(documents: list, q: str, limit: int = 12) -> list:
    terms = [t for t in q.lower().split() if t]
    if not terms:
        return []
    scored = []
    for d in documents:
        hay = f"{d.get('title', '')} {d.get('summary', '')} {d.get('strand', '')}".lower()
        score = sum(1 for t in terms if t in hay)
        if score:
            scored.append((score, d))
    scored.sort(key=lambda x: (-x[0], -(x[1].get("year") or 0)))
    return [d for _, d in scored[:limit]]


def _read_json(path: Path) -> dict | list | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _run_rebuild() -> tuple[int, str]:
    env = os.environ.copy()
    proc = subprocess.run(
        [sys.executable, str(BUILD_SCRIPT)],
        cwd=str(ROOT),
        env=env,
        capture_output=True,
        text=True,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, out.strip()


class RadKeyAppHandler(BaseHTTPRequestHandler):
    server_version = "RadKeyDev/1.0"

    def log_message(self, fmt: str, *args) -> None:
        if args and str(args[0]).startswith("GET /js/"):
            return
        super().log_message(fmt, *args)

    def _send_json(self, data, status: int = 200) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, body: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self) -> None:
        path = urllib.parse.unquote(self.path.split("?", 1)[0])
        if path == "/api/rebuild":
            code, log = _run_rebuild()
            if code != 0:
                self._send_json({"ok": False, "log": log}, status=500)
                return
            meta = _read_json(DATA / "rcu-meta.json") or {}
            self._send_json({"ok": True, "log": log, "meta": meta})
            return
        self._send_json({"error": "not found"}, 404)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        qs = urllib.parse.parse_qs(parsed.query)

        if path == "/api/search":
            q = (qs.get("q") or [""])[0]
            if len(q.strip()) < 2:
                self._send_json({"results": [], "q": q})
                return
            index = _read_json(DATA / "search-index.json") or {"documents": []}
            results = _search_documents(index.get("documents") or [], q)
            self._send_json({"results": results, "q": q})
            return

        if path == "/api/meta":
            meta = _read_json(DATA / "rcu-meta.json")
            if meta is None:
                self._send_json({"error": "rcu-meta missing — run build_from_rcu.py"}, 503)
                return
            self._send_json({**meta, "dev": True, "origin": "local"})
            return

        if path == "/api/graph":
            graph = _read_json(DATA / "graph.json")
            if graph is None:
                self._send_json({"error": "graph.json missing"}, 503)
                return
            self._send_json(graph)
            return

        if path.startswith("/api/moment/"):
            mid = path[len("/api/moment/") :].strip("/")
            if not mid or ".." in mid or "/" in mid:
                self._send_json({"error": "invalid id"}, 400)
                return
            detail = _read_json(MOMENTS / f"{mid}.json")
            if detail is None:
                self._send_json({"error": "not found"}, 404)
                return
            self._send_json(detail)
            return

        if path == "/api/health":
            tl = _read_json(DATA / "timeline.json") or {}
            self._send_json(
                {
                    "ok": True,
                    "moments": len(tl.get("moments") or []),
                    "schema_version": tl.get("schema_version"),
                    "rcu_db": os.environ.get("RCU_DB") or os.environ.get("RCU_DATA"),
                }
            )
            return

        if path in ("", "/"):
            path = "/index.html"

        rel = path.lstrip("/")
        file_path = (SITE / rel).resolve()
        try:
            file_path.relative_to(SITE.resolve())
        except ValueError:
            self._send_json({"error": "not found"}, 404)
            return

        if file_path.is_dir():
            file_path = file_path / "index.html"
        if not file_path.is_file():
            self._send_json({"error": "not found"}, 404)
            return

        ctype, _ = mimetypes.guess_type(str(file_path))
        ctype = ctype or "application/octet-stream"
        body = file_path.read_bytes()
        self._send_bytes(body, ctype)


def main() -> None:
    if not DATA.is_dir():
        print("site/data missing — run: py scripts/build_from_rcu.py", file=sys.stderr)
        sys.exit(1)

    httpd = ThreadingHTTPServer((HOST, PORT), RadKeyAppHandler)
    url = f"http://{HOST}:{PORT}/"
    print(f"Ronnie's Rad Key (local app) -> {url}")
    print("  API: /api/search  /api/meta  /api/moment/:id  /api/graph  POST /api/rebuild")
    print("  RCU_DB:", os.environ.get("RCU_DB") or os.environ.get("RCU_DATA") or "(default path in build script)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        httpd.server_close()


if __name__ == "__main__":
    main()
