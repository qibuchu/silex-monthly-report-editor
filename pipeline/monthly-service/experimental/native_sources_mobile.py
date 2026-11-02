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
    return {"publicationDate": publication}, [{"field": "H1/cases/narrative", "reason": "not_in_monthly_open_api"}]


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
             "tables": {"mobile.cn": board("cn")},
             "warning": "仅生成国区页面；公司、玩法、排名变化、H1汇总及案例文案仍需人工或AI补齐。"}
