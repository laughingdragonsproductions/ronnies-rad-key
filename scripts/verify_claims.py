#!/usr/bin/env python3
"""Rule-based verification pass: RCU + timeline -> detail shards + verification-report."""
from __future__ import annotations

import json
import os
import re
import sqlite3
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RCU_DB = Path(
    os.environ.get("RCU_DB")
    or os.environ.get("RCU_DATA")
    or r"G:\LocalAIagent\rcu-universe\data\rcu.sqlite"
)
DATA_DIR = ROOT / "site" / "data"
MOMENTS_DIR = DATA_DIR / "moments"
TIMELINE_PATH = DATA_DIR / "timeline.json"
REPORT_PATH = DATA_DIR / "verification-report.json"
CURATED_PATH = ROOT / "data" / "key_moments.curated.json"
DENIALS_PATH = ROOT / "data" / "verification_denials.json"
DENIALS_SCAFFOLD = ROOT / "data" / "verification_denials.scaffold.json"

WIKI_KINDS = frozenset({"wikipedia_section", "wikipedia", "wikidata"})
STRONG_KINDS = frozenset({"wikidata", "interview", "official", "court_record"})


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def norm_title(title: str | None) -> str:
    if not title:
        return ""
    t = re.sub(r"<[^>]+>", "", title.lower())
    t = re.sub(r"[^a-z0-9]+", " ", t).strip()
    return t[:80]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def source_ids_for_moment(moment: dict, event_sources: dict[str, list[str]]) -> list[str]:
    ids = list(moment.get("source_ids") or [])
    eid = (moment.get("provenance") or {}).get("event_id")
    if eid:
        for sid in event_sources.get(eid, []):
            if sid not in ids:
                ids.append(sid)
    return ids


def resolve_source_rows(source_ids: list[str], sources_by_id: dict[str, dict]) -> list[dict]:
    rows: list[dict] = []
    for sid in source_ids:
        row = sources_by_id.get(sid)
        if not row:
            matches = [sources_by_id[k] for k in sources_by_id if k == sid or k.startswith(f"{sid}-")]
            row = matches[0] if matches else None
        if row:
            rows.append(dict(row))
        else:
            rows.append({"source_id": sid})
    return rows


def has_strong_sources(source_rows: list[dict]) -> bool:
    for row in source_rows:
        kind = (row.get("kind") or "").lower()
        if kind in STRONG_KINDS:
            return True
        sid = row.get("source_id") or ""
        if sid.startswith("wikidata-"):
            return True
    return False


def is_wiki_only(source_rows: list[dict]) -> bool:
    if not source_rows:
        return True
    kinds = {(r.get("kind") or "").lower() for r in source_rows}
    return kinds.issubset(WIKI_KINDS | {""})


def probe_url(url: str, timeout: float = 8.0) -> dict:
    result = {"url": url, "ok": False, "status": None, "error": None}
    if not url or not url.startswith(("http://", "https://")):
        result["error"] = "invalid_url"
        return result
    req = urllib.request.Request(
        url,
        method="HEAD",
        headers={"User-Agent": "RadKey-Verify/1.0 (+static fact-check)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result["ok"] = 200 <= resp.status < 400
            result["status"] = resp.status
    except urllib.error.HTTPError as e:
        result["status"] = e.code
        result["error"] = str(e.reason)
    except Exception as e:
        result["error"] = str(e)[:200]
    return result


def load_denials() -> dict:
    path = DENIALS_PATH if DENIALS_PATH.is_file() else DENIALS_SCAFFOLD
    if not path.is_file():
        return {"denials": [], "conflicts": []}
    doc = load_json(path)
    return {"denials": doc.get("denials") or [], "conflicts": doc.get("conflicts") or []}


def moment_matches_denial(moment: dict, denial: dict) -> bool:
    match = denial.get("match") or {}
    mid = moment.get("id")
    if match.get("moment_id") and match["moment_id"] != mid:
        return False
    if match.get("title_contains"):
        needle = match["title_contains"].lower()
        if needle not in (moment.get("title") or "").lower():
            return False
    if match.get("title_norm"):
        if norm_title(moment.get("title")) != norm_title(match["title_norm"]):
            return False
    if match.get("moment_id") or match.get("title_contains") or match.get("title_norm"):
        return True
    return False


def base_verification(
    moment: dict,
    *,
    curated_ids: set[str],
    source_rows: list[str],
    source_rows_resolved: list[dict],
) -> dict:
    prov = moment.get("provenance") or {}
    checked_at = utc_now()
    conflicts: list[dict] = []
    notes: list[str] = []

    if moment.get("category") == "music_video" and moment.get("youtube_id"):
        return {
            "status": "verified",
            "label": "Official release",
            "notes": "YouTube / Epitaph release row in RCU.",
            "checked_at": checked_at,
            "sources": source_rows_resolved,
            "conflicts": conflicts,
        }

    if moment.get("id") in curated_ids:
        if moment.get("source_ids") or source_rows_resolved or has_strong_sources(source_rows_resolved):
            return {
                "status": "verified",
                "label": "Curated — cited source",
                "notes": "Hand-curated moment with RCU source ids.",
                "checked_at": checked_at,
                "sources": source_rows_resolved,
                "conflicts": conflicts,
            }

    if prov.get("inferred_date"):
        notes.append("Year inferred from Wikipedia section text (no event_date in RCU).")
        return {
            "status": "unproven",
            "label": "Unproven - Site source",
            "notes": " ".join(notes),
            "checked_at": checked_at,
            "sources": source_rows_resolved,
            "conflicts": conflicts,
        }

    eid = prov.get("event_id")
    if eid or moment.get("id", "").startswith("life-"):
        if is_wiki_only(source_rows_resolved) or not source_rows_resolved:
            note = "Imported from Wikipedia via RCU (automated scrape)."
            if not source_rows_resolved:
                note += " No event_sources link in RCU."
            return {
                "status": "unproven",
                "label": "Unproven - Site source",
                "notes": note,
                "checked_at": checked_at,
                "sources": source_rows_resolved,
                "conflicts": conflicts,
            }

    if moment.get("youtube_id"):
        return {
            "status": "verified",
            "label": "Public video",
            "notes": "RCU video record with YouTube id.",
            "checked_at": checked_at,
            "sources": source_rows_resolved,
            "conflicts": conflicts,
        }

    return {
        "status": "unproven",
        "label": "Unproven - Site source",
        "notes": "No strong verification rule matched.",
        "checked_at": checked_at,
        "sources": source_rows_resolved,
        "conflicts": conflicts,
    }


def apply_duplicate_rules(moments: list[dict], verifications: dict[str, dict]) -> None:
    by_title: dict[str, list[dict]] = defaultdict(list)
    for m in moments:
        key = norm_title(m.get("title"))
        if len(key) >= 8:
            by_title[key].append(m)

    for key, group in by_title.items():
        if len(group) < 2:
            continue
        years = {m.get("year") for m in group}
        if len(years) <= 1:
            continue
        ids = [m["id"] for m in group]
        conflict = {
            "type": "duplicate_title_date_mismatch",
            "title_norm": key,
            "moment_ids": ids,
            "years": sorted(y for y in years if y is not None),
            "summary": "Same normalized title appears on multiple timeline years.",
        }
        for m in group:
            mid = m["id"]
            v = verifications[mid]
            v["status"] = "conflict"
            v["label"] = "Conflicting dates"
            v.setdefault("conflicts", []).append(conflict)
            prev = v.get("notes") or ""
            v["notes"] = (prev + " Duplicate title across years.").strip()


def apply_denials(
    moments: list[dict], verifications: dict[str, dict], denials_doc: dict
) -> None:
    for denial in denials_doc.get("denials") or []:
        for m in moments:
            if not moment_matches_denial(m, denial):
                continue
            mid = m["id"]
            v = verifications[mid]
            v["status"] = "disputed"
            v["label"] = denial.get("label") or "Disputed — denial on record"
            entry = {
                "type": "denial",
                "denied_by": denial.get("denied_by"),
                "source_url": denial.get("source_url"),
                "summary": denial.get("summary"),
                "recorded_at": denial.get("checked_at") or denial.get("recorded_at"),
            }
            v.setdefault("conflicts", []).append(entry)
            note = denial.get("summary") or "Matched verification_denials entry."
            v["notes"] = note

    for ext in denials_doc.get("conflicts") or []:
        target_ids = ext.get("moment_ids") or []
        for mid in target_ids:
            if mid not in verifications:
                continue
            v = verifications[mid]
            v["status"] = ext.get("status") or "conflict"
            v["label"] = ext.get("label") or "Conflicting sources"
            v.setdefault("conflicts", []).append(
                {k: v2 for k, v2 in ext.items() if k not in ("moment_ids", "status", "label")}
            )


def slim_verification(full: dict) -> dict:
    return {
        "status": full.get("status"),
        "label": full.get("label"),
    }


def main() -> None:
    if not TIMELINE_PATH.is_file():
        raise SystemExit(f"Missing {TIMELINE_PATH} — run build_from_rcu.py first")

    timeline = load_json(TIMELINE_PATH)
    moments: list[dict] = timeline.get("moments") or []

    curated_by_id: dict[str, dict] = {}
    if CURATED_PATH.is_file():
        for m in load_json(CURATED_PATH).get("moments") or []:
            if m.get("id"):
                curated_by_id[m["id"]] = m
    curated_ids = set(curated_by_id)

    sources_by_id: dict[str, dict] = {}
    event_sources: dict[str, list[str]] = {}
    cited_facts: list[dict] = []

    if RCU_DB.is_file():
        conn = sqlite3.connect(RCU_DB)
        conn.row_factory = sqlite3.Row
        for row in conn.execute("SELECT source_id, url, kind, excerpt FROM sources"):
            sources_by_id[row["source_id"]] = dict(row)
        for row in conn.execute("SELECT event_id, source_id FROM event_sources"):
            event_sources.setdefault(row["event_id"], []).append(row["source_id"])
        cited_facts = [dict(r) for r in conn.execute("SELECT fact_key, value_text, source_id, confidence FROM cited_facts")]
        conn.close()

    denials_doc = load_denials()
    verifications: dict[str, dict] = {}
    rule_hits: dict[str, int] = defaultdict(int)

    fetch_urls = os.environ.get("VERIFY_FETCH", "").strip() in ("1", "true", "yes")
    url_probes: list[dict] = []

    for m in moments:
        mid = m["id"]
        enriched = dict(m)
        if mid in curated_by_id:
            for k, v in curated_by_id[mid].items():
                if k not in enriched or enriched[k] is None:
                    enriched[k] = v
        detail_path = MOMENTS_DIR / f"{mid}.json"
        if detail_path.is_file():
            detail_sources = load_json(detail_path).get("sources") or []
            if detail_sources and not enriched.get("source_ids"):
                enriched["source_ids"] = [
                    s.get("source_id") for s in detail_sources if s.get("source_id")
                ]
        sids = source_ids_for_moment(enriched, event_sources)
        resolved = resolve_source_rows(sids, sources_by_id)
        v = base_verification(
            enriched,
            curated_ids=curated_ids,
            source_rows=sids,
            source_rows_resolved=resolved,
        )
        rule_hits[v["status"]] += 1
        verifications[mid] = v

        if fetch_urls:
            for row in resolved:
                url = row.get("url")
                if url and len(url_probes) < 40:
                    probe = probe_url(url)
                    url_probes.append(probe)
                    if not probe["ok"]:
                        v["notes"] = ((v.get("notes") or "") + f" Source URL probe failed ({url}).").strip()

    apply_duplicate_rules(moments, verifications)
    for v in verifications.values():
        if v["status"] in ("conflict", "disputed"):
            rule_hits[v["status"]] += 1

    apply_denials(moments, verifications, denials_doc)

    for m in moments:
        mid = m["id"]
        full = verifications[mid]
        m["verification"] = slim_verification(full)

        detail_path = MOMENTS_DIR / f"{mid}.json"
        if not detail_path.is_file():
            continue
        detail = load_json(detail_path)
        detail["verification"] = full
        if detail.get("schema_version", 1) < 2:
            detail["schema_version"] = 2
        save_json(detail_path, detail)

    timeline["verification_pass"] = {
        "checked_at": utc_now(),
        "rules_version": 1,
        "counts_by_status": dict(rule_hits),
    }
    save_json(TIMELINE_PATH, timeline)

    examples = {
        "unproven": [mid for mid, v in verifications.items() if v["status"] == "unproven"][:8],
        "conflict": [mid for mid, v in verifications.items() if v["status"] == "conflict"][:5],
        "disputed": [mid for mid, v in verifications.items() if v["status"] == "disputed"][:5],
        "verified": [mid for mid, v in verifications.items() if v["status"] == "verified"][:5],
    }

    report = {
        "schema_version": 1,
        "generated_at": utc_now(),
        "rcu_db": str(RCU_DB),
        "rules": [
            "music_video+youtube_id -> verified (Official release)",
            "curated id + source_ids -> verified (Curated — cited source)",
            "life_events wiki-only or no event_sources -> unproven (Unproven - Site source)",
            "provenance.inferred_date -> unproven",
            "duplicate normalized title across different years -> conflict",
            "data/verification_denials.json denials -> disputed + conflicts[]",
        ],
        "counts_by_status": dict(rule_hits),
        "examples": examples,
        "cited_facts_sample": cited_facts[:10],
        "url_probes": url_probes if fetch_urls else [],
        "future_scraper": {
            "denials_file": str(DENIALS_PATH.relative_to(ROOT)),
            "scaffold": str(DENIALS_SCAFFOLD.relative_to(ROOT)),
            "conflicts_field": "verification.conflicts[] on each moment detail shard",
        },
    }
    save_json(REPORT_PATH, report)

    print(
        f"verify_claims: {len(moments)} moments — "
        f"{rule_hits.get('verified', 0)} verified, "
        f"{rule_hits.get('unproven', 0)} unproven, "
        f"{rule_hits.get('conflict', 0)} conflict, "
        f"{rule_hits.get('disputed', 0)} disputed -> {REPORT_PATH.name}"
    )


if __name__ == "__main__":
    main()
