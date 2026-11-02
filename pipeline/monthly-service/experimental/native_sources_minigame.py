"""Minigame monthly export (minigame-db /api/report/monthly/export) as mapping values.

The export is used as delivered; this module only checks its window and formats
values. Anything the export does not carry is left blank and listed as an issue.
"""

import calendar
import re
from decimal import Decimal, ROUND_HALF_UP

from chart_images import ads_trend
from native_charts import ads_trend_chart, category_chart
from native_sources import previous_month


def month_bounds(month):
    year, number = map(int, month.split("-"))
    return f"{month}-01", f"{month}-{calendar.monthrange(year, number)[1]:02d}"


def check_window(data, month, label):
    if not isinstance(month, str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise ValueError(f"{label} month invalid")
    if data.get("month") != month:
        raise ValueError(f"{label} export is not for {month}")
    window = data.get("range") or {}
    start, end = month_bounds(month)
    previous_start, previous_end = month_bounds(previous_month(month))
    if (window.get("start"), window.get("end"), window.get("previous_start"), window.get("previous_end")) != \
            (start, end, previous_start, previous_end):
        raise ValueError(f"{label} export window does not match {month}")
    if (data.get("coverage") or {}).get("calendar_complete") is not True:
        raise ValueError(f"{label} month is not complete")
    snapshot = data.get("snapshot") or {}
    if snapshot.get("id") is None:
        raise ValueError(f"{label} export has no snapshot")
    return f"{snapshot['id']}@{snapshot.get('revision', 0)}"


def contract(data, extras):
    month = data.get("month")
    snapshot = check_window(data, month, "Minigame")
    previous = extras.get("previous")
    if previous is not None:
        check_window(previous, previous_month(month), "Previous minigame")
    return {"month": month, "previous": previous_month(month), "snapshotId": snapshot}


def whole_percent(value):
    if value is None:
        return None
    number = Decimal(str(value))
    if abs(number) >= 10000:
        # The template writes very large changes in 万%, e.g. +1.4万%.
        number = (number / 10000).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
        return ("+" if number > 0 else "") + str(number) + "万%"
    number = number.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    if number == 0:
        return "0%"  # Avoid "-0%" after rounding a small decline.
    return ("+" if number > 0 else "") + str(number) + "%"


def grouped(value):
    return None if value is None else f"{int(Decimal(str(value)).quantize(Decimal('1'), rounding=ROUND_HALF_UP)):,}"


def short_date(value):
    match = re.fullmatch(r"\d{4}-(\d{2})-(\d{2})", value or "")
    return f"{int(match.group(1))}.{match.group(2)}" if match else None


def short_number(value):
    if value is None:
        return None
    text = str(Decimal(str(value)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
    return text[:-2] if text.endswith(".0") else text


def coverage_issues(data):
    return [{"field": f"coverage.{item.get('key')}", "reason": "covered_days_below_month",
             "covered": item.get("covered_days"), "expected": item.get("expected_days")}
            for item in (data.get("coverage") or {}).get("datasets") or []
            if item.get("covered_days") != item.get("expected_days")]


def board_rows(board):
    def build(data, extras):
        games = data.get(board) or []
        previous = extras.get("previous")
        positions = {game.get("game_id"): index for index, game in enumerate((previous or {}).get(board) or [], 1)}
        rows, issues = [], []
        if previous is None:
            issues.append({"field": f"{board}.rank_change", "reason": "previous_month_export_missing"})
        for index, game in enumerate(games, 1):
            name = game.get("game_name")
            if not isinstance(name, str) or not name.strip():
                raise ValueError(f"{board} game name missing")
            missing = [key for key in ("publisher", "genre", "avg_plan") if game.get(key) in (None, "")]
            if previous is None:
                change = ""
            elif game.get("game_id") not in positions:
                change = "新"
            else:
                moved = positions[game["game_id"]] - index
                change = "-" if moved == 0 else f"{moved:+d}"
            plan_change = whole_percent(game.get("plan_delta_pct"))
            if plan_change is None:
                # No comparable previous plan count: the template shows "/" for that.
                plan_change = "/" if not game.get("previous_avg_plan") else ""
                if plan_change == "":
                    missing.append("plan_delta_pct")
            if missing:
                issues.append({"field": board, "rank": index, "game": name, "missing": missing})
            rows.append([str(index), name, game.get("publisher") or "", game.get("genre") or "", change,
                         grouped(game.get("avg_plan")) or "", plan_change])
        return rows, issues
    return build


def featured_rows(board, count=3):
    def build(data, extras):
        games = [game for game in (data.get("new_games") or {}).get(board) or [] if game.get("featured_rank") is not None]
        games.sort(key=lambda game: game["featured_rank"])
        rows, issues = [], []
        for game in games[:count]:
            values = [game.get("game_name"), short_date(game.get("first_buying_date")),
                      short_date(game.get("first_entry_date")), short_number(game.get("avg_rank")),
                      grouped(game.get("avg_plan"))]
            names = ["game_name", "first_buying_date", "first_entry_date", "avg_rank", "avg_plan"]
            missing = [name for name, value in zip(names, values) if value is None]
            if game.get("first_buying_date_status") not in (None, "ok", "verified"):
                missing.append("first_buying_date_unverified")
            if missing:
                issues.append({"field": f"new_games.{board}", "game": game.get("game_name"), "missing": missing})
            rows.append([value or "" for value in values[:4]] + [(values[4] or "").replace(",", "")])
        if len(rows) < count:
            issues.append({"field": f"new_games.{board}", "reason": "fewer_featured_games", "count": len(rows)})
        return rows, issues
    return build


KPI_FIELDS = {"douyinMaterialGrowth": "douyin_material_growth_pct",
              "douyinInfoFlowGrowth": "douyin_info_flow_growth_pct",
              "douyinTalentGrowth": "douyin_talent_growth_pct",
              "douyinGamesGrowth": "douyin_games_growth_pct",
              "wechatMaterialGrowth": "wechat_material_growth_pct",
              "wechatGamesGrowth": "wechat_games_growth_pct"}


def values(data, extras):
    kpi = data.get("adx_kpi") or {}
    if kpi.get("month") != data.get("month"):
        raise ValueError("ADX KPI month mismatch")
    text, issues = {}, coverage_issues(data)
    for name, field in KPI_FIELDS.items():
        value = whole_percent(kpi.get(field))
        text[name] = value or ""
        if value is None:
            issues.append({"field": f"adx_kpi.{field}", "reason": "missing"})
    return text, issues


def ads_trend_months(data):
    """Three months ending at the report month; months the export marks incomplete stay empty."""
    month = data["month"]
    window = [previous_month(previous_month(month)), previous_month(month), month]
    rows = {item.get("month"): item for item in (data.get("charts") or {}).get("ads_trend") or []}
    months, issues = [], []
    for key in window:
        item = rows.get(key)
        entry = {"label": f"{int(key[-2:])}月", "douyin": None, "wechat": None, "douyinGames": None, "wechatGames": None}
        if not item or item.get("complete") is not True:
            issues.append({"field": f"charts.ads_trend.{key}", "reason": "month_missing_or_incomplete"})
            months.append(entry)
            continue
        for name in ("douyin", "wechat"):
            info, talent = item.get(f"{name}_info_flow_wan"), item.get(f"{name}_talent_wan")
            # The export says stacked-bar labels use split_sum_wan (raw info + talent counts).
            total = item.get(f"{name}_split_sum_wan")
            if None in (info, talent, total):
                issues.append({"field": f"charts.ads_trend.{key}.{name}", "reason": "missing"})
            else:
                entry[name] = (info, talent, total)
            entry[name + "Games"] = item.get(f"{name}_games")
            if entry[name + "Games"] is None:
                issues.append({"field": f"charts.ads_trend.{key}.{name}_games", "reason": "missing"})
        months.append(entry)
    return months, issues


def ads_trend_image(data, extras, width, height):
    months, issues = ads_trend_months(data)
    svg, png = ads_trend(months, width, height)
    return svg, png, issues


def ads_trend_native(data, extras):
    months, issues = ads_trend_months(data)
    chart, book = ads_trend_chart(months)
    return chart, book, issues


def category_top_native(data, extras, limit=10):
    """IAA Top50 genre counts: the largest `limit` genres, change against last month in brackets."""
    month = data["month"]
    top = (data.get("iaa") or {}).get("top50") or {}
    issues, rows = [], []
    if (top.get("currentDate"), top.get("previousDate")) != (month_bounds(month)[1], month_bounds(previous_month(month))[1]):
        issues.append({"field": "iaa.top50", "reason": "window_mismatch",
                       "currentDate": top.get("currentDate"), "previousDate": top.get("previousDate")})
    else:
        ranked = [row for row in top.get("rows") or [] if (row.get("current_count") or 0) > 0 and row.get("genre")]
        ranked.sort(key=lambda row: -row["current_count"])  # stable: keeps the export's order for ties
        for row in ranked[:limit]:
            delta = row.get("delta")
            change = "-" if delta == 0 else f"{delta:+d}" if isinstance(delta, int) else "?"
            if not isinstance(delta, int):
                issues.append({"field": "iaa.top50", "genre": row["genre"], "reason": "delta_missing"})
            rows.append((row["genre"], row["current_count"], f"{row['current_count']} ({change})"))
        if not rows:
            issues.append({"field": "iaa.top50", "reason": "no_rows"})
    previous = int(previous_month(month)[-2:])
    chart, book = category_chart(rows, f"{int(month[-2:])}月TOP50品类数量", f"注：括号中为较{previous}月榜单变化，数据来源于ADXray")
    return chart, book, issues


MINIGAME = {"contract": contract,
            "tables": {"minigame.bestseller": board_rows("bestseller"),
                       "minigame.most_played": board_rows("most_played"),
                       "minigame.featured.bestseller": featured_rows("bestseller"),
                       "minigame.featured.most_played": featured_rows("most_played")},
            "highlights": {}, "values": values, "market": None, "marketIssues": [],
            "images": {"minigame.adsTrend": ads_trend_image},
            "charts": {"minigame.adsTrend": ads_trend_native, "minigame.categoryTop": category_top_native},
            "warning": "MAU、榜单观察、品类分析、新游介绍和图片需人工或AI补齐；买量趋势图和品类分布图已按数据生成为 PowerPoint 原生图表。"}
