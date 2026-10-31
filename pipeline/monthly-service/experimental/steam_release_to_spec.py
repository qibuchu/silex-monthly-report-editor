"""Map audited SteamAuto new-release rows onto preserved PPTX tables and continuations."""

import argparse
import hashlib
import json
import zipfile
import calendar
import re
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from xml.etree import ElementTree

from pptx_preserve_patch import table_values
from steam_head_to_spec import previous_month


TABLES = {
    "gold": (5, 10, 6, 10, 8),
    "silver": (5, 10, 7, 8, 6),
    "bronze": (9, 11, 6, 19, 17),
}

NS = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main",
      "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def shape_texts(xml):
    root = ElementTree.fromstring(xml)
    return {int(marker.get("id")): "".join(t.text or "" for t in shape.findall(".//a:t", NS))
            for shape in root.findall(".//p:sp", NS)
            if (marker := shape.find("p:nvSpPr/p:cNvPr", NS)) is not None}


def presentation_order(archive):
    root = ElementTree.fromstring(archive.read("ppt/presentation.xml"))
    rels = ElementTree.fromstring(archive.read("ppt/_rels/presentation.xml.rels"))
    targets = {rel.get("Id"): rel.get("Target", "") for rel in rels}
    slides = []
    for item in root.findall("p:sldIdLst/p:sldId", NS):
        target = targets[item.get("{" + NS["r"] + "}id")]
        match = re.fullmatch(r"slides/slide(\d+)\.xml", target)
        if not match:
            raise ValueError("Presentation slide target changed")
        slides.append(int(match.group(1)))
    return slides


def metric(game, key, month, issues):
    item = ((game.get("day14") or {}).get("metrics") or {}).get(key) or {}
    window = item.get("window") or {}
    if item.get("status") != "ok" or item.get("value") is None or window.get("missing_dates"):
        issues.append({"appid": game.get("appid"), "field": key, "reason": item.get("reason") or "missing_or_incomplete"})
        return None
    release = date.fromisoformat(game["release_date"])
    if release.strftime("%Y-%m") != month or date.fromisoformat(window.get("start", "")) != release or date.fromisoformat(window.get("end", "")) != release + timedelta(days=13):
        raise ValueError(f"{key} is not the game's D0-D13 window")
    return Decimal(str(item["value"]))


def format_row(game, month, issues):
    rank = game.get("revenue_rank_in_tier")
    name = game.get("game_name")
    if (rank is not None and not isinstance(rank, int)) or not isinstance(name, str) or not name.strip():
        raise ValueError("New-release rank or game name invalid")
    if rank is None:
        issues.append({"appid": game.get("appid"), "field": "revenue_rank_in_tier", "reason": "upstream_rank_missing"})
    revenue = metric(game, "revenue_14d_usd", month, issues)
    change = metric(game, "player_change_14d", month, issues)
    revenue_text = (str((revenue / 10000).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)) + "万") if revenue is not None else ""
    change_text = (str(change.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)) + "%") if change is not None else ""
    tags = game.get("tags") or []
    return [str(rank) if rank is not None else "", name, " / ".join(tags[:2]), revenue_text, change_text]


def make_spec(template: Path, data: dict, audit: dict):
    month = data.get("report_month")
    if data.get("schema_version") != "2.0" or not isinstance(month, str) or data.get("previous_month") != previous_month(month):
        raise ValueError("Monthly data schema or comparison month mismatch")
    if audit.get("month") != month or audit.get("snapshot_id") != data.get("snapshot_id") or audit.get("contract_errors"):
        raise ValueError("Data audit does not match source snapshot")
    issues, replacements = [], []
    with zipfile.ZipFile(template) as archive:
        if archive.testzip() is not None:
            raise ValueError("Template PPTX ZIP damaged")
        for tier, (slide, continuation, table_id, capacity, main_count) in TABLES.items():
            games = sorted((data.get("new_releases") or {}).get(tier) or [], key=lambda game: game.get("revenue_rank_in_tier") or 999)
            ranks = [game.get("revenue_rank_in_tier") for game in games if game.get("revenue_rank_in_tier") is not None]
            if ranks != list(range(1, len(ranks) + 1)):
                raise ValueError(f"{tier} ranking is duplicated or discontinuous")
            if len(games) > capacity * 2:
                raise ValueError(f"{tier} needs more than one continuation page")
            rows = [format_row(game, month, issues) for game in games]
            for target, portion in ((slide, rows[:main_count]), (continuation, rows[main_count:])):
                old = table_values(archive.read(f"ppt/slides/slide{target}.xml"), table_id)
                if len(old) != capacity + 2 or len(old[1]) != 5:
                    raise ValueError(f"Reviewed {tier} table geometry changed")
                if not old[0][0].startswith("7月"):
                    raise ValueError(f"Reviewed {tier} title changed")
                replacements.append({"kind": "table", "slide": target, "tableId": table_id,
                                     "headerRow": 1, "expectedHeader": old[1], "rows": portion})
                replacements.append({"slide": target, "tableId": table_id, "row": 0, "column": 0,
                                     "expected": old[0][0], "value": old[0][0].replace("7月", str(int(month[5:])) + "月", 1)})
                replacements.append({"kind": "trimTable", "slide": target, "tableId": table_id,
                                     "keepRows": 2 + len(portion)})
        year, number = map(int, month.split("-"))
        end_date = f"{year}.{number:02d}.{calendar.monthrange(year, number)[1]}"
        for slide in (5, 9, 10, 11):
            texts = shape_texts(archive.read(f"ppt/slides/slide{slide}.xml"))
            for shape_id, old, new in ((4, "2026年7月", f"{year}年{number}月"),
                                       (24, "2026.07.31", end_date)):
                if old not in texts.get(shape_id, ""):
                    raise ValueError("Release page month shape changed")
                replacements.append({"kind": "shapeText", "slide": slide, "shapeId": shape_id,
                                     "expectedText": texts[shape_id], "oldFragment": old, "newFragment": new})
        order = presentation_order(archive)
        if len(order) != 11:
            raise ValueError("Reviewed continuation plan does not have 11 pages")
        for position, slide in enumerate(order, 1):
            texts = shape_texts(archive.read(f"ppt/slides/slide{slide}.xml"))
            numbers = [(shape_id, value) for shape_id, value in texts.items() if re.fullmatch(r"\d{2} / \d{2}", value)]
            if len(numbers) > 1:
                raise ValueError("Ambiguous page number shape")
            if numbers:
                shape_id, old = numbers[0]
                replacements.append({"kind": "shapeText", "slide": slide, "shapeId": shape_id,
                                     "expectedText": old, "oldFragment": old,
                                     "newFragment": f"{position:02d} / {len(order):02d}"})
    return {"sourceSha256": hashlib.sha256(template.read_bytes()).hexdigest(),
            "reportMonth": month, "dataSnapshotId": data["snapshot_id"],
            "issues": issues, "replacements": replacements}


def main():
    parser = argparse.ArgumentParser()
    for name in ("template", "data", "audit", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    load = lambda path: json.loads(path.read_text(encoding="utf-8"))
    spec = make_spec(args.template, load(args.data), load(args.audit))
    args.output.write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "tableCount": 6, "issues": len(spec["issues"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
