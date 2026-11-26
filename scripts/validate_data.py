#!/usr/bin/env python3
"""Validate Rad Key static data bundles."""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "site" / "data"


def _norm_song(title: str | None) -> str:
    t = (title or "").lower()
    t = re.sub(r"\([^)]*\)", "", t)
    t = re.sub(r"^[\s\"']*falling in reverse\s*[-–—]?\s*", "", t)
    t = re.sub(r"[\"'“”‘’]", "", t)
    t = re.sub(r"[^a-z0-9]+", " ", t).strip()
    return t


def main() -> int:
    errors: list[str] = []
    tl_path = DATA / "timeline.json"
    if not tl_path.exists():
        errors.append("missing site/data/timeline.json — run build_from_rcu.py")
    else:
        tl = json.loads(tl_path.read_text(encoding="utf-8"))
        if tl.get("schema_version") != 2:
            errors.append(f"timeline schema_version expected 2, got {tl.get('schema_version')}")
        ids = set()
        for m in tl.get("moments") or []:
            if m.get("year") is None:
                errors.append(f"moment {m.get('id')} missing year")
            mid = m.get("id")
            if mid in ids:
                errors.append(f"duplicate moment id {mid}")
            ids.add(mid)
        music_by_key: dict[tuple, list[str]] = defaultdict(list)
        for m in tl.get("moments") or []:
            if m.get("strand") != "music" and m.get("category") != "music_video":
                continue
            norm = _norm_song(m.get("title"))
            if not norm:
                continue
            music_by_key[(m.get("year"), norm)].append(m.get("id") or "?")
        for key, mids in music_by_key.items():
            if len(mids) > 1:
                errors.append(f"duplicate music rung {key}: {', '.join(mids)}")
        for m in tl.get("moments") or []:
            mid = m.get("id")
            detail = ROOT / "site" / "data" / "moments" / f"{mid}.json"
            if not detail.exists():
                errors.append(f"missing detail shard {detail.name}")
            else:
                d = json.loads(detail.read_text(encoding="utf-8"))
                d_ver = d.get("verification")
                tl_ver = m.get("verification")
                if d_ver or tl_ver:
                    st = (d_ver or tl_ver).get("status")
                    if st and st not in ("verified", "unproven", "disputed", "conflict"):
                        errors.append(f"moment {mid} invalid verification.status {st!r}")
                    if d_ver and tl_ver and d_ver.get("status") != tl_ver.get("status"):
                        errors.append(f"moment {mid} timeline/detail verification.status mismatch")

    if errors:
        for e in errors:
            print("ERROR:", e)
        return 1
    print("validate_data: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
