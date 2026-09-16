"""Rebuild and verify Ubuntu subsets without changing the original fonts.

Requires fonttools[woff]==4.65.0. Run from any directory; --check verifies the
committed outputs without writing. Outlines, advances, hinting, layout features,
names and vertical metrics are retained. CSS ranges partition the original cmap.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FONT_DIR = ROOT / "artifacts/megaradio/public/fonts"
WEIGHTS = (400, 500, 700)
SUBSETS = ("latin", "latin-ext", "greek", "cyrillic")


def group(codepoint: int) -> str:
    if 0x0100 <= codepoint <= 0x02AF or 0x1E00 <= codepoint <= 0x1EFF:
        return "latin-ext"
    if 0x0370 <= codepoint <= 0x03FF or 0x1F00 <= codepoint <= 0x1FFF:
        return "greek"
    if 0x0400 <= codepoint <= 0x052F or 0x2DE0 <= codepoint <= 0x2DFF or 0xA640 <= codepoint <= 0xA69F:
        return "cyrillic"
    if 0xE000 <= codepoint <= 0xF8FF:
        return "remaining"
    # Basic Latin, punctuation, currency, combining marks and ligatures used
    # across scripts share the small base face; no original Unicode is removed.
    return "latin"


def ranges(points: set[int]) -> str:
    runs: list[list[int]] = []
    for codepoint in sorted(points):
        if runs and runs[-1][1] + 1 == codepoint:
            runs[-1][1] = codepoint
        else:
            runs.append([codepoint, codepoint])
    return ", ".join(f"U+{start:X}" if start == end else f"U+{start:X}-{end:X}" for start, end in runs)


def verify(original: TTFont, candidate: TTFont, expected: set[int]) -> None:
    original_map, candidate_map = original.getBestCmap(), candidate.getBestCmap()
    assert set(candidate_map) == expected, "Subset Unicode coverage changed"
    for table, attributes in {
        "head": ("unitsPerEm",),
        "hhea": ("ascent", "descent", "lineGap", "caretSlopeRise", "caretSlopeRun", "caretOffset"),
        "OS/2": ("sTypoAscender", "sTypoDescender", "sTypoLineGap", "usWinAscent", "usWinDescent", "sxHeight", "sCapHeight"),
    }.items():
        for attribute in attributes:
            assert getattr(original[table], attribute, None) == getattr(candidate[table], attribute, None), (table, attribute)
    for tag in ("cvt ", "fpgm", "prep"):
        assert original.getTableData(tag) == candidate.getTableData(tag), f"Hinting table {tag} changed"
    for codepoint, candidate_name in candidate_map.items():
        original_name = original_map[codepoint]
        assert original["hmtx"][original_name] == candidate["hmtx"][candidate_name], f"Advance changed: U+{codepoint:04X}"
        before = original["glyf"][original_name]
        after = candidate["glyf"][candidate_name]
        assert before.getCoordinates(original["glyf"]) == after.getCoordinates(candidate["glyf"]), f"Outline changed: U+{codepoint:04X}"
        assert getattr(before, "program", None) == getattr(after, "program", None), f"Glyph hints changed: U+{codepoint:04X}"
    for tag in ("GSUB", "GPOS"):
        assert tag in candidate, f"Missing shaping table {tag}"
        original_features = {record.FeatureTag for record in original[tag].table.FeatureList.FeatureRecord}
        assert {record.FeatureTag for record in candidate[tag].table.FeatureList.FeatureRecord} <= original_features


def font_css(partitions: dict[str, set[int]], local: bool) -> str:
    faces = []
    for weight, local_name in ((400, "Ubuntu"), (500, "Ubuntu Medium"), (600, "Ubuntu SemiBold"), (700, "Ubuntu Bold")):
        asset_weight = 700 if weight == 600 else weight
        for name in (*SUBSETS, "remaining"):
            suffix = "" if name == "remaining" else f"-{name}"
            source = (f"local('{local_name}'), " if local else "") + f"url('/fonts/ubuntu-{asset_weight}{suffix}.woff2') format('woff2')"
            faces.append("@font-face {\n  font-family: 'Ubuntu';\n  src: " + source
                + f";\n  font-weight: {weight};\n  font-display: swap;\n  unicode-range: {ranges(partitions[name])};\n}}")
    return "\n\n".join(faces)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--css", action="store_true", help="Include matching CSS blocks in the JSON report")
    args = parser.parse_args()
    results = []
    common_partitions = None
    for weight in WEIGHTS:
        source = FONT_DIR / f"ubuntu-{weight}.woff2"
        original = TTFont(source, recalcTimestamp=False)
        coverage = set(original.getBestCmap())
        partitions = {name: {point for point in coverage if group(point) == name} for name in (*SUBSETS, "remaining")}
        assert set.union(*partitions.values()) == coverage
        assert sum(map(len, partitions.values())) == len(coverage)
        if common_partitions is None:
            common_partitions = partitions
        assert common_partitions == partitions, "Weights must keep identical Unicode ranges"
        outputs = []
        for name in SUBSETS:
            target = FONT_DIR / f"ubuntu-{weight}-{name}.woff2"
            if not args.check:
                font = TTFont(source, recalcTimestamp=False)
                options = subset.Options()
                options.layout_features = ["*"]
                options.layout_scripts = ["*"]
                options.name_IDs = ["*"]
                options.name_legacy = True
                options.name_languages = ["*"]
                options.notdef_outline = True
                options.recommended_glyphs = True
                options.recalc_timestamp = False
                worker = subset.Subsetter(options=options)
                worker.populate(unicodes=partitions[name])
                worker.subset(font)
                font.flavor = "woff2"
                font.save(target)
            verify(original, TTFont(target, recalcTimestamp=False), partitions[name])
            outputs.append({"file": target.name, "bytes": target.stat().st_size, "unicodeCount": len(partitions[name])})
        results.append({"weight": weight, "originalBytes": source.stat().st_size, "subsets": outputs})
    report = {"verified": True, "fonts": results,
        "ranges": {name: ranges(points) for name, points in common_partitions.items()}}
    if args.css:
        report["mainCss"] = font_css(common_partitions, local=True)
        report["criticalCss"] = font_css(common_partitions, local=False)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
