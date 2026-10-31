"""Bind audited market fields to slide 4 without using historical snapshot reviews."""

import calendar
import json
import zipfile
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from xml.etree import ElementTree

from pptx_preserve_patch import table_values
from steam_release_to_spec import NS, shape_texts
from steam_head_to_spec import previous_month


def previous(month):
    return previous_month(month)


def shape_runs(xml, shape_id):
    root = ElementTree.fromstring(xml)
    shapes = [shape for shape in root.findall(".//p:sp", NS)
              if shape.find("p:nvSpPr/p:cNvPr", NS) is not None
              and shape.find("p:nvSpPr/p:cNvPr", NS).get("id") == str(shape_id)]
    if len(shapes) != 1:
        raise ValueError("Market KPI shape missing")
    return [node.text or "" for node in shapes[0].findall(".//a:t", NS)]


def make_spec(template: Path, data: dict, audit: dict):
    month = data.get("report_month")
    if data.get("schema_version") != "2.0" or data.get("previous_month") != previous(month):
        raise ValueError("Market data month contract mismatch")
    if audit.get("month") != month or audit.get("snapshot_id") != data.get("snapshot_id") or audit.get("contract_errors"):
        raise ValueError("Market data audit mismatch")
    expected_months = [previous(previous(month)), previous(month), month]
    months = (data.get("market") or {}).get("months") or []
    if [item.get("month") for item in months] != expected_months:
        raise ValueError("Market series is not the target three-month window")
    for item in months:
        for key in ("total", "release_unlock", "post_unlock", "watching", "unknown", "daily_avg"):
            if not isinstance(item.get(key), (int, float)):
                raise ValueError(f"Market {key} missing")
        if item["release_unlock"] + item["post_unlock"] + item["watching"] + item["unknown"] != item["total"]:
            raise ValueError("Market components do not add to upstream total")
    kpis = data.get("kpis") or {}
    if kpis.get("total", {}).get("value") != months[-1]["total"] or kpis.get("mom_growth", {}).get("compare_to_total") != months[-2]["total"]:
        raise ValueError("Market KPI and chart source disagree")
    growth = kpis.get("mom_growth", {}).get("value")
    if not isinstance(growth, (int, float)):
        raise ValueError("Market monthly growth unavailable")
    delta = months[-1]["total"] - months[-2]["total"]
    year, number = map(int, month.split("-"))
    issues = [
        {"field": "market.review_trend", "reason": "historical_window_unavailable"},
        {"field": "market.review_distribution", "reason": "historical_window_unavailable"},
        {"field": "market.ai_disclosure", "reason": "data_source_unavailable"},
        {"field": "market.commentary", "reason": "manual_analysis_required"},
    ]
    replacements = []
    with zipfile.ZipFile(template) as archive:
        xml = archive.read("ppt/slides/slide4.xml")
        texts = shape_texts(xml)

        def runs(shape_id, values):
            expected = shape_runs(xml, shape_id)
            if len(expected) != len(values):
                raise ValueError(f"Reviewed market shape {shape_id} run count changed")
            replacements.append({"kind": "shapeRuns", "slide": 4, "shapeId": shape_id,
                                 "expectedRuns": expected, "values": [str(v) for v in values]})

        runs(4, [str(year), "年", str(number), "月新品概况"])
        runs(7, [str(number), "月上新总量（环比）", str(months[-1]["total"]), "环比",
                 str(int(expected_months[1][-2:])), "月增加", str(delta), "款"])
        growth_text = (Decimal(str(growth)) * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
        runs(9, ["新品增量", f"{growth_text:+}%", "", "", "", "", "", ""])
        runs(12, [str(number), "月测评总数", "", "", "", ""])
        runs(15, [str(number), "月总好评率", "", "", ""])
        for shape_id, item in zip((43, 45, 48), months):
            replacements.append({"kind": "shapeReplace", "slide": 4, "shapeId": shape_id,
                                 "expectedText": texts[shape_id], "value": str(item["total"])})
        for shape_id in (14, 59, 70, 72, 73, 77, 79, 81, 83, 85, 44):
            replacements.append({"kind": "shapeReplace", "slide": 4, "shapeId": shape_id,
                                 "expectedText": texts[shape_id], "value": ""})
        for shape_id in (59, 70, 72, 73):
            replacements.append({"kind": "hideShapeFill", "slide": 4, "shapeId": shape_id,
                                 "expectedColor": "E6CD97"})
        table = table_values(xml, 27)
        for column, item in zip((1, 3, 6), reversed(months)):
            replacements.append({"slide": 4, "tableId": 27, "row": 0, "column": column,
                                 "expected": table[0][column], "value": f"{int(item['month'][-2:])}月"})
        for row in (1, 2, 3, 4):
            for column in (1, 3, 6):
                if table[row][column]:
                    replacements.append({"slide": 4, "tableId": 27, "row": row, "column": column,
                                         "expected": table[row][column], "value": ""})
        for column, old in enumerate(table[7]):
            if old:
                replacements.append({"slide": 4, "tableId": 27, "row": 7, "column": column,
                                     "expected": old, "value": ""})
    return {"replacements": replacements, "issues": issues, "months": months}
