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
        if not package["data"] or not snapshot or not snapshot.get("frozen_at"):
            raise ValueError(f"{market} frozen snapshot missing")
        ids.append(f"{market}:{snapshot['id']}@{snapshot['version']}")
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
        issues = [{"field": f"{market}.company/playstyle/rank_change", "reason": "not_in_open_api"}]
        rows = []
        for game in games:
            if not game.get("game_name"):
                raise ValueError(f"{market} rank {game.get('rank')} has no name")
            rows.append([str(game["rank"]), game["game_name"], "", "", "", percent(game.get("revenue_growth_pct"))])
        return rows, issues
    return build


def values(data, extras):
    year, month = map(int, data["month"].split("-"))
    publication = f"{year + 1}.01" if month == 12 else f"{year}.{month + 1:02d}"
    return {"publicationDate": publication}, [{"field": "H1/cases/narrative", "reason": "not_in_monthly_open_api"}]


MOBILE = {"contract": contract,
          "tables": {"mobile.cn": board("cn"), "mobile.global": board("global")},
          "highlights": {}, "values": values, "numbers": None, "market": None,
          "marketIssues": [], "images": {}, "charts": {},
          "warning": "公司、玩法、排名变化、H1汇总及案例文案不在移动游戏月度接口中，已留为空槽；请人工补齐。"}
