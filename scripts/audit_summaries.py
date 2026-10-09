#!/usr/bin/env python3
"""Audit timeline summaries and duplicate rungs."""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TL = ROOT / "site" / "data" / "timeline.json"


def norm_title(title: str | None) -> str:
    t = (title or "").lower()
    t = re.sub(r"\([^)]*\)", "", t)
    t = re.sub(r"[^a-z0-9]+", " ", t).strip()
    return t


def main() -> int:
    tl = json.loads(TL.read_text(encoding="utf-8"))
    moments = tl.get("moments") or []
    issues = []
    for m in moments:
        s = m.get("summary") or ""
        mid = m.get("id")
        if re.search(r"\(also featuring\s*\)|which features\s*,|\(\s*\)", s, re.I):
            issues.append((mid, "empty_wiki_paren", s[:80]))
        if s and len(s) >= 480 and s.rstrip()[-1] not in ".!?…":
            issues.append((mid, "maybe_truncated", s[-50:]))
        if (m.get("title") or "").strip().lower() == "career":
            issues.append((mid, "career_stub_title", m.get("title")))

    by_music: dict[tuple, list] = defaultdict(list)
    by_yt: dict[str, list] = defaultdict(list)
    for m in moments:
        if m.get("youtube_id"):
            by_yt[m["youtube_id"]].append(m["id"])
        if m.get("category") == "music_video" or m.get("strand") == "music":
            key = (m.get("year"), norm_title(m.get("title")))
            if key[1]:
                by_music[key].append(m["id"])

    for key, ids in by_music.items():
        if len(ids) > 1:
            issues.append(("music_dup", key, ids))
    for yt, ids in by_yt.items():
        if len(ids) > 1:
            issues.append(("youtube_dup", yt, ids))

    if issues:
        print(f"audit_summaries: {len(issues)} issue(s)")
        for row in issues[:40]:
            print(" ", row)
        return 1
    print(f"audit_summaries: OK ({len(moments)} moments)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
