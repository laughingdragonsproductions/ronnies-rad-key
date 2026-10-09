#!/usr/bin/env python3
"""Headless browser smoke test for Rad Key (helix + data load)."""
from __future__ import annotations

import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790/"


def main() -> int:
    errors: list[str] = []
    console_errors: list[str] = []
    failed_urls: list[str] = []

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("smoke_browser: SKIP — playwright not installed")
        return 0

    with sync_playwright() as p:
        browser = None
        for channel in ("msedge", "chrome", None):
            try:
                kwargs = {"headless": True}
                if channel:
                    kwargs["channel"] = channel
                browser = p.chromium.launch(**kwargs)
                break
            except Exception:
                continue
        if not browser:
            print("smoke_browser: SKIP — no Playwright browser (install chromium or use Edge)")
            return 0

        page = browser.new_page()
        def on_response(resp):
            if resp.status >= 400 and resp.url.startswith(BASE.rstrip("/")):
                failed_urls.append(f"{resp.status} {resp.url}")

        page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
        page.on(
            "console",
            lambda msg: console_errors.append(msg.text) if msg.type == "error" else None,
        )
        page.on("response", on_response)

        try:
            page.goto(BASE, wait_until="networkidle", timeout=90_000)
        except Exception as e:
            print(f"smoke_browser: FAIL navigation — {e}")
            browser.close()
            return 1

        page.wait_for_timeout(3500)

        state = page.evaluate(
            """() => {
              const canvas = document.getElementById('helix-canvas');
              const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
              return {
                title: document.title,
                noWebgl: document.body.classList.contains('no-webgl'),
                hasWebGL: !!gl,
                canvasW: canvas ? canvas.width : 0,
                canvasH: canvas ? canvas.height : 0,
                year: document.getElementById('year-display')?.textContent?.trim(),
                slider: document.getElementById('key-slider')?.value,
              };
            }"""
        )

        # Exercise Rad Key scrub
        page.locator("#key-slider").fill("60")
        page.wait_for_timeout(800)
        year_after = page.locator("#year-display").inner_text()

        browser.close()

    print("smoke_browser state:", state)
    print("smoke_browser year after scrub:", year_after.strip())

    if errors:
        print("smoke_browser FAIL exceptions:")
        for e in errors:
            print(" ", e)
    if failed_urls:
        print("smoke_browser HTTP errors:")
        for u in failed_urls[:20]:
            print(" ", u)
    if console_errors:
        print("smoke_browser console errors:")
        for e in console_errors:
            print(" ", e)

    critical_http = [u for u in failed_urls if "/data/" in u or "/js/" in u or "timeline.json" in u]
    if critical_http:
        print("smoke_browser: FAIL — missing critical assets")
        return 1

    if errors:
        return 1

    # 404 on optional thumbs/embeds are warnings only
    if console_errors and not all("404" in e for e in console_errors):
        return 1

    if state.get("noWebgl") and not state.get("hasWebGL"):
        print("smoke_browser: WebGL unavailable — helix skipped (check GPU/headless)")
        return 0

    if not state.get("canvasW") or not state.get("canvasH"):
        print("smoke_browser: FAIL — canvas not sized")
        return 1

    if not year_after.strip() or year_after.strip() == "—":
        print("smoke_browser: FAIL — year display did not update on scrub")
        return 1

    print("smoke_browser: OK")
    return 0


if __name__ == "__main__":
    # Quick reachability
    try:
        urllib.request.urlopen(BASE, timeout=5)
    except Exception as e:
        print(f"smoke_browser: FAIL — server not reachable at {BASE} ({e})")
        sys.exit(1)
    sys.exit(main())
