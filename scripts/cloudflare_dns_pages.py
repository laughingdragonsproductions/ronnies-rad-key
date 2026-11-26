#!/usr/bin/env python3
"""Ensure Cloudflare DNS CNAMEs point a zone apex + www at a Pages project."""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ZONE_ID = "620775f8aa22071df338fcffa852785f"
DOMAINS = ("ronnieradkey.com", "www.ronnieradkey.com")
PAGES_TARGET = "ronnies-rad-key.pages.dev"
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


def list_records() -> list[dict]:
    doc = api("GET", f"/zones/{ZONE_ID}/dns_records", None)
    return doc.get("result") or []


def ensure_cname(name: str, records: list[dict]) -> None:
    for row in records:
        if row.get("name") == name and row.get("type") == "CNAME":
            if row.get("content") == PAGES_TARGET and row.get("proxied"):
                print(f"OK {name}: already -> {PAGES_TARGET} (proxied)")
                return
            rec_id = row["id"]
            api(
                "PATCH",
                f"/zones/{ZONE_ID}/dns_records/{rec_id}",
                {
                    "type": "CNAME",
                    "name": name,
                    "content": PAGES_TARGET,
                    "ttl": 1,
                    "proxied": True,
                },
            )
            print(f"OK {name}: updated -> {PAGES_TARGET}")
            return
    doc = api(
        "POST",
        f"/zones/{ZONE_ID}/dns_records",
        {
            "type": "CNAME",
            "name": name,
            "content": PAGES_TARGET,
            "ttl": 1,
            "proxied": True,
        },
    )
    print(f"OK {name}: created -> {PAGES_TARGET} ({doc.get('success')})")


def main() -> int:
    records = list_records()
    for name in DOMAINS:
        ensure_cname(name, records)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())