#!/usr/bin/env python3
"""Anonymise a bank statement (CSV or XLSX) for use as a test fixture.

Usage:
  python3 -I tools/anonymise_statement.py MAPPING.json INPUT OUTPUT

MAPPING.json lives next to the raw statements in fixtures/statements/raw/ (gitignored),
so real values never enter the repo. Format:

  {
    "replace": [["real string", "fake string"], ...],          # applied in order, longest first
    "wrapped": [["real unwrapped text", "fake unwrapped text"], ...],
    "forbid":  ["token that must not appear in output", ...]
  }

"wrapped" entries handle bank exports that split long SWIFT fields into 35-character
lines joined by a backslash: both sides are wrapped the same way before replacing.

Only bytes inside text are changed; encoding, line endings and XLSX structure are kept.
Exits non-zero if any "forbid" token (case-insensitive) survives.
"""
import json
import sys
import zipfile

WRAP = 35


def wrap35(text: str) -> str:
    return "\\".join(text[i:i + WRAP] for i in range(0, len(text), WRAP))


def build_pairs(mapping):
    pairs = [(a, b) for a, b in mapping.get("wrapped", [])]
    pairs += [(wrap35(a), wrap35(b)) for a, b in mapping.get("wrapped", [])]
    pairs += [(a, b) for a, b in mapping.get("replace", [])]
    pairs.sort(key=lambda p: len(p[0]), reverse=True)
    return pairs


def anonymise_text(text: str, pairs) -> str:
    for real, fake in pairs:
        text = text.replace(real, fake)
    return text


def check(blob: str, forbid, where: str) -> list:
    low = blob.lower()
    return [f"{where}: '{tok}'" for tok in forbid if tok.lower() in low]


def main(mapping_path, src, dst):
    mapping = json.load(open(mapping_path, encoding="utf-8"))
    pairs = build_pairs(mapping)
    forbid = mapping.get("forbid", [])
    leaks = []

    if src.lower().endswith(".xlsx"):
        with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
            for info in zin.infolist():
                data = zin.read(info.filename)
                if info.filename.endswith((".xml", ".rels")):
                    text = anonymise_text(data.decode("utf-8"), pairs)
                    leaks += check(text, forbid, info.filename)
                    data = text.encode("utf-8")
                zout.writestr(info, data, compress_type=info.compress_type)
    else:
        raw = open(src, "rb").read()
        text = anonymise_text(raw.decode("utf-8"), pairs)
        leaks += check(text, forbid, "csv")
        open(dst, "wb").write(text.encode("utf-8"))

    if leaks:
        print("LEAKS FOUND, output is not safe:\n  " + "\n  ".join(leaks), file=sys.stderr)
        sys.exit(1)
    print(f"ok: {dst}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
