"""Frozen mobile monthly Open API packages for the native leaderboard PPT."""

import re
from decimal import Decimal, ROUND_HALF_UP


def contract(data, extras):
    month = data.get("month") if isinstance(data, dict) else None
    if not isinstance(month, str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise ValueError("Mobile report month invalid")
    ids = []
    for market in ("cn", "global"):
        package = data.get(market)
        if not isinstance(package, dict) or not isinstance(package.get("data"), list):
            raise ValueError(f"{market} package missing")
        meta = package.get("meta") or {}
        snapshot = meta.get("snapshot") or {}
        if meta.get("month") != month or meta.get("market") != market or meta.get("ranking_metric") != "revenue":
            raise ValueError(f"{market} report window/metric mismatch")
        if snapshot and snapshot.get("id") is not None and snapshot.get("frozen_at"):
            ids.append(f"{market}:{snapshot['id']}@{snapshot['version']}")
        else:
            if package["data"]:
                raise ValueError(f"{market} has rows without frozen snapshot")
            ids.append(f"{market}:missing")
    if all(item.endswith(":missing") for item in ids):
        raise ValueError("Both markets have no frozen snapshot")
    year, number = map(int, month.split("-"))
    previous = f"{year - 1}-12" if number == 1 else f"{year}-{number - 1:02d}"
    return {"month": month, "previous": previous, "snapshotId": "|".join(ids)}


def percent(value):
    if value is None:
        return ""
    number = Decimal(str(value)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    return ("+" if number > 0 else "") + str(number) + "%"


def board(market):
    def build(data, extras):
        package = data[market]
        games = sorted(package["data"], key=lambda row: int(row["rank"]))
        issues = []
        rows = []
        if not package["data"]:
            issues.append({"field": f"{market}.top20", "reason": "frozen_snapshot_missing"})
        for game in games[:20]:
            if not game.get("game_name"):
                raise ValueError(f"{market} rank {game.get('rank')} has no name")
            missing = [name for name in ("publisher", "genre", "rank_change") if game.get(name) is None]
            if missing:
                issues.append({"field": f"{market}.top20", "rank": game["rank"], "game": game["game_name"], "missing": missing})
            change = game.get("rank_change")
            rank_change = "" if change is None else "-" if change == 0 else f"{change:+d}"
            rows.append([str(game["rank"]), game["game_name"], game.get("publisher") or "",
                         game.get("genre") or "", rank_change, percent(game.get("revenue_growth_pct"))])
        rows.extend([["", "", "", "", "", ""] for _ in range(20 - len(rows))])
        return rows, issues
    return build


def values(data, extras):
    year, month = map(int, data["month"].split("-"))
    publication = f"{year + 1}.01" if month == 12 else f"{year}.{month + 1:02d}"
    output = {"publicationDate": publication}
    categories = (data.get("cn") or {}).get("meta", {}).get("category_summaries") or {}
    for index, name in enumerate(("竞技对抗", "射击", "RPG", "休闲", "策略")):
        item = categories.get(name) or {}
        revenue, growth = item.get("revenue"), item.get("revenue_growth_pct")
        output[f"category{index}Revenue"] = (str((Decimal(str(revenue)) / Decimal("100000000")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)) + "亿/美元") if revenue is not None else ""
        output[f"category{index}Growth"] = ("月增长率 " + percent(growth).replace("%", "％")) if growth is not None else ""
    return output, [{"field": "H1/cases/narrative", "reason": "not_in_monthly_open_api"}]


def category_chart(data, extras):
    names = ("竞技对抗", "射击", "RPG", "休闲", "策略")
    package = data.get("cn") or {}
    summaries = (package.get("meta") or {}).get("category_summaries") or {}
    top = (package.get("data") or [])[:100]
    if len(top) < 100 or any(row.get("revenue") is None for row in top):
        return None, [{"field": "cn.category_chart", "reason": "top100_revenue_missing"}]
    if any((summaries.get(name) or {}).get("revenue_growth_pct") is None for name in names):
        return None, [{"field": "cn.category_chart", "reason": "category_growth_missing"}]
    total = sum(Decimal(str(row["revenue"])) for row in top)
    if not total:
        return None, [{"field": "cn.category_chart", "reason": "top100_revenue_zero"}]
    growth = [float(Decimal(str(summaries[name]["revenue_growth_pct"])) / 100) for name in names]
    share = [float(sum(Decimal(str(row["revenue"])) for row in top if row.get("monthly_category") == name) / total) for name in names]
    return {"categories": list(names), "series": [growth, share]}, []


def period_ready(data):
    period = data.get("period") or {}
    meta = period.get("meta") or {}
    comparison = meta.get("comparison") or {}
    return (meta.get("complete") is True and meta.get("coverage_scopes") == ["full"]
            and comparison.get("prev_period", {}).get("comparable_totals") is True
            and comparison.get("last_year_period", {}).get("comparable_totals") is True)


def period_chart(data, extras):
    if not period_ready(data):
        return None, [{"field": "cn.period", "reason": "complete_comparable_h1_missing"}]
    meta = data["period"]["meta"]
    summary = meta["summary"]
    keys = [("revenue_last_year_period", "active_users_avg_monthly_last_year_period"),
            ("revenue_prev_period", "active_users_avg_monthly_prev_period"),
            ("revenue", "active_users_avg_monthly")]
    if any(summary.get(a) is None or summary.get(b) is None for a,b in keys):
        return None, [{"field": "cn.period.summary", "reason": "value_missing"}]
    year = int(meta["period"][:4])
    revenue = [float((Decimal(str(summary[a])) / Decimal("100000000")).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)) for a,b in keys]
    # The source exposes monthly mean MAU. Six times that value is the sum of six
    # monthly counts shown by the original H1 chart, not unique half-year users.
    active = [float((Decimal(str(summary[b])) * 6 / Decimal("100000000")).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)) for a,b in keys]
    return {"categories": [f"{year-1}H1", f"{year-1}H2", f"{year}H1"],
            "series": [revenue, active]}, []


DISPLAY_ALIASES = {
    "Game For Peace": "和平精英", "Delta Force Mobile": "三角洲行动",
    "Whiteout Survival": "无尽冬日", "Dungeon & Fighter Mobile": "地下城与勇士",
    "Eggy Party": "蛋仔派对", "CrossFire": "穿越火线",
    "Love and Deepspace": "恋与深空", "Genshin Impact": "原神",
    "League of Legends: Wild Rift": "英雄联盟", "My Garden Tale": "我的花园世界",
}


def display_game_name(game):
    original = game.get("game_name") or ""
    return DISPLAY_ALIASES.get(original, original)


def period_board(kind):
    def build(data, extras):
        if not period_ready(data):
            capacity = 20 if kind == "top20" else 3 if kind == "rise" else 4
            return ([([""] * (6 if kind == "top20" else 3)) for _ in range(capacity)],
                    [{"field": "cn.period." + kind, "reason": "complete_comparable_h1_missing"}])
        games = (data["period"].get("data") or [])[:20]
        issues = []
        if kind == "top20":
            rows = []
            for game in games:
                missing = [key for key in ("publisher","genre","rank_change","revenue_growth_pct") if game.get(key) is None]
                if missing: issues.append({"field":"cn.period.top20","game":game.get("game_name"),"missing":missing})
                change=game.get("rank_change")
                rows.append([str(game.get("rank") or game.get("revenue_rank") or ""),display_game_name(game),
                             game.get("publisher") or "",game.get("genre") or "",
                             "" if change is None else "-" if change == 0 else f"{change:+d}",percent(game.get("revenue_growth_pct"))])
            rows.extend([[""]*6 for _ in range(20-len(rows))])
            return rows,issues
        valid = [game for game in games if game.get("revenue_growth_pct") is not None]
        valid.sort(key=lambda game:Decimal(str(game["revenue_growth_pct"])),reverse=(kind=="rise"))
        valid = [game for game in valid if (Decimal(str(game["revenue_growth_pct"]))>0 if kind=="rise" else Decimal(str(game["revenue_growth_pct"]))<0)]
        capacity = 3 if kind == "rise" else 4
        rows = [[display_game_name(game),percent(game.get("revenue_growth_pct")),""] for game in valid[:capacity]]
        rows.extend([["","",""] for _ in range(capacity-len(rows))])
        return rows,issues
    return build


def trend_chart(kind):
    def build(data, extras):
        trend = data.get("trend") or {}
        meta, rows = trend.get("meta") or {}, trend.get("data") or []
        if (not meta.get("complete") or meta.get("mixed_coverage") or len(rows) != 26
                or meta.get("to") != data["month"] or any(not row.get("available") or row.get("coverage_scope") != "full" for row in rows)):
            return None, [{"field": "cn.trend", "reason": "26_month_full_coverage_unavailable"}]
        field = {"revenue": "revenue", "users": "active_users_sum",
                 "growth": "revenue_growth_pct"}[kind]
        if any(row.get(field) is None for row in rows):
            return None, [{"field": "cn.trend." + field, "reason": "value_missing"}]
        divisor = Decimal("100000000") if kind != "growth" else Decimal("100")
        values = [Decimal(str(row[field])) / divisor for row in rows]
        if kind == "users":
            values = [value.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP) for value in values]
        return {"categories": [f"{int(row['month'][:4])}.{int(row['month'][5:])}" for row in rows],
                "values": [str(value) for value in values]}, []
    return build


MOBILE = {"contract": contract,
          "tables": {"mobile.cn": board("cn"), "mobile.global": board("global")},
          "highlights": {}, "values": values, "numbers": None, "market": None,
          "marketIssues": [], "images": {}, "charts": {},
          "warning": "公司、玩法、排名变化、H1汇总及案例文案不在移动游戏月度接口中，已留为空槽；请人工补齐。"}


def cn_contract(data, extras):
    month = data.get("month") if isinstance(data, dict) else None
    package = data.get("cn") if isinstance(data, dict) else None
    meta = (package or {}).get("meta") or {}
    snapshot = meta.get("snapshot") or {}
    if not isinstance(month, str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise ValueError("Mobile CN report month invalid")
    if meta.get("month") != month or meta.get("market") != "cn" or meta.get("ranking_metric") != "revenue":
        raise ValueError("Mobile CN report window/metric mismatch")
    if snapshot.get("id") is None or not snapshot.get("frozen_at") or len(package.get("data") or []) < 20:
        raise ValueError("Mobile CN frozen top20 snapshot missing")
    year, number = map(int, month.split("-"))
    previous = f"{year - 1}-12" if number == 1 else f"{year}-{number - 1:02d}"
    return {"month": month, "previous": previous,
            "snapshotId": f"cn:{snapshot['id']}@{snapshot['version']}"}


MOBILE_CN = {**MOBILE, "contract": cn_contract,
             "tables": {"mobile.cn": board("cn"),
                        "mobile.cn.h1.top20": period_board("top20"),
                        "mobile.cn.h1.rise": period_board("rise"),
                        "mobile.cn.h1.decline": period_board("decline")},
             "charts": {"mobile.cn.revenue": trend_chart("revenue"),
                        "mobile.cn.users": trend_chart("users"),
                        "mobile.cn.growth": trend_chart("growth"),
                        "mobile.cn.categories": category_chart,
                        "mobile.cn.h1": period_chart},
             "warning": "仅生成国区页面；公司、玩法、排名变化、H1汇总及案例文案仍需人工或AI补齐。"}
