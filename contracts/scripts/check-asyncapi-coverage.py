#!/usr/bin/env python3
"""Cek cakupan katalog event WebSocket <-> contracts/asyncapi.yaml.

Sumber kebenaran: docs/specs/websocket-aplikasi-darurat.md §5 (server -> klien)
dan §6 (klien -> server). Bila beda, perbaiki kontrak (atau catat di
docs/CONTRACT_CHANGES.md bila dokumennya yang perlu keputusan manusia).

Membandingkan: nama event, kelas pengiriman (C/S/I -> CRITICAL/STANDARD/INFO;
"C bila ... S" -> DYNAMIC), ackRequired, dan pola room yang disebut dokumen.
Keluar non-nol bila ada selisih.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
WS_DOC = ROOT / "docs" / "specs" / "websocket-aplikasi-darurat.md"
ASYNC = ROOT / "contracts" / "asyncapi.yaml"

CLASS_MAP = {"C": "CRITICAL", "S": "STANDARD", "I": "INFO"}
ROOM_RE = re.compile(r"\b(?:role|org|unit|user|region|incident|dispatch):[\w{}]+")
EVENT_RE = re.compile(r"`([a-z][a-z0-9_]*\.[a-z0-9_]+)`")
ACK_STATES = {"DELIVERED", "SEEN"}


def parse_class(cell: str) -> str | None:
    t = cell.replace("**", "").replace("`", "").strip()
    if not t or t == "-":
        return None
    if "bila" in t or (re.search(r"\bC\b", t) and re.search(r"\bS\b", t)):
        return "DYNAMIC"
    m = re.match(r"^([CIS])\b", t)
    return CLASS_MAP.get(m.group(1)) if m else None


def doc_rows(section: str) -> dict[str, dict]:
    """-> {event: {class, ackRequired, rooms}} dari tabel katalog dokumen."""
    out: dict[str, dict] = {}
    for line in section.splitlines():
        if not line.startswith("|") or line.startswith("|---") or "| Event |" in line:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3 or "`" not in cells[0]:
            continue
        names = EVENT_RE.findall(cells[0])
        if not names:
            continue
        cls = parse_class(cells[2]) if len(cells) > 2 else None
        ack = "ackRequired" in (cells[2] if len(cells) > 2 else "")
        rooms = set(ROOM_RE.findall(cells[1])) if len(cells) > 1 else set()
        for n in names:
            out[n] = {"class": cls, "ackRequired": ack, "rooms": rooms}
    return out


def main() -> int:
    text = WS_DOC.read_text(encoding="utf-8")
    m5 = re.search(r"^## 5\. Katalog Event.*?$(?=\n^## 6\. )", text, re.M | re.S)
    m6 = re.search(r"^## 6\. Event Klien → Server.*?$(?=\n^---|\n^## 7\.)", text, re.M | re.S)
    if not m5 or not m6:
        print("SECTION: bagian §5/§6 tidak ditemukan di dokumen WS")
        return 1

    doc_s2c = doc_rows(m5.group(0))
    doc_c2s_names = []
    for line in m6.group(0).splitlines():
        if line.startswith("|") and not line.startswith("|---") and "| Event |" not in line:
            cell = line.split("|")[1]
            doc_c2s_names += re.findall(r"`([a-z][a-z0-9_.]*)`", cell)

    spec = yaml.safe_load(ASYNC.read_text(encoding="utf-8"))
    msgs = spec["components"]["messages"]
    kon_s2c = {v["name"]: v for v in msgs.values() if v.get("x-direction") == "s2c"}
    kon_c2s = {v["name"]: v for v in msgs.values() if v.get("x-direction") == "c2s"}

    problems: list[str] = []

    for name in sorted(set(doc_s2c) - set(kon_s2c)):
        problems.append(f"MISSING in asyncapi: {name}")
    for name in sorted(set(kon_s2c) - set(doc_s2c)):
        problems.append(f"EXTRA in asyncapi: {name}")
    for name in sorted(set(doc_c2s_names) - set(kon_c2s)):
        problems.append(f"MISSING c2s in asyncapi: {name}")
    for name in sorted(set(kon_c2s) - set(doc_c2s_names)):
        problems.append(f"EXTRA c2s in asyncapi: {name}")

    for name, want in doc_s2c.items():
        got = kon_s2c.get(name)
        if not got:
            continue
        if want["class"] and got.get("x-class") != want["class"]:
            problems.append(
                f"CLASS {name}: dokumen={want['class']} kontrak={got.get('x-class')}"
            )
        if bool(got.get("x-ack-required")) != want["ackRequired"]:
            problems.append(
                f"ACK {name}: dokumen={want['ackRequired']} kontrak={got.get('x-ack-required')}"
            )
        rooms = set(got.get("x-rooms") or [])
        for room in want["rooms"]:
            if room not in rooms:
                problems.append(f"ROOM {name}: dokumen menyebut `{room}` tidak ada di x-rooms")

    if problems:
        print("ASYNC COVERAGE: FAIL")
        for p in problems:
            print(" -", p)
        return 1

    print(f"ASYNC COVERAGE: OK ({len(doc_s2c)} event s2c, {len(doc_c2s_names)} event c2s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
