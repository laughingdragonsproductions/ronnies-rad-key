#!/usr/bin/env python3
"""Attach custom domains to Cloudflare Pages project via API."""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ACCOUNT_ID = "d3d0d817a23ee9ca53fc6bbbbf22cc0f"
PROJECT = "ronnies-rad-key"
DOMAINS = ("ronniesradkey.com", "www.ronniesradkey.com")
WRANGLER_CONFIG = Path.home() / "AppData/Roaming/xdg.config/.wrangler/config/default.toml"


def bearer() -> str:
    text = WRANGLER_CONFIG.read_text(encoding="utf-8")
    m = re.search(r'oauth_token\s*=\s*"([^"]+)"', text)
    if not m:
        raise SystemExit("Run: npx wrangler login")
    return m.group(1)


def api(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4{path}",
        method=method,
        headers={
            "Authorization": f"Bearer {bearer()}",
            "Content-Type": "application/json",
        },
        data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="replace")
        raise SystemExit(f"{method} {path} failed ({e.code}): {err}") from e


def main() -> int:
    for domain in DOMAINS:
        try:
            doc = api(
                "POST",
                f"/accounts/{ACCOUNT_ID}/pages/projects/{PROJECT}/domains",
                {"name": domain},
            )
        except SystemExit as e:
            msg = str(e)
            if "8000018" in msg:
                print(f"OK {domain}: already attached")
                continue
            raise
        if not doc.get("success"):
            print(f"WARN {domain}: {doc.get('errors')}", file=sys.stderr)
        else:
            print(f"OK {domain}: {doc.get('result')}")
    listed = api("GET", f"/accounts/{ACCOUNT_ID}/pages/projects/{PROJECT}/domains")
    for row in listed.get("result") or []:
        print(" ", row.get("name"), row.get("status"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
