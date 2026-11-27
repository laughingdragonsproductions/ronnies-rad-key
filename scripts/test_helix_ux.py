#!/usr/bin/env python3
"""Playwright checks for Rad Key + Focus merge and year HUD placement."""
from __future__ import annotations

import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790/"


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("test_helix_ux: SKIP - playwright not installed")
        return 0

    failures: list[str] = []

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
            print("test_helix_ux: SKIP - no browser")
            return 0

        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.goto(BASE, wait_until="networkidle", timeout=90_000)
        page.wait_for_timeout(3000)

        if page.locator("#focus-slider").count():
            failures.append("focus slider still in DOM")
        if page.locator("#focus-rail").count():
            failures.append("focus rail still in DOM")

        hud = page.evaluate(
            """() => {
              const el = document.getElementById('year-display');
              const cs = el ? getComputedStyle(el) : null;
              const fs = cs ? parseFloat(cs.fontSize) : 0;
              return {
                position: cs?.position,
                bottom: cs?.bottom,
                top: cs?.top,
                fontSizePx: fs,
                zIndex: cs?.zIndex,
              };
            }"""
        )
        if hud.get("position") != "fixed":
            failures.append(f"year-display position={hud.get('position')}")
        if hud.get("fontSizePx", 0) > 28:
            failures.append(f"year-display too large ({hud.get('fontSizePx')}px)")
        bottom_px = float(str(hud.get("bottom", "0")).replace("px", "") or 0)
        if bottom_px < 40:
            failures.append(f"year-display too low on screen (bottom={hud.get('bottom')})")
        if not hud.get("bottom") or hud.get("bottom") == "auto":
            failures.append("year-display not bottom-anchored above key rail")

        slider = page.locator("#key-slider")
        slider.fill("0")
        page.wait_for_timeout(1200)
        year_low = page.locator("#year-display").inner_text().strip()
        slider.fill("100")
        page.wait_for_timeout(1200)
        year_high = page.locator("#year-display").inner_text().strip()

        if not year_low.startswith("198"):
            failures.append(f"slider 0 expected ~1983, got {year_low!r}")
        if not year_high.startswith("202"):
            failures.append(f"slider 100 expected ~2026, got {year_high!r}")

        # Hover label: scrub near 2009 and probe canvas center
        slider.fill("35")
        page.wait_for_timeout(1000)
        canvas = page.locator("#helix-canvas")
        box = canvas.bounding_box()
        if box:
            page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.45)
            page.wait_for_timeout(600)
            hover_text = page.locator("#year-display").inner_text().strip()
            has_rung = page.evaluate(
                "() => document.getElementById('year-display')?.classList.contains('is-rung')"
            )
            if has_rung and "·" not in hover_text:
                failures.append(f"is-rung set but label missing title: {hover_text!r}")
            page.mouse.move(0, 0)
            page.wait_for_timeout(400)
            cleared = page.locator("#year-display").inner_text().strip()
            if cleared == hover_text and has_rung:
                failures.append("year HUD did not restore after unhover")

        def backdrop_urls(year_val: str) -> str:
            page.locator("#key-slider").fill(year_val)
            page.wait_for_timeout(900)
            return page.evaluate(
                """() => getComputedStyle(document.getElementById('backdrop')).backgroundImage"""
            )

        early_bg = backdrop_urls("5")
        mid_bg = backdrop_urls("55")
        late_bg = backdrop_urls("96")

        if "then-now-ref" not in early_bg:
            failures.append("early backdrop should use then-now (young)")
        if "colorful-ref" not in mid_bg:
            failures.append("mid backdrop should use colorful full tats")
        if "then-now-ref" not in late_bg or "colorful-ref" in late_bg:
            failures.append("blackout backdrop should use then-now right, not colorful")

        stats_above_filters = page.evaluate(
            """() => {
              const chrome = document.getElementById('bottom-chrome');
              const stats = document.getElementById('stats-panel');
              const controls = document.getElementById('controls');
              if (!chrome || !stats || !controls) return false;
              return chrome.firstElementChild === stats && chrome.contains(controls);
            }"""
        )
        if not stats_above_filters:
            failures.append("stats-panel should sit above filter controls in #bottom-chrome")

        page.locator("#key-slider").fill("10")
        page.wait_for_timeout(800)
        if page.locator(".verify-badge").count():
            failures.append("verification badges should not appear on the public site")

        browser.close()

    print("test_helix_ux HUD:", hud)
    print("test_helix_ux years:", year_low, "->", year_high)

    if failures:
        print("test_helix_ux: FAIL")
        for f in failures:
            print(" ", f)
        return 1

    print("test_helix_ux: OK")
    return 0


if __name__ == "__main__":
    try:
        urllib.request.urlopen(BASE, timeout=5)
    except Exception as e:
        print(f"test_helix_ux: FAIL - server not reachable ({e})")
        sys.exit(1)
    sys.exit(main())