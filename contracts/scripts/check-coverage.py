#!/usr/bin/env python3
"""Pemeriksaan cakupan: tabel endpoint REST §5 vs paths di contracts/openapi.yaml.

Gagal (exit 1) bila ada endpoint di dokumen yang tidak ada di kontrak.
Endpoint di kontrak yang tidak ada di dokumen dilaporkan sebagai peringatan.
Dipakai oleh `make contract`.
"""
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "docs" / "specs" / "rest-api-aplikasi-darurat.md"
OPENAPI = ROOT / "contracts" / "openapi.yaml"

METHODS = "GET|POST|PUT|PATCH|DELETE"
ROW = re.compile(r"^\|\s*(" + METHODS + r")\s*\|(.+)$", re.M)
BACKTICK = re.compile(r"`([^`]+)`")


def normalize(path: str) -> str:
    path = path.split("?")[0].strip()
    if not path.startswith("/"):
        path = "/" + path
    return path


def doc_endpoints() -> set[tuple[str, str]]:
    spec = SPEC.read_text(encoding="utf-8")
    eps: set[tuple[str, str]] = set()
    for row in ROW.finditer(spec):
        method = row.group(1)
        paths = BACKTICK.findall(row.group(2))
        for p in paths:
            if "/" not in p:
                continue
            eps.add((method, normalize(p)))
    return eps


def contract_endpoints() -> set[tuple[str, str]]:
    doc = yaml.safe_load(OPENAPI.read_text(encoding="utf-8"))
    eps: set[tuple[str, str]] = set()
    for path, item in doc.get("paths", {}).items():
        for method in item:
            if method.upper() in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                eps.add((method.upper(), path))
    return eps


def main() -> int:
    doc = doc_endpoints()
    con = contract_endpoints()
    doc_only = sorted(doc - con)
    con_only = sorted(con - doc)

    print(f"Endpoint dokumen : {len(doc)}")
    print(f"Endpoint kontrak : {len(con)}")

    if doc_only:
        print(f"\nHILANG di kontrak ({len(doc_only)}):")
        for m, p in doc_only:
            print(f"  {m:6} {p}")
    if con_only:
        print(f"\nDi kontrak, tidak di dokumen ({len(con_only)}):")
        for m, p in con_only:
            print(f"  {m:6} {p}")

    if doc_only:
        print("\nCOVERAGE: GAGAL")
        return 1
    print("\nCOVERAGE: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
