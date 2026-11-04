"""Values the mapping can reference. All figures come from the audited upstream package."""

import calendar
import re
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP


def percent(value):
    if value is None:
        return ""
    number = (Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return ("+" if number > 0 else "") + str(number) + "%"


def previous_month(month):
    year, number = map(int, month.split("-"))
    return f"{year - 1}-12" if number == 1 else f"{year}-{number - 1:02d}"


def check_contract(data, audit):
    month = data.get("report_month")
    if not isinstance(month, str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise ValueError("Invalid report month")
    if data.get("schema_version") != "2.0" or data.get("previous_month") != previous_month(month):
        raise ValueError("Data schema or previous month mismatch")
    if audit.get("month") != month or audit.get("snapshot_id") != data.get("snapshot_id") or audit.get("contract_errors"):
        raise ValueError("Data and window audit do not match")
    return month


def month_context(month):
    year, number = map(int, month.split("-"))
    previous = previous_month(month)
    publication_year, publication_month = (year + 1, 1) if number == 12 else (year, number + 1)
    return {"year": str(year), "monthNumber": str(number), "yearMonthDot": month.replace("-", "."),
            "publicationMonthDot": f"{publication_year}.{publication_month:02d}",
            "monthEnd": f"{year}.{number:02d}.{calendar.monthrange(year, number)[1]}",
            "previousMonthNumber": str(int(previous[-2:])),
            "twoMonthsAgoNumber": str(int(previous_month(previous)[-2:]))}


def head_rows(data):
    head = data.get("head") or {}
    if head.get("status") != "ready" or head.get("revenue_status") != "ready" or head.get("missing_weeks") or head.get("missing_previous_weeks"):
        raise ValueError("Head leaderboard is incomplete")
    if len(head.get("weeks") or []) != 4 or len(head.get("previous_weeks") or []) != 4:
        raise ValueError("Head leaderboard does not cover four weeks per month")
    games = sorted(head.get("top20") or [], key=lambda item: item.get("rank", 999))
    if not games or [game.get("rank") for game in games] != list(range(1, len(games) + 1)):
        raise ValueError("Head leaderboard ranks are not continuous")
    rows, issues = [], []
    for game in games:
        if not isinstance(game.get("name"), str) or not game["name"].strip():
            raise ValueError("Head game name missing")
        growth = percent(game.get("revenue_growth")) if game.get("revenue_growth_status") == "ok" and game.get("revenue_growth_unit") == "ratio_0_1" else ""
        delta = game.get("rank_delta") if game.get("rank_delta_status") == "ok" else None
        if delta is not None and (not isinstance(delta, int) or isinstance(delta, bool)):
            raise ValueError("Rank delta must be the upstream integer")
        rank_display = ("+" + str(delta) if delta > 0 else str(delta)) if delta else ("-" if delta == 0 else "")
        if not growth or delta is None:
            issues.append({"rank": game["rank"], "appid": game.get("appid"),
                           "missing": [key for key, ok in (("revenue_growth", bool(growth)), ("rank_delta", delta is not None)) if not ok]})
        rows.append([str(game["rank"]), game["name"], growth, rank_display])
    return rows, issues


def tier_metric(game, key, month, issues):
    item = ((game.get("day14") or {}).get("metrics") or {}).get(key) or {}
    window = item.get("window") or {}
    if item.get("status") != "ok" or item.get("value") is None or window.get("missing_dates"):
        issues.append({"appid": game.get("appid"), "field": key, "reason": item.get("reason") or "missing_or_incomplete"})
        return None
    release = date.fromisoformat(game["release_date"])
    if release.strftime("%Y-%m") != month or date.fromisoformat(window.get("start", "")) != release or date.fromisoformat(window.get("end", "")) != release + timedelta(days=13):
        raise ValueError(f"{key} is not the game's D0-D13 window")
    return Decimal(str(item["value"]))


def tier_row(game, month, issues):
    rank = game.get("revenue_rank_in_tier")
    name = game.get("game_name")
    if (rank is not None and not isinstance(rank, int)) or not isinstance(name, str) or not name.strip():
        raise ValueError("New-release rank or game name invalid")
    if rank is None:
        issues.append({"appid": game.get("appid"), "field": "revenue_rank_in_tier", "reason": "upstream_rank_missing"})
    revenue = tier_metric(game, "revenue_14d_usd", month, issues)
    change = tier_metric(game, "player_change_14d", month, issues)
    revenue_text = (str((revenue / 10000).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)) + "万") if revenue is not None else ""
    change_text = (str(change.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)) + "%") if change is not None else ""
    tags = game.get("tags") or []
    return [str(rank) if rank is not None else "", name, " / ".join(tags[:2]), revenue_text, change_text]


def tier_rows(data, tier):
    month = data["report_month"]
    games = sorted((data.get("new_releases") or {}).get(tier) or [], key=lambda game: game.get("revenue_rank_in_tier") or 999)
    ranks = [game.get("revenue_rank_in_tier") for game in games if game.get("revenue_rank_in_tier") is not None]
    if ranks != list(range(1, len(ranks) + 1)):
        raise ValueError(f"{tier} ranking is duplicated or discontinuous")
    issues = []
    return [tier_row(game, month, issues) for game in games], issues


def head_highlight_ranks(data, extras):
    """Ranks of the head games the upstream package selected for the highlight panel."""
    selected = (extras.get("selection") or {}).get("head")
    if selected is not None:
        chosen = {str(appid) for appid in selected}
        return {str(item.get("rank")) for item in (data.get("head") or {}).get("top20") or []
                if str(item.get("appid")) in chosen and item.get("rank") is not None}
    return {str(item.get("rank")) for item in (data.get("head") or {}).get("highlights") or [] if item.get("rank") is not None}


HIGHLIGHT_SOURCES = {"head.highlights": head_highlight_ranks}

TABLE_SOURCES = {"head.top20": lambda data, extras: head_rows(data),
                 "new_releases.gold": lambda data, extras: tier_rows(data, "gold"),
                 "new_releases.silver": lambda data, extras: tier_rows(data, "silver"),
                 "new_releases.bronze": lambda data, extras: tier_rows(data, "bronze")}

MARKET_ISSUES = [
    {"field": "market.review_trend", "reason": "historical_window_unavailable"},
    {"field": "market.review_distribution", "reason": "historical_window_unavailable"},
    {"field": "market.ai_disclosure", "reason": "data_source_unavailable"},
    {"field": "market.commentary", "reason": "manual_analysis_required"},
]


def market_values(data):
    """Validate the three-month window and expose text and chart values."""
    month = data["report_month"]
    expected = [previous_month(previous_month(month)), previous_month(month), month]
    months = (data.get("market") or {}).get("months") or []
    if [item.get("month") for item in months] != expected:
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
    growth_text = (Decimal(str(growth)) * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    text = {"marketTotal": str(months[-1]["total"]), "marketDelta": str(months[-1]["total"] - months[-2]["total"]),
            "marketGrowth": f"{growth_text:+}%"}
    for index, item in enumerate(months):
        text[f"marketMonth{index}Total"] = str(item["total"])
        text[f"marketMonth{index}Label"] = f"{int(item['month'][-2:])}月"
    series = {"market.categories": [f"{int(item['month'][-2:])}月" for item in months],
              "market.other": [item["post_unlock"] + item["watching"] + item["unknown"] for item in months],
              "market.immediate": [item["release_unlock"] for item in months],
              "market.total": [item["total"] for item in months],
              "market.daily": [int(item["daily_avg"] + 0.5) for item in months]}
    return text, series


def steam_contract(data, extras):
    month = check_contract(data, extras.get("audit") or {})
    return {"month": month, "previous": data["previous_month"], "snapshotId": data["snapshot_id"]}


STEAM = {"contract": steam_contract, "tables": TABLE_SOURCES, "highlights": HIGHLIGHT_SOURCES,
         "values": None, "market": market_values, "marketIssues": MARKET_ISSUES, "images": {}, "charts": {},
         "warning": "历史评测、AI披露和研究文案仍待补；生成结果尚未完成数据与视觉验收。"}
