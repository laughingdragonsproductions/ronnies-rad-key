#!/usr/bin/env python3
"""Create a long-lived Cloudflare API token for GitHub Actions (Pages deploy)."""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ACCOUNT_ID = "d3d0d817a23ee9ca53fc6bbbbf22cc0f"
TOKEN_NAME = "github-ronnies-rad-key-ci"
WRANGLER_CONFIG = Path.home() / "AppData/Roaming/xdg.config/.wrangler/config/default.toml"
NEEDED = {"Cloudflare Pages", "Workers Scripts", "Account Settings"}


def load_oauth() -> str:
    text = WRANGLER_CONFIG.read_text(encoding="utf-8")
    m = re.search(r'oauth_token\s*=\s*"([^"]+)"', text)
    if not m:
        raise SystemExit("No wrangler oauth_token — run: npx wrangler login")
    return m.group(1)


def api(method: str, path: str, bearer: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4{path}",
        method=method,
        headers={
            "Authorization": f"Bearer {bearer}",
            "Content-Type": "application/json",
        },
        data=json.dumps(body).encode() if body is not None else None,
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def pick_groups(bearer: str) -> list[dict]:
    doc = api("GET", "/user/tokens/permission_groups", bearer)
    groups = doc.get("result") or []
    chosen: list[dict] = []
    for g in groups:
        name = g.get("name") or ""
        if name in NEEDED or name == "Cloudflare Pages":
            chosen.append({"id": g["id"], "name": name})
    # Fallback: any group whose name mentions Pages or Workers write
    if not chosen:
        for g in groups:
            name = (g.get("name") or "").lower()
            if "pages" in name and "read" not in name:
                chosen.append({"id": g["id"], "name": g.get("name")})
    if not chosen:
        raise SystemExit("Could not resolve Cloudflare permission groups for Pages CI")
    # Dedupe by id
    seen: set[str] = set()
    out: list[dict] = []
    for c in chosen:
        if c["id"] in seen:
            continue
        seen.add(c["id"])
        out.append({"id": c["id"]})
    return out


def create_ci_token(bearer: str) -> str:
    groups = pick_groups(bearer)
    body = {
        "name": TOKEN_NAME,
        "policies": [
            {
                "effect": "allow",
                "resources": {f"com.cloudflare.api.account.{ACCOUNT_ID}": "*"},
                "permission_groups": groups,
            }
        ],
    }
    doc = api("POST", "/user/tokens", bearer, body)
    if not doc.get("success"):
        raise SystemExit(f"Token create failed: {doc.get('errors')}")
    value = (doc.get("result") or {}).get("value")
    if not value:
        raise SystemExit("Token create returned no value")
    return value


def main() -> int:
    bearer = load_oauth()
    try:
        token = create_ci_token(bearer)
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="replace")
        print(err, file=sys.stderr)
        return 1
    # Write to a temp file for gh secret set (avoid printing token)
    out = Path(__file__).resolve().parents[1] / ".cloudflare-ci-token.tmp"
    out.write_text(token, encoding="utf-8")
    print(f"Wrote {out.name} (delete after setting GitHub secret)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
