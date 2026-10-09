#!/usr/bin/env python3
"""Export RCU SQLite + curated overrides -> Rad Key static bundles (schema v2)."""
from __future__ import annotations

import json
import math
import os
import re
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RCU_DB = Path(
    os.environ.get("RCU_DB")
    or os.environ.get("RCU_DATA")
    or r"G:\LocalAIagent\rcu-universe\data\rcu.sqlite"
)
CURATED = ROOT / "data" / "key_moments.curated.json"
TIMELINE_FILL = ROOT / "data" / "timeline_fill.pre2019.json"
LIFE_TITLE_OVERRIDES = ROOT / "data" / "life_event_title_overrides.json"
SUMMARY_OVERRIDES = ROOT / "data" / "moment_summary_overrides.json"
WIKI_SUPERSEDES = ROOT / "data" / "wiki_event_supersedes.json"
SITE_CONFIG = ROOT / "data" / "site_config.json"

SUMMARY_MAX_LEN = 520
OUT_DIR = ROOT / "site" / "data"
MOMENTS_DIR = OUT_DIR / "moments"


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def resolve_source_entries(source_ids: list[str] | None, sources_by_id: dict[str, dict]) -> list[dict]:
    """Map RCU source_id strings to {source_id, url, title, kind} for detail shards."""
    out: list[dict] = []
    seen: set[str] = set()
    for sid in source_ids or []:
        if not sid or sid in seen:
            continue
        row = sources_by_id.get(sid)
        if not row:
            prefix = f"{sid}-"
            matches = [sources_by_id[k] for k in sources_by_id if k == sid or k.startswith(prefix)]
            row = matches[0] if matches else None
        if not row:
            out.append({"source_id": sid, "title": sid})
            seen.add(sid)
            continue
        seen.add(row["source_id"])
        title = row.get("kind") or row["source_id"]
        if row.get("kind") == "wikipedia_section" and row.get("url"):
            title = "Wikipedia"
        out.append(
            {
                "source_id": row["source_id"],
                "url": row.get("url"),
                "title": title,
                "kind": row.get("kind"),
            }
        )
    return out


def attach_event_source_ids(moments: dict[str, dict], event_sources: dict[str, list[str]]) -> None:
    for m in moments.values():
        if m.get("source_ids"):
            continue
        eid = (m.get("provenance") or {}).get("event_id")
        if eid and eid in event_sources:
            m["source_ids"] = list(event_sources[eid])


def parse_event_date(date_str: str | None) -> tuple[float | None, int | None, int | None, int | None]:
    """Return (year_float, year, month, day)."""
    if not date_str or not str(date_str).strip():
        return None, None, None, None
    s = str(date_str).strip()
    if re.fullmatch(r"\d{4}", s):
        y = int(s)
        return float(y), y, None, None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return y + (mo - 1) / 12 + d / 365, y, mo, d
    m = re.match(r"(\d{4})-(\d{2})", s)
    if m:
        y, mo = int(m.group(1)), int(m.group(2))
        return y + (mo - 1) / 12, y, mo, None
    return None, None, None, None


def parse_release_date(date_str: str | None) -> tuple[float | None, int | None, int | None, int | None]:
    return parse_event_date(date_str)


def infer_year_from_text(title: str | None, summary: str | None) -> tuple[int | None, int | None, int | None]:
    """Best-effort year (and optional month) from wiki-style headings."""
    for text in (title or "", summary or ""):
        m = re.search(r"\((\d{4})[–\-—]", text)
        if m:
            return int(m.group(1)), None, None
        m = re.search(r"\b(19[89]\d|20[0-1]\d)\b", text)
        if m:
            y = int(m.group(1))
            if 1983 <= y <= 2026:
                return y, None, None
    return None, None, None


_WIKI_SECTION_TITLE = re.compile(
    r"^.+\(\d{4}\s*[–\-—]\s*(?:\d{4}|present)\)$",
    re.IGNORECASE,
)


def load_life_title_overrides() -> tuple[dict[str, str], list[str]]:
    if not LIFE_TITLE_OVERRIDES.is_file():
        return {}, []
    doc = load_json(LIFE_TITLE_OVERRIDES)
    titles = doc.get("titles") or {}
    skips = list(doc.get("skip_event_id_prefixes") or [])
    return {str(k): str(v) for k, v in titles.items()}, skips


def should_skip_life_event(event_id: str, skip_prefixes: list[str]) -> bool:
    for prefix in skip_prefixes:
        if event_id.startswith(prefix):
            return True
    return False


def lookup_title_override(event_id: str, overrides: dict[str, str]) -> str | None:
    if event_id in overrides:
        return overrides[event_id]
    for key, val in overrides.items():
        if event_id.startswith(key) or key.startswith(event_id):
            return val
    return None


def is_wikipedia_section_title(title: str) -> bool:
    t = (title or "").strip()
    if not t:
        return False
    if t.startswith("===") or t.endswith("==="):
        return True
    if t.lower() in {"personal life", "early life", "solo career"}:
        return True
    if t.lower().startswith("with escape the fate"):
        return True
    if _WIKI_SECTION_TITLE.match(t):
        return True
    return False


def clean_wikitext(text: str) -> str:
    if not text:
        return ""
    s = text.strip()
    s = re.sub(r"^===+.*?===+$", "", s, flags=re.MULTILINE).strip()
    s = re.sub(r"\[\[([^|\]]*\|)?([^\]]+)\]\]", r"\2", s)
    s = re.sub(r"''+", "", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"thumb\|[^|\n]+\|?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def load_summary_overrides() -> dict[str, str]:
    if not SUMMARY_OVERRIDES.is_file():
        return {}
    doc = load_json(SUMMARY_OVERRIDES)
    raw = doc.get("summaries") or {}
    return {str(k): str(v) for k, v in raw.items()}


def lookup_summary_override(event_id: str, overrides: dict[str, str]) -> str | None:
    if event_id in overrides:
        return overrides[event_id]
    for key, val in overrides.items():
        if event_id.startswith(key) or key.startswith(event_id):
            return val
    return None


def polish_summary_text(raw: str) -> str:
    s = clean_wikitext(raw or "")
    if not s:
        return ""
    s = re.sub(r"\(also featuring\s*\)", "", s, flags=re.IGNORECASE)
    s = re.sub(r",?\s*which features\s*,", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\(\s*\)", "", s)
    s = re.sub(r"\s+,", ",", s)
    s = re.sub(r",\s*,", ", ", s)
    s = re.sub(r"\bwell known\b", "well-known", s, flags=re.IGNORECASE)
    s = re.sub(r"\s{2,}", " ", s).strip()
    return s


def truncate_summary_at_sentence(text: str, max_len: int = SUMMARY_MAX_LEN) -> str:
    s = (text or "").strip()
    if len(s) <= max_len:
        return s
    window = s[: max_len - 1]
    best = -1
    for sep in (". ", "? ", "! ", "; "):
        idx = window.rfind(sep)
        if idx > best and idx >= int(max_len * 0.28):
            best = idx
    if best >= 0:
        return window[: best + 1].strip()
    if " " in window:
        return window.rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return window + "…"


def finalize_moment_summary(
    raw: str,
    event_id: str | None,
    summary_overrides: dict[str, str],
) -> str:
    if event_id:
        override = lookup_summary_override(event_id, summary_overrides)
        if override:
            return truncate_summary_at_sentence(override)
    polished = polish_summary_text(raw)
    return truncate_summary_at_sentence(polished)


def summary_to_display_title(summary: str, *, max_len: int = 72) -> str | None:
    s = clean_wikitext(summary or "")
    if not s or re.fullmatch(r"===+.*===+", s):
        return None
    if len(s) < 12:
        return None
    parts = re.split(r"(?<=[.!?])\s+", s, maxsplit=1)
    sent = parts[0]
    if len(sent) > max_len:
        cut = sent[: max_len - 1]
        if " " in cut:
            cut = cut.rsplit(" ", 1)[0]
        sent = cut + "…"
    return sent


def resolve_life_event_title(
    raw_title: str,
    summary: str,
    event_id: str,
    title_overrides: dict[str, str],
) -> str | None:
    override = lookup_title_override(event_id, title_overrides)
    if override:
        return override[:120]
    title = (raw_title or "").replace("<i>", "").replace("</i>", "").strip()
    if is_wikipedia_section_title(title):
        derived = summary_to_display_title(summary or "")
        if not derived:
            return None
        return derived[:120]
    return title[:120] if title else None


def load_wiki_supersede_rules() -> list[tuple[str, tuple[str, ...]]]:
    if not WIKI_SUPERSEDES.is_file():
        return []
    doc = load_json(WIKI_SUPERSEDES)
    out: list[tuple[str, tuple[str, ...]]] = []
    for rule in doc.get("rules") or []:
        anchor = rule.get("anchor_id")
        prefixes = tuple(rule.get("skip_event_id_prefixes") or [])
        if anchor and prefixes:
            out.append((str(anchor), prefixes))
    return out


def wiki_event_is_superseded(event_id: str, moments: dict[str, dict], rules: list[tuple[str, ...]]) -> bool:
    for anchor_id, prefixes in rules:
        if anchor_id not in moments:
            continue
        for prefix in prefixes:
            if event_id.startswith(prefix):
                return True
    return False


def norm_song_title(title: str | None) -> str:
    t = (title or "").lower()
    t = re.sub(r"\([^)]*\)", "", t)
    t = re.sub(r"[^a-z0-9]+", " ", t).strip()
    return t


def dedupe_timeline_moments(moments: dict[str, dict]) -> dict[str, dict]:
    """Remove duplicate rungs: wiki Career stubs, music MV doubles, shared YouTube ids."""
    drop: set[str] = set()

    for mid, m in moments.items():
        title = (m.get("title") or "").strip().lower()
        eid = (m.get("provenance") or {}).get("event_id") or ""
        if title == "career" or "-career-" in eid:
            drop.add(mid)

    music_groups: dict[tuple, list[tuple[str, dict]]] = defaultdict(list)
    for mid, m in moments.items():
        if mid in drop:
            continue
        if m.get("category") != "music_video" and m.get("strand") != "music":
            continue
        key = (m.get("year"), norm_song_title(m.get("title")))
        if not key[1]:
            continue
        music_groups[key].append((mid, m))

    for group in music_groups.values():
        if len(group) < 2:
            continue
        group.sort(
            key=lambda item: (
                0 if not item[0].startswith("mv-") else 1,
                -(item[1].get("view_count") or 0),
                -(item[1].get("importance") or 0),
            )
        )
        for mid, _ in group[1:]:
            drop.add(mid)

    by_youtube: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for mid, m in moments.items():
        if mid in drop:
            continue
        yt = m.get("youtube_id")
        if yt:
            by_youtube[yt].append((mid, m))
    for group in by_youtube.values():
        if len(group) < 2:
            continue
        group.sort(
            key=lambda item: (
                0 if not item[0].startswith("mv-") else 1,
                -(item[1].get("view_count") or 0),
            )
        )
        for mid, _ in group[1:]:
            drop.add(mid)

    if drop:
        for mid in drop:
            moments.pop(mid, None)
    return moments


def score_importance(moment: dict, max_views: float) -> float:
    base = float(moment.get("importance") or 0.5)
    views = moment.get("view_count") or 0
    tier = moment.get("rcu_tier") or ""
    tier_boost = {"core": 0.12, "canonical": 0.08, "peripheral": 0.0}.get(tier, 0.0)
    if views and max_views > 0:
        view_boost = 0.35 * math.log10(max(views, 1)) / math.log10(max(max_views, 1))
        return min(1.0, base * 0.6 + view_boost + tier_boost)
    return min(1.0, base + tier_boost)


def lore_text_from_row(lore_json: str | None) -> str:
    if not lore_json:
        return ""
    try:
        lore = json.loads(lore_json)
    except json.JSONDecodeError:
        return ""
    if isinstance(lore, str):
        return lore[:600]
    parts = []
    for key in ("summary", "plot", "characters", "themes"):
        v = lore.get(key)
        if isinstance(v, str) and v.strip():
            parts.append(v.strip())
        elif isinstance(v, list):
            parts.extend(str(x) for x in v[:5])
    return " ".join(parts)[:600]


def main() -> None:
    cfg = load_json(SITE_CONFIG)
    curated_doc = load_json(CURATED)
    curated_list = curated_doc.get("moments") or []
    year_min = cfg["year_min"]
    year_max = cfg["year_max"]

    curated_by_id = {m["id"]: m for m in curated_list if m.get("id")}
    curated_by_yt: dict[str, dict] = {}
    for m in curated_list:
        yt = m.get("youtube_id")
        if yt:
            curated_by_yt[yt] = m

    if not RCU_DB.exists():
        raise SystemExit(f"RCU database not found: {RCU_DB}")

    conn = sqlite3.connect(RCU_DB)
    conn.row_factory = sqlite3.Row

    sources_by_id: dict[str, dict] = {}
    for row in conn.execute("SELECT source_id, url, kind, excerpt FROM sources"):
        sources_by_id[row["source_id"]] = dict(row)

    event_sources: dict[str, list[str]] = {}
    for row in conn.execute("SELECT event_id, source_id FROM event_sources"):
        event_sources.setdefault(row["event_id"], []).append(row["source_id"])

    synced_at = None
    for row in conn.execute("SELECT key, value FROM meta"):
        if row["key"] == "synced_at":
            synced_at = row["value"]

    moments: dict[str, dict] = {}

    def add_moment(m: dict) -> None:
        mid = m.get("id")
        if not mid:
            return
        y = m.get("year")
        if y is None:
            return
        if mid in moments:
            moments[mid] = {**moments[mid], **{k: v for k, v in m.items() if v is not None}}
        else:
            moments[mid] = m

    for m in curated_list:
        add_moment(dict(m))

    if TIMELINE_FILL.is_file():
        fill_doc = load_json(TIMELINE_FILL)
        for m in fill_doc.get("moments") or []:
            add_moment(dict(m))

    release_tiers = set(cfg.get("import", {}).get("release_tiers") or ["epitaph_official"])
    for row in conn.execute(
        """
        SELECT release_id, video_id, title, song_title, release_date, view_count,
               views_per_day, release_tier, era, rcu_tier, payload_json
        FROM releases
        """
    ):
        if row["release_tier"] not in release_tiers:
            continue
        vid = row["video_id"]
        if not vid:
            continue
        yf, y, mo, d = parse_release_date(row["release_date"])
        if y is None:
            continue
        cur = curated_by_yt.get(vid)
        mid = cur["id"] if cur else f"mv-{vid}"
        title = (cur or {}).get("title") or row["song_title"] or row["title"]
        summary = (cur or {}).get("summary") or f"Official release: {title}."
        m = {
            "id": mid,
            "strand": "music",
            "category": "music_video",
            "year": y,
            "month": mo,
            "day": d,
            "title": title,
            "summary": summary,
            "youtube_id": vid,
            "url": f"https://www.youtube.com/watch?v={vid}",
            "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
            "view_count": row["view_count"],
            "views_per_day": row["views_per_day"],
            "era": row["era"],
            "rcu_tier": row["rcu_tier"],
            "importance": (cur or {}).get("importance") or 0.55,
            "provenance": {"release_id": row["release_id"], "video_id": vid},
        }
        add_moment(m)

    video_tiers = set(cfg.get("import", {}).get("video_rcu_tiers") or ["core", "canonical"])
    for row in conn.execute(
        "SELECT video_id, title, upload_date, view_count, thumbnail, payload_json FROM videos"
    ):
        payload = json.loads(row["payload_json"] or "{}")
        tier = payload.get("rcu_tier") or row["video_id"] and None
        if tier not in video_tiers:
            continue
        vid = row["video_id"]
        if f"mv-{vid}" in moments or any(m.get("youtube_id") == vid for m in moments.values()):
            continue
        ud = row["upload_date"] or payload.get("upload_date")
        yf, y, mo, d = parse_event_date(str(ud) if ud else None)
        if y is None:
            if ud and len(str(ud)) >= 4 and str(ud)[:4].isdigit():
                y = int(str(ud)[:4])
                mo, d = None, None
            else:
                continue
        add_moment(
            {
                "id": f"mv-{vid}",
                "strand": "music",
                "category": "music_video",
                "year": y,
                "month": mo,
                "day": d,
                "title": row["title"] or payload.get("title"),
                "summary": (payload.get("description") or "")[:280],
                "youtube_id": vid,
                "url": payload.get("url") or f"https://www.youtube.com/watch?v={vid}",
                "thumbnail": row["thumbnail"] or payload.get("thumbnail"),
                "view_count": row["view_count"] or payload.get("view_count"),
                "rcu_tier": tier,
                "importance": 0.5,
                "provenance": {"video_id": vid},
            }
        )

    skip_titles = {
        "History",
        "Legal issues",
        "External links",
        "Accolades",
        "Singles",
        "Solo career",
        "Career",
    }
    title_overrides, skip_event_prefixes = load_life_title_overrides()
    summary_overrides = load_summary_overrides()
    wiki_supersede_rules = load_wiki_supersede_rules()
    for row in conn.execute(
        """
        SELECT event_id, event_date, category, title, summary, source_excerpt
        FROM life_events
        WHERE event_date IS NOT NULL AND trim(event_date) != ''
        """
    ):
        raw_title = row["title"] or ""
        title = raw_title.replace("<i>", "").replace("</i>", "")
        if title in skip_titles:
            continue
        if len(title) < 4:
            continue
        yf, y, mo, d = parse_event_date(row["event_date"])
        if y is None:
            continue
        eid = row["event_id"]
        if should_skip_life_event(eid, skip_event_prefixes):
            continue
        if "-career-" in eid:
            continue
        if wiki_event_is_superseded(eid, moments, wiki_supersede_rules):
            continue
        display_title = resolve_life_event_title(
            raw_title,
            row["summary"] or row["source_excerpt"] or "",
            eid,
            title_overrides,
        )
        if not display_title:
            continue
        cur_id = None
        for cid, cm in curated_by_id.items():
            if cm.get("provenance", {}).get("event_id") == eid:
                cur_id = cid
                break
        mid = cur_id or f"life-{eid[:48]}"
        if mid in curated_by_id:
            continue
        cat = row["category"] or "career"
        strand = "life"
        add_moment(
            {
                "id": mid,
                "strand": strand,
                "category": cat,
                "year": y,
                "month": mo,
                "day": d,
                "title": display_title,
                "summary": finalize_moment_summary(
                    row["summary"] or row["source_excerpt"] or "",
                    eid,
                    summary_overrides,
                ),
                "importance": 0.45 if cat != "legal" else 0.65,
                "provenance": {"event_id": eid},
            }
        )

    for row in conn.execute(
        """
        SELECT event_id, event_date, category, title, summary, source_excerpt
        FROM life_events
        WHERE event_date IS NULL OR trim(event_date) = ''
        """
    ):
        raw_title = row["title"] or ""
        title = raw_title.replace("<i>", "").replace("</i>", "")
        if title in skip_titles or len(title) < 4:
            continue
        y, mo, d = infer_year_from_text(title, row["summary"] or row["source_excerpt"])
        if y is None:
            continue
        eid = row["event_id"]
        if should_skip_life_event(eid, skip_event_prefixes):
            continue
        if "-career-" in eid:
            continue
        if wiki_event_is_superseded(eid, moments, wiki_supersede_rules):
            continue
        display_title = resolve_life_event_title(
            raw_title,
            row["summary"] or row["source_excerpt"] or "",
            eid,
            title_overrides,
        )
        if not display_title:
            continue
        mid = f"life-infer-{eid[:40]}"
        if mid in moments or mid in curated_by_id:
            continue
        cat = row["category"] or "career"
        add_moment(
            {
                "id": mid,
                "strand": "life",
                "category": cat,
                "year": y,
                "month": mo,
                "day": d,
                "title": display_title,
                "summary": finalize_moment_summary(
                    row["summary"] or row["source_excerpt"] or "",
                    eid,
                    summary_overrides,
                ),
                "importance": 0.42,
                "provenance": {"event_id": eid, "inferred_date": True},
            }
        )

    attach_event_source_ids(moments, event_sources)

    for m in moments.values():
        raw_sum = m.get("summary") or ""
        if not raw_sum:
            continue
        eid = (m.get("provenance") or {}).get("event_id")
        m["summary"] = finalize_moment_summary(raw_sum, eid, summary_overrides)

    moments = dedupe_timeline_moments(moments)

    video_id_to_moment = {}
    for m in moments.values():
        vid = m.get("youtube_id") or (m.get("provenance") or {}).get("video_id")
        if vid:
            video_id_to_moment[vid] = m["id"]

    relations = list(conn.execute("SELECT * FROM relations"))
    rel_by_moment: dict[str, list] = {mid: [] for mid in moments}
    for rel in relations:
        fv, tv = rel["from_video_id"], rel["to_video_id"]
        rt = rel["rel_type"]
        if fv in video_id_to_moment and tv in video_id_to_moment:
            fid, tid = video_id_to_moment[fv], video_id_to_moment[tv]
            edge = {"id": tid, "rel_type": rt, "title": moments[tid].get("title")}
            if edge not in rel_by_moment.get(fid, []):
                rel_by_moment.setdefault(fid, []).append(edge)
            back = {"id": fid, "rel_type": rt, "title": moments[fid].get("title")}
            if back not in rel_by_moment.get(tid, []):
                rel_by_moment.setdefault(tid, []).append(back)

    max_views = max((m.get("view_count") or 0 for m in moments.values()), default=1)

    MOMENTS_DIR.mkdir(parents=True, exist_ok=True)
    for old in MOMENTS_DIR.glob("*.json"):
        old.unlink()

    search_docs = []
    graph_nodes = []
    graph_edges = []
    entity_rows = list(conn.execute("SELECT slug, name, entity_type, description FROM entities"))

    for ent in entity_rows:
        graph_nodes.append(
            {
                "id": f"ent-{ent['slug']}",
                "type": "entity",
                "label": ent["name"],
                "entity_type": ent["entity_type"],
            }
        )

    for rel in relations:
        if rel["from_video_id"] in video_id_to_moment and rel["to_video_id"] in video_id_to_moment:
            graph_edges.append(
                {
                    "from": video_id_to_moment[rel["from_video_id"]],
                    "to": video_id_to_moment[rel["to_video_id"]],
                    "rel_type": rel["rel_type"],
                    "confidence": rel["confidence"],
                }
            )

    merged_list = []
    for mid, m in moments.items():
        m = dict(m)
        m["related"] = rel_by_moment.get(mid, [])[:12]
        if m["related"] and m.get("strand") != "music":
            m["strand"] = m.get("strand") or "lore"
        m["importance_score"] = round(score_importance(m, max_views), 4)
        m["t"] = round((float(m["year"]) - year_min) / (year_max - year_min), 4)
        m["detail_path"] = f"data/moments/{mid}.json"

        vid = m.get("youtube_id") or (m.get("provenance") or {}).get("video_id")
        lore_row = None
        if vid:
            lore_row = conn.execute(
                "SELECT lore_json FROM video_lore WHERE video_id = ?", (vid,)
            ).fetchone()
            graph_nodes.append(
                {
                    "id": mid,
                    "type": "video",
                    "label": m.get("title"),
                    "youtube_id": vid,
                }
            )

        frames = []
        comments = []
        if vid:
            for fr in conn.execute(
                """
                SELECT timestamp_sec, caption, tags_json FROM frame_captions
                WHERE video_id = ? ORDER BY timestamp_sec LIMIT 5
                """,
                (vid,),
            ):
                frames.append(
                    {
                        "timestamp_sec": fr["timestamp_sec"],
                        "caption": fr["caption"],
                        "tags": json.loads(fr["tags_json"]) if fr["tags_json"] else [],
                    }
                )
            for cm in conn.execute(
                """
                SELECT author, body, like_count FROM comments
                WHERE video_id = ? ORDER BY like_count DESC LIMIT 5
                """,
                (vid,),
            ):
                comments.append(
                    {"author": cm["author"], "text": cm["body"], "like_count": cm["like_count"]}
                )

        lore_summary = lore_text_from_row(lore_row["lore_json"] if lore_row else None)
        if not lore_summary and vid:
            payload_row = conn.execute(
                "SELECT payload_json FROM videos WHERE video_id = ?", (vid,)
            ).fetchone()
            if payload_row:
                pl = json.loads(payload_row["payload_json"] or "{}")
                lore_obj = pl.get("lore")
                if isinstance(lore_obj, dict):
                    lore_summary = lore_text_from_row(json.dumps(lore_obj))
                elif isinstance(lore_obj, str):
                    lore_summary = lore_obj[:600]

        detail = {
            "schema_version": 2,
            "id": mid,
            "timeline": {k: m.get(k) for k in ("title", "summary", "year", "strand", "category", "youtube_id", "url", "view_count", "era", "rcu_tier")},
            "lore": {"summary": lore_summary, "related": m["related"]},
            "frame_captions": frames,
            "comments_sample": comments,
            "sources": resolve_source_entries(m.get("source_ids"), sources_by_id),
            "provenance": m.get("provenance"),
        }
        with (MOMENTS_DIR / f"{mid}.json").open("w", encoding="utf-8") as f:
            json.dump(detail, f, ensure_ascii=False, indent=2)

        search_docs.append(
            {
                "id": mid,
                "title": m.get("title"),
                "summary": m.get("summary"),
                "strand": m.get("strand"),
                "year": m.get("year"),
                "category": m.get("category"),
            }
        )

        slim = {k: m[k] for k in m if k not in ("source_ids",)}
        merged_list.append(slim)

    merged_list.sort(key=lambda x: (x.get("year", 0), x.get("month") or 0, x.get("day") or 0))

    official_mv = sum(1 for m in merged_list if m.get("category") == "music_video")
    total_views = sum(m.get("view_count") or 0 for m in merged_list if m.get("view_count"))

    rcu_meta = {
        "universe_id": "rcu",
        "display_name": cfg["rcu_name"],
        "synced_at": synced_at,
        "counts": {
            "moments": len(merged_list),
            "videos_in_db": conn.execute("SELECT COUNT(*) FROM videos").fetchone()[0],
            "releases": conn.execute("SELECT COUNT(*) FROM releases").fetchone()[0],
            "entities": len(entity_rows),
            "relations": len(relations),
            "life_events": conn.execute("SELECT COUNT(*) FROM life_events").fetchone()[0],
        },
    }

    timeline = {
        "schema_version": 2,
        "title": cfg["title"],
        "subtitle": cfg.get("subtitle"),
        "rcu_name": cfg["rcu_name"],
        "subject": cfg["subject"],
        "year_min": year_min,
        "year_max": year_max,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "eras": cfg["eras"],
        "tattoo_eras": cfg["tattoo_eras"],
        "rcu_meta": rcu_meta,
        "stats": {
            "official_video_count": official_mv,
            "total_views_sampled": total_views,
            "top_by_views": sorted(
                [
                    {
                        "id": m["id"],
                        "title": m["title"],
                        "view_count": m.get("view_count"),
                        "youtube_id": m.get("youtube_id"),
                    }
                    for m in merged_list
                    if m.get("view_count")
                ],
                key=lambda x: x["view_count"] or 0,
                reverse=True,
            )[:10],
            "rcu": rcu_meta["counts"],
        },
        "moments": merged_list,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with (OUT_DIR / "timeline.json").open("w", encoding="utf-8") as f:
        json.dump(timeline, f, ensure_ascii=False, indent=2)

    with (OUT_DIR / "rcu-meta.json").open("w", encoding="utf-8") as f:
        json.dump(rcu_meta, f, ensure_ascii=False, indent=2)

    with (OUT_DIR / "search-index.json").open("w", encoding="utf-8") as f:
        json.dump({"schema_version": 1, "documents": search_docs}, f, ensure_ascii=False, indent=2)

    with (OUT_DIR / "graph.json").open("w", encoding="utf-8") as f:
        json.dump(
            {"schema_version": 1, "nodes": graph_nodes, "edges": graph_edges},
            f,
            ensure_ascii=False,
            indent=2,
        )

    conn.close()
    print(
        f"Wrote timeline v2: {len(merged_list)} moments, "
        f"{len(search_docs)} search docs, {len(graph_edges)} graph edges -> {OUT_DIR}"
    )


if __name__ == "__main__":
    main()
