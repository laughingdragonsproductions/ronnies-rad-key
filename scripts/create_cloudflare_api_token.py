#!/usr/bin/env python3
"""Create a long-lived Cloudflare API token (Chrome Profile 8 / LDP)."""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_FILE = ROOT / ".cloudflare-ci-token.tmp"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
USER_DATA = Path.home() / "AppData/Local/Google/Chrome/User Data"
PROFILE = "Profile 8"
CDP_PORT = 9333
CREATE_URL = "https://dash.cloudflare.com/profile/api-tokens/create"
TOKEN_NAME = "github-ronnies-rad-key-ci-v2"
GOOGLE_EMAIL = "laughingdragonsproductions@gmail.com"

WORKERS_TEMPLATE = "Edit Cloudflare Workers"


def cdp_up() -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=2) as r:
            json.loads(r.read())
        return True
    except Exception:
        return False


def ensure_chrome(url: str) -> None:
    if cdp_up():
        return
    subprocess.Popen(
        [
            CHROME,
            f"--remote-debugging-port={CDP_PORT}",
            f"--user-data-dir={USER_DATA}",
            f"--profile-directory={PROFILE}",
            "--no-first-run",
            url,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(40):
        if cdp_up():
            return
        time.sleep(1)
    raise SystemExit("Chrome CDP did not start on port 9333")


def extract_token(page) -> str:
    for sel in ("input[readonly]", "textarea[readonly]", "input[type=text]"):
        loc = page.locator(sel)
        for i in range(loc.count()):
            val = (loc.nth(i).input_value() or "").strip()
            if len(val) >= 40 and not val.startswith("http"):
                return val
    body = page.inner_text("body")
    m = re.search(r"\b(cfut_[A-Za-z0-9_-]{20,})\b", body)
    if m:
        return m.group(1)
    return ""


def ensure_cloudflare_session(page) -> None:
    page.goto(CREATE_URL, wait_until="domcontentloaded", timeout=120_000)
    page.wait_for_timeout(2500)
    if "login" not in page.url.lower():
        return
    saved = page.get_by_text(GOOGLE_EMAIL, exact=False)
    if saved.count():
        saved.first.click()
        page.wait_for_timeout(6000)
    else:
        for label in ("Continue with Google", "Continue with GitHub"):
            btn = page.get_by_role("button", name=label)
            if btn.count():
                btn.first.click()
                page.wait_for_timeout(4000)
                break
        if "accounts.google.com" in page.url:
            account = page.get_by_text(GOOGLE_EMAIL, exact=False)
            if account.count():
                account.first.click()
                page.wait_for_timeout(5000)
    page.wait_for_timeout(3000)
    if "login" in page.url.lower():
        raise SystemExit("Not logged into Cloudflare in Chrome Profile 8 (complete Google sign-in once).")


def open_create_token_wizard(page) -> None:
    create = page.get_by_role("button", name="Create Token")
    if create.count():
        create.first.click()
        page.wait_for_timeout(2000)


def use_workers_template(page) -> None:
    label = page.get_by_text(WORKERS_TEMPLATE, exact=True)
    if not label.count():
        raise SystemExit(f"Could not find template row: {WORKERS_TEMPLATE}")
    row = label.first.locator("xpath=ancestor::*[self::tr or self::div][1]")
    btn = row.get_by_role("button", name="Use template")
    if not btn.count():
        btn = label.first.locator("xpath=following::button[contains(., 'Use template')][1]")
    btn.first.click()
    page.wait_for_timeout(2000)


def main() -> int:
    ensure_chrome(CREATE_URL)
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
        ctx = browser.contexts[0]
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        ensure_cloudflare_session(page)
        page.goto(CREATE_URL, wait_until="domcontentloaded", timeout=120_000)
        page.wait_for_timeout(2000)
        open_create_token_wizard(page)
        use_workers_template(page)

        name = page.get_by_label("Token name")
        if name.count():
            name.fill(TOKEN_NAME)

        combos = page.get_by_role("combobox")
        # Account Resources (Include + pick account)
        combos.nth(40).click()
        page.wait_for_timeout(400)
        for label in (
            "Laughingdragonsproductions@gmail.com's Account",
            "Laughingdragonsproductions",
            "All accounts",
        ):
            opt = page.get_by_role("option", name=label)
            if opt.count():
                opt.first.click()
                break
        page.wait_for_timeout(400)
        # Zone Resources → All zones
        combos.nth(42).click()
        page.wait_for_timeout(400)
        all_z = page.get_by_role("option", name="All zones")
        if all_z.count():
            all_z.first.click()
        page.wait_for_timeout(400)

        for btn_label in ("Continue to summary", "Continue"):
            btn = page.get_by_role("button", name=btn_label)
            if btn.count():
                btn.first.click()
                page.wait_for_timeout(2000)
                break

        create = page.get_by_role("button", name="Create Token")
        if create.count():
            create.first.click()
            page.wait_for_timeout(5000)

        token = extract_token(page)
        if not token:
            shot = ROOT / "cloudflare-token-debug.png"
            page.screenshot(path=str(shot), full_page=True)
            print(f"Could not read token — see {shot}", file=sys.stderr)
            return 1

        OUT_FILE.write_text(token, encoding="utf-8")
        print(f"Wrote token to {OUT_FILE.name}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
