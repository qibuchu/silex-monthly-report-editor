"""Adapt an audited offline SteamAuto monthly package to a preserved PPTX table."""

import argparse
import calendar
import hashlib
import json
import re
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path


def percent(value):
    if value is None:
        return ""
    number = (Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return ("+" if number > 0 else "") + str(number) + "%"


def previous_month(month):
    year, number = map(int, month.split("-"))
    return f"{year - 1}-12" if number == 1 else f"{year}-{number - 1:02d}"


def make_spec(template: Path, binding: dict, data: dict, audit: dict):
    template_hash = hashlib.sha256(template.read_bytes()).hexdigest()
    if template_hash != binding["templateSha256"]:
        raise ValueError("PPTX template hash differs from reviewed binding")
    month = data.get("report_month")
    if not isinstance(month, str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise ValueError("Invalid report month")
    if data.get("schema_version") != "2.0" or data.get("previous_month") != previous_month(month):
        raise ValueError("Data schema or previous month mismatch")
    if audit.get("month") != month or audit.get("snapshot_id") != data.get("snapshot_id") or audit.get("contract_errors"):
        raise ValueError("Data and window audit do not match")
    head = data.get("head") or {}
    if head.get("status") != "ready" or head.get("revenue_status") != "ready" or head.get("missing_weeks") or head.get("missing_previous_weeks"):
        raise ValueError("Head leaderboard is incomplete")
    if len(head.get("weeks") or []) != 4 or len(head.get("previous_weeks") or []) != 4:
        raise ValueError("Head leaderboard does not cover four weeks per month")
    games = sorted(head.get("top20") or [], key=lambda item: item.get("rank", 999))
    if len(games) != binding["capacity"] or [game.get("rank") for game in games] != list(range(1, binding["capacity"] + 1)):
        raise ValueError("Head leaderboard ranks or template capacity differ")
    issues = []
    rows = []
    for game in games:
        if not isinstance(game.get("name"), str) or not game["name"].strip():
            raise ValueError("Head game name missing")
        growth = percent(game.get("revenue_growth")) if game.get("revenue_growth_status") == "ok" and game.get("revenue_growth_unit") == "ratio_0_1" else ""
        delta = game.get("rank_delta") if game.get("rank_delta_status") == "ok" else None
        if delta is not None and (not isinstance(delta, int) or isinstance(delta, bool)):
            raise ValueError("Rank delta must be the upstream integer")
        rank_display = ("+" + str(delta) if delta > 0 else str(delta)) if delta else ("-" if delta == 0 else "")
        if not growth or delta is None:
            issues.append({"rank": game["rank"], "appid": game.get("appid"), "missing": [key for key, ok in (("revenue_growth", bool(growth)), ("rank_delta", delta is not None)) if not ok]})
        rows.append([str(game["rank"]), game["name"], growth, rank_display])
    expected_header = binding["expectedHeader"]
    if expected_header != ["排名", "游戏名", "环比6月涨幅", "营收榜排名环比"]:
        raise ValueError("Reviewed head table header changed")
    new_header = [expected_header[0], expected_header[1], f"环比{int(data['previous_month'][-2:])}月涨幅", expected_header[3]]
    year, number = map(int, month.split('-'))
    replacements = [{"kind": "table", "slide": binding["slide"], "tableId": binding["tableId"],
                     "headerRow": binding["headerRow"], "expectedHeader": expected_header,
                     "newHeader": new_header, "rows": rows}]
    formats = {"month_label": f"{number}月", "month_end": f"{year}.{number:02d}.{calendar.monthrange(year, number)[1]}"}
    for item in binding.get("monthText", []):
        if item.get("format") not in formats:
            raise ValueError("Unknown month text format")
        replacements.append({"kind": "shapeText", "slide": item["slide"], "shapeId": item["shapeId"],
                             "expectedText": item["expectedText"], "oldFragment": item["oldFragment"],
                             "newFragment": formats[item["format"]]})
    return {"sourceSha256": template_hash, "reportMonth": month,
            "dataSnapshotId": data["snapshot_id"], "issues": issues,
            "replacements": replacements}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("template", type=Path)
    parser.add_argument("binding", type=Path)
    parser.add_argument("data", type=Path)
    parser.add_argument("audit", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    load = lambda path: json.loads(path.read_text(encoding="utf-8"))
    spec = make_spec(args.template, load(args.binding), load(args.data), load(args.audit))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    issues_path = args.output.with_name(args.output.stem + '.issues.json')
    issues_path.write_text(json.dumps({"reportMonth": spec["reportMonth"], "snapshotId": spec["dataSnapshotId"],
                                      "headTableIssues": spec["issues"]}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"month": spec["reportMonth"], "rows": len(spec["replacements"][0]["rows"]),
                      "issues": len(spec["issues"]), "output": str(args.output), "issuesFile": str(issues_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
