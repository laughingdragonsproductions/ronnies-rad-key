#!/usr/bin/env python3
"""Copy RCU curated library stills into site/assets/ref/library/."""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RCU_ROOT = Path(
    os.environ.get("RCU_ROOT") or r"G:\LocalAIagent\rcu-universe"
)
LIB_JSON = RCU_ROOT / "data" / "library.json"
SRC_ASSETS = RCU_ROOT / "data" / "library" / "assets"
DST_ASSETS = ROOT / "site" / "assets" / "ref" / "library"


def main() -> int:
    if not LIB_JSON.is_file():
        print(f"sync_rcu_library: no {LIB_JSON} (skip)")
        return 0
    doc = json.loads(LIB_JSON.read_text(encoding="utf-8"))
    DST_ASSETS.mkdir(parents=True, exist_ok=True)
    copied = 0
    for item in doc.get("items") or []:
        rel = item.get("file") or ""
        if not rel.startswith("library/assets/"):
            continue
        name = Path(rel).name
        src = SRC_ASSETS / name
        if not src.is_file():
            src = RCU_ROOT / "data" / rel.replace("/", os.sep)
        if not src.is_file():
            print(f"  missing: {src}")
            continue
        shutil.copy2(src, DST_ASSETS / name)
        copied += 1
    print(f"sync_rcu_library: {copied} file(s) -> {DST_ASSETS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
