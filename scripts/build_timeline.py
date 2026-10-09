#!/usr/bin/env python3
"""Merge curated key moments with RCU releases (view counts) -> site/data/timeline.json"""
from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RCU_DATA = Path(os.environ.get("RCU_DATA", r"G:\LocalAIagent\rcu-universe\data"))
CURATED = ROOT / "data" / "key_moments.curated.json"
OUT = ROOT / "site" / "data" / "timeline.json"

YEAR_MIN = 1983
YEAR_MAX = 2026


def load_json(path: Path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def release_by_video_id(releases: list) -> dict:
    out = {}
    for r in releases:
        vid = r.get("video_id")
        if vid:
            out[vid] = r
    return out


def score_importance(moment: dict, max_views: float) -> float:
    base = float(moment.get("importance") or 0.5)
    views = moment.get("view_count") or 0
    if views and max_views > 0:
        view_boost = 0.35 * math.log10(max(views, 1)) / math.log10(max(max_views, 1))
        return min(1.0, base * 0.65 + view_boost)
    return min(1.0, base)


def main() -> None:
    curated = load_json(CURATED)
    moments = list(curated["moments"])

    release_map: dict = {}
    if (RCU_DATA / "releases.json").exists():
        rel_doc = load_json(RCU_DATA / "releases.json")
        releases = rel_doc.get("releases") or []
        release_map = release_by_video_id(releases)

    max_views = max(
        (m.get("view_count") or 0 for m in moments),
        default=1,
    )
    for r in release_map.values():
        max_views = max(max_views, r.get("view_count") or 0)

    seen_yt: set[str] = set()
    merged = []
    for m in moments:
        yt = m.get("youtube_id")
        if yt and yt in release_map:
            r = release_map[yt]
            m = {**m}
            m["view_count"] = r.get("view_count") or m.get("view_count")
            m["title"] = m.get("title") or r.get("song_title") or r.get("title")
            m["url"] = r.get("url") or f"https://www.youtube.com/watch?v={yt}"
            m["era"] = r.get("era")
            m["views_per_day"] = r.get("views_per_day")
        if yt:
            if yt in seen_yt:
                continue
            seen_yt.add(yt)
        y = m.get("year")
        if y is None:
            continue
        m = {**m}
        m["importance_score"] = round(score_importance(m, max_views), 4)
        m["t"] = (float(y) - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)
        merged.append(m)

    merged.sort(key=lambda x: (x.get("year", 0), x.get("month") or 0, x.get("day") or 0))

    stats = {
        "official_video_count": sum(1 for m in merged if m.get("category") == "music_video"),
        "total_views_sampled": sum(m.get("view_count") or 0 for m in merged if m.get("view_count")),
        "top_by_views": sorted(
            [m for m in merged if m.get("view_count")],
            key=lambda x: x.get("view_count") or 0,
            reverse=True,
        )[:8],
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "schema_version": 1,
        "title": "Ronnie's Rad Key",
        "subject": "Ronnie Radke",
        "year_min": YEAR_MIN,
        "year_max": YEAR_MAX,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "eras": curated.get("eras", []),
        "tattoo_eras": curated.get("tattoo_eras", []),
        "moments": merged,
        "stats": {
            "official_video_count": stats["official_video_count"],
            "total_views_sampled": stats["total_views_sampled"],
            "top_by_views": [
                {
                    "id": m["id"],
                    "title": m["title"],
                    "view_count": m.get("view_count"),
                    "youtube_id": m.get("youtube_id"),
                }
                for m in stats["top_by_views"]
            ],
        },
    }
    with OUT.open("w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    print(f"Wrote {len(merged)} moments -> {OUT}")


if __name__ == "__main__":
    main()
