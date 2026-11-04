"""Compile a template's native mapping into patch operations for one target month.

A template change must not stop the workflow. Objects or text the mapping can no
longer find are skipped and listed in mappingIssues; only a broken data contract
stops generation.
"""

import base64
import copy
import json
import re
import zipfile
from decimal import Decimal
from xml.etree import ElementTree

from native_sources import STEAM, month_context
from native_sources_minigame import MINIGAME
from native_sources_mobile import MOBILE, MOBILE_CN
from pptx_market_charts import resolve_chart
from pptx_preserve_patch import table_values


FORMAT = "native-pptx-mapping-v1"
NS = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main",
      "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
OPS = {"fillTable", "fillSelectedTable", "selectedGameCards", "selectedObservations", "replaceFragment", "replaceText", "clearText", "setRuns", "setCell", "clearTable", "featuredGames",
       "imageSlot", "chartSlot", "hideFill", "pageNumbers", "chart",
       "fillGrid", "fillShapes", "replaceAll", "clearRegion", "imageChart", "nativeChart", "removeObjects", "barLength", "trendChart", "dataChart", "growthArrow"}
SOURCES = {"steam-monthly": STEAM, "minigame-monthly": MINIGAME, "mobile-monthly": MOBILE,
           "mobile-cn-monthly": MOBILE_CN}
PX = 9525  # EMU per 1/96 inch; slide coordinates in mappings use this unit.


def shape_texts(xml):
    root = ElementTree.fromstring(xml)
    return {int(marker.get("id")): "".join(t.text or "" for t in shape.findall(".//a:t", NS))
            for shape in root.findall(".//p:sp", NS)
            if (marker := shape.find("p:nvSpPr/p:cNvPr", NS)) is not None}


def shape_runs(xml, shape_id):
    root = ElementTree.fromstring(xml)
    shapes = [shape for shape in root.findall(".//p:sp", NS)
              if shape.find("p:nvSpPr/p:cNvPr", NS) is not None
              and shape.find("p:nvSpPr/p:cNvPr", NS).get("id") == str(shape_id)]
    return [node.text or "" for node in shapes[0].findall(".//a:t", NS)] if len(shapes) == 1 else None


def shape_boxes(xml):
    """Geometry, text and first run style of top-level shapes and pictures, in z-order."""
    root = ElementTree.fromstring(xml)
    tree = root.find("p:cSld/p:spTree", NS)
    boxes = []
    for order, item in enumerate(tree):
        tag = item.tag.rsplit("}", 1)[-1]
        if tag not in ("sp", "pic"):
            continue
        marker = item.find(f"p:nv{'Sp' if tag == 'sp' else 'Pic'}Pr/p:cNvPr", NS)
        offset, extent = item.find("p:spPr/a:xfrm/a:off", NS), item.find("p:spPr/a:xfrm/a:ext", NS)
        if marker is None or offset is None or extent is None:
            continue
        style, paragraph = item.find(".//a:r/a:rPr", NS), item.find(".//a:p/a:pPr", NS)
        layout = ElementTree.tostring(paragraph, encoding="unicode") if paragraph is not None else None
        if paragraph is not None:
            # Paragraph default fonts differ cell by cell in hand-made grids (e.g. a stray
            # 华文楷体); the run carries the real font, so the copied layout drops them.
            paragraph = copy.deepcopy(paragraph)
            for default in paragraph.findall("a:defRPr", NS):
                for font in [*default.findall("a:latin", NS), *default.findall("a:ea", NS), *default.findall("a:cs", NS)]:
                    default.remove(font)
        boxes.append({"id": int(marker.get("id")), "kind": tag, "z": order,
                      "x": int(offset.get("x")), "y": int(offset.get("y")),
                      "cx": int(extent.get("cx")), "cy": int(extent.get("cy")),
                      "text": "".join(t.text or "" for t in item.findall(".//a:t", NS)),
                      "runs": len(item.findall(".//a:r", NS)), "hasText": item.find("p:txBody", NS) is not None,
                      "style": ElementTree.tostring(style, encoding="unicode") if style is not None else None,
                      "paragraph": ElementTree.tostring(paragraph, encoding="unicode") if paragraph is not None else None,
                      "layout": layout})
    return boxes


def presentation_order(archive):
    root = ElementTree.fromstring(archive.read("ppt/presentation.xml"))
    rels = ElementTree.fromstring(archive.read("ppt/_rels/presentation.xml.rels"))
    targets = {rel.get("Id"): rel.get("Target", "") for rel in rels}
    slides = []
    for item in root.findall("p:sldIdLst/p:sldId", NS):
        match = re.fullmatch(r"slides/slide(\d+)\.xml", targets[item.get("{" + NS["r"] + "}id")])
        if not match:
            raise ValueError("Presentation slide target changed")
        slides.append(int(match.group(1)))
    return slides


def object_ids(xml, tag, marker):
    root = ElementTree.fromstring(xml)
    return {int(found.get("id")) for item in root.findall(f".//p:{tag}", NS)
            if (found := item.find(f"p:{marker}/p:cNvPr", NS)) is not None}


def render(template, context):
    def value(match):
        if match.group(1) not in context:
            raise KeyError(match.group(1))
        return context[match.group(1)]
    return re.sub(r"\{([A-Za-z0-9]+)\}", value, template)


def validate_mapping(mapping):
    if not isinstance(mapping, dict) or mapping.get("format") != FORMAT:
        raise ValueError("Unknown native mapping format")
    if not isinstance(mapping.get("ops"), list) or not mapping["ops"]:
        raise ValueError("Native mapping has no operations")
    for op in mapping["ops"]:
        if not isinstance(op, dict) or op.get("op") not in OPS:
            raise ValueError(f"Unknown mapping operation: {op}")
    return mapping


def uses_market(mapping):
    return "market" in json.dumps(mapping["ops"], ensure_ascii=False).lower()


class Compiler:
    def __init__(self, archive, data, source, month, extras=None):
        self.archive, self.data, self.source, self.extras = archive, data, source, extras or {}
        self.replacements, self.slots, self.source_issues, self.mapping_issues, self.charts, self.blank_charts = [], [], [], [], [], []
        self.table_rows, self.context, self.series = {}, month_context(month), {}
        self.removed = []
        self.page_order = presentation_order(archive)

    def problem(self, op, reason):
        self.mapping_issues.append({"op": op.get("op"), "slide": op.get("slide"), "reason": reason,
                                    "object": op.get("shapeId") or op.get("tableId") or op.get("pictureId") or op.get("chartId")})

    def slide(self, number):
        name = f"ppt/slides/slide{number}.xml"
        return self.archive.read(name) if name in self.archive.namelist() else None

    def text(self, op, template):
        try:
            return render(template, self.context)
        except KeyError as error:
            self.problem(op, f"未知变量 {error.args[0]}")
            return None

    def rows(self, op):
        source, tables = op.get("source"), self.source["tables"]
        if source not in tables:
            self.problem(op, f"未知数据源字段 {source}")
            return None
        if source not in self.table_rows:
            rows, issues = tables[source](self.data, self.extras)
            self.table_rows[source] = rows
            self.source_issues.extend(issues)
        return self.table_rows[source]

    def table(self, op):
        xml = self.slide(op["slide"])
        if xml is None:
            self.problem(op, "幻灯片不存在")
            return None
        try:
            return table_values(xml, op["tableId"])
        except ValueError:
            self.problem(op, "表格不存在")
            return None

    def cell(self, op, table, row, column, value):
        if row >= len(table) or column >= len(table[row]):
            self.problem(op, f"单元格 {row},{column} 超出表格")
            return
        self.replacements.append({"slide": op["slide"], "tableId": op["tableId"], "row": row, "column": column,
                                  "expected": table[row][column], "value": value})

    def do_fillTable(self, op):
        rows = self.rows(op)
        table = self.table(op)
        if rows is None or table is None:
            return
        header_row = int(op.get("headerRow", 0))
        if header_row >= len(table):
            self.problem(op, "表头行超出表格")
            return
        portion = rows[op.get("from") or 0:op.get("to")]
        capacity = len(table) - header_row - 1
        if len(portion) > capacity:
            self.problem(op, f"表格只能放 {capacity} 行，{len(portion) - capacity} 行数据未填入")
            portion = portion[:capacity]
        columns = len(table[header_row])
        if any(len(row) != columns for row in portion):
            self.problem(op, f"表格有 {columns} 列，数据有 {len(portion[0])} 列，未填写")
            return
        item = {"kind": "table", "slide": op["slide"], "tableId": op["tableId"], "headerRow": header_row,
                "expectedHeader": table[header_row], "rows": portion}
        if op.get("header"):
            header = list(table[header_row])
            for column, template in op["header"].items():
                value = self.text(op, template)
                if value is not None:
                    header[int(column)] = value
            item["newHeader"] = header
        self.replacements.append(item)
        title = op.get("titleCell")
        if title:
            old = table[title["row"]][title["column"]]
            value = self.text(op, title["value"])
            if value is not None:
                self.cell(op, table, title["row"], title["column"], re.sub(title["find"], value, old, count=1))
        highlight = op.get("highlight")
        if highlight:
            source = highlight.get("source")
            if highlight.get("selectionGroup"):
                group = highlight["selectionGroup"]
                chosen = set(map(str, (self.extras.get("selection") or {}).get(group) or []))
                items = self.data
                for segment in highlight["sourcePath"].split("."):
                    items = items.get(segment) if isinstance(items, dict) else None
                keys = {str(item.get(highlight["nameField"])) for item in items or []
                        if str(item.get(highlight["idField"])) in chosen}
            elif source and source not in self.source["highlights"]:
                self.problem(op, f"未知高亮数据 {source}")
                keys = set()
            else:
                keys = self.source["highlights"][source](self.data, self.extras) if source else set()
            column = int(highlight.get("keyColumn", 0))
            self.replacements.append({"kind": "tableFills", "slide": op["slide"], "tableId": op["tableId"],
                                      "firstRow": header_row + 1, "color": highlight.get("color", "FAF3E3"),
                                      "resetColor": highlight.get("resetColor"),
                                      "textColor": highlight.get("textColor"), "resetTextColor": highlight.get("resetTextColor"),
                                      "flags": [row[column] in keys for row in portion]})
        if op.get("trim"):
            self.replacements.append({"kind": "trimTable", "slide": op["slide"], "tableId": op["tableId"],
                                      "keepRows": max(2, header_row + 1 + len(portion))})

    def shape(self, op):
        xml = self.slide(op["slide"])
        current = shape_texts(xml).get(op["shapeId"]) if xml is not None else None
        if current is None:
            self.problem(op, "文字对象不存在")
        return current

    def do_replaceFragment(self, op):
        current = self.shape(op)
        value = self.text(op, op["value"])
        if current is None or value is None:
            return
        match = re.search(op["find"], current)
        if not match or current.count(match.group()) != 1:
            self.problem(op, f"未找到唯一匹配的文字 {op['find']}")
            return
        self.replacements.append({"kind": "shapeText", "slide": op["slide"], "shapeId": op["shapeId"],
                                  "expectedText": current, "oldFragment": match.group(), "newFragment": value})

    def do_replaceText(self, op):
        current = self.shape(op)
        value = self.text(op, op["value"])
        if current is not None and value is not None:
            self.replacements.append({"kind": "shapeReplace", "slide": op["slide"], "shapeId": op["shapeId"],
                                      "expectedText": current, "value": value})

    def do_clearText(self, op):
        current = self.shape(op)
        if current is None:
            return
        sample = op.get("sample", "")
        if not current:
            # Already blank (e.g. a template saved from a draft): still a slot to fill.
            if op.get("slot", True):
                self.slots.append({"slide": op["slide"], "objectId": op["shapeId"], "type": "text"})
            if sample:
                self.replacements.append({"kind": "shapeReplace", "slide": op["slide"], "shapeId": op["shapeId"],
                                          "expectedText": "", "value": sample})
            return
        self.replacements.append({"kind": "shapeReplace", "slide": op["slide"], "shapeId": op["shapeId"],
                                  "expectedText": current, "value": sample})
        if op.get("slot", True):
            self.slots.append({"slide": op["slide"], "objectId": op["shapeId"], "type": "text"})

    def selected_games(self, op):
        items = self.data
        for segment in op["sourcePath"].split("."):
            items = items.get(segment) if isinstance(items, dict) else None
        if not isinstance(items, list):
            self.problem(op, f"入选游戏候选不存在：{op['sourcePath']}")
            return []
        by_id = {str(item.get(op["idField"])): item for item in items}
        ids = (self.extras.get("selection") or {}).get(op["group"]) or []
        return [by_id[str(game_id)] for game_id in ids if str(game_id) in by_id]

    def selected_text(self, op, shape_id, value, slot_type="text"):
        current = self.shape({**op, "shapeId": shape_id})
        if current is not None:
            self.replacements.append({"kind": "shapeReplace", "slide": op["slide"], "shapeId": shape_id,
                                      "expectedText": current, "value": str(value)})
            self.slots.append({"slide": op["slide"], "objectId": shape_id, "type": slot_type})

    def do_fillSelectedTable(self, op):
        """Fill a compact editable table with selected rows from a larger frozen board."""
        games = self.selected_games(op)
        rows = self.rows(op)
        table = self.table(op)
        if rows is None or table is None:
            return
        capacity = len(table) - 1
        if len(games) > capacity:
            self.problem(op, f"表格只能容纳 {capacity} 款入选游戏")
        selected = []
        for game in games[:capacity]:
            rank = int(game.get(op["rankField"], 0))
            if rank < 1 or rank > len(rows):
                self.problem(op, f"入选游戏排名 {rank} 超出榜单")
                continue
            selected.append(rows[rank - 1])
        selected.extend([[""] * len(table[0]) for _ in range(capacity - len(selected))])
        self.replacements.append({"kind": "table", "slide": op["slide"], "tableId": op["tableId"],
                                  "headerRow": 0, "expectedHeader": table[0], "rows": selected})
        self.replacements.append({"kind": "tableFills", "slide": op["slide"], "tableId": op["tableId"],
                                  "firstRow": 1, "color": op.get("highlightColor", "FFF1D6"), "resetColor": "FFFFFF",
                                  "textColor": "C9912F", "resetTextColor": "202020",
                                  "flags": [index < len(games) for index in range(capacity)]})

    def do_selectedGameCards(self, op):
        """Keep original editable card objects while replacing old-month content."""
        games = self.selected_games(op)
        cards = op["cards"]
        for index, card in enumerate(cards):
            object_ids = card.get("objectIds") or []
            if index >= len(games):
                for object_id in object_ids:
                    self.removed.append((op["slide"], object_id))
                    self.replacements.append({"kind": "removeObject", "slide": op["slide"], "objectId": object_id})
                continue
            game = games[index]
            self.selected_text(op, card["nameId"], game.get(op["nameField"]) or "游戏名称", "selected-game-name")
            if card.get("rankId"):
                self.selected_text(op, card["rankId"], game.get(op["rankField"]) or "—", "selected-game-rank")
            for item in card.get("prompts") or []:
                self.selected_text(op, item["shapeId"], item["sample"])
            for picture_id in card.get("pictureIds") or []:
                self.do_imageSlot({"op": "imageSlot", "slide": op["slide"], "pictureId": picture_id})
            if len(games) == 1 and len(cards) > 1:
                dy = int(float(op.get("singleShiftInches", 0)) * 914400)
                for object_id in object_ids:
                    self.replacements.append({"kind": "moveObject", "slide": op["slide"], "objectId": object_id,
                                              "dx": 0, "dy": dy})

    def do_selectedObservations(self, op):
        games = self.selected_games(op)
        slots = op["slots"]
        for index, card in enumerate(slots):
            ids = [card["badgeId"], card["titleId"], card["bodyId"]]
            if index >= len(games):
                for object_id in ids:
                    self.removed.append((op["slide"], object_id))
                    self.replacements.append({"kind": "removeObject", "slide": op["slide"], "objectId": object_id})
                continue
            game = games[index]
            name = game.get(op["nameField"]) or "游戏"
            self.selected_text(op, card["titleId"], f"《{name}》：请填写榜单观察", "selected-game-title")
            self.selected_text(op, card["bodyId"], "示例：结合本月排名、变化及活动信息，填写观察与依据。")
            self.selected_text(op, card["badgeId"], f"{index+1:02d}")
            # Keep the original three-position rhythm while centering shorter lists.
            dy = int((3 - len(games)) * (0.55 if index == 0 else 0.28) * 914400)
            if dy:
                for object_id in ids:
                    self.replacements.append({"kind": "moveObject", "slide": op["slide"], "objectId": object_id,
                                              "dx": 0, "dy": dy})

    def do_featuredGames(self, op):
        """Fill confirmed game names; unused cards are removed from the editable slide."""
        games = (self.data.get("head") or {}).get("top20") or []
        by_id = {str(game.get("appid")): game for game in games}
        selection = (self.extras.get("selection") or {}).get(op["group"])
        if selection is None:
            selection = [game.get("appid") for game in (self.data.get("head") or {}).get("highlights") or []]
        chosen = [by_id[str(appid)] for appid in selection if str(appid) in by_id]
        cards = op["cards"]
        if len(chosen) > len(cards):
            self.problem(op, "入选游戏超过页面卡片容量")
            chosen = chosen[:len(cards)]
        xml = self.slide(op["slide"])
        texts = shape_texts(xml) if xml is not None else {}
        pictures = object_ids(xml, "pic", "nvPicPr") if xml is not None else set()
        for index, card in enumerate(cards):
            shape_id, picture_id = card["shapeId"], card["pictureId"]
            if shape_id not in texts or picture_id not in pictures:
                self.problem({**op, "shapeId": shape_id}, "介绍卡片对象不存在")
                continue
            if index < len(chosen):
                name = chosen[index].get("name") or chosen[index].get("game_name") or ""
                runs = shape_runs(xml, shape_id)
                if runs and len(runs) > 1:
                    values = [name] + [""] * (len(runs) - 2) + ["• 示例：填写本月活动与营收变化原因。"]
                    self.replacements.append({"kind": "shapeRuns", "slide": op["slide"], "shapeId": shape_id,
                                              "expectedRuns": runs, "values": values})
                else:
                    self.replacements.append({"kind": "shapeReplace", "slide": op["slide"], "shapeId": shape_id,
                                              "expectedText": texts[shape_id], "value": name})
                self.replacements.append({"kind": "pictureSlot", "slide": op["slide"], "pictureId": picture_id})
                rows = (len(chosen) + 1) // 2
                dx = int(2.25 * 914400) if len(chosen) % 2 and index == len(chosen) - 1 else 0
                dy = int((3 - rows) * 914400)
                if dx or dy:
                    for object_id in (shape_id, picture_id):
                        self.replacements.append({"kind": "moveObject", "slide": op["slide"], "objectId": object_id,
                                                  "dx": dx, "dy": dy})
                self.slots.append({"slide": op["slide"], "objectId": shape_id, "type": "game-description",
                                   "appid": chosen[index].get("appid"), "name": name})
                self.slots.append({"slide": op["slide"], "objectId": picture_id, "type": "game-icon",
                                   "appid": chosen[index].get("appid"), "name": name})
            else:
                for object_id in (shape_id, picture_id):
                    self.removed.append((op["slide"], object_id))
                    self.replacements.append({"kind": "removeObject", "slide": op["slide"], "objectId": object_id})

    def do_setRuns(self, op):
        xml = self.slide(op["slide"])
        expected = shape_runs(xml, op["shapeId"]) if xml is not None else None
        if expected is None or len(expected) != len(op["values"]):
            self.problem(op, "文字分段数量与映射不符")
            return
        values = [self.text(op, template) for template in op["values"]]
        if None not in values:
            self.replacements.append({"kind": "shapeRuns", "slide": op["slide"], "shapeId": op["shapeId"],
                                      "expectedRuns": expected, "values": values})

    def do_setCell(self, op):
        table = self.table(op)
        value = self.text(op, op["value"])
        if table is not None and value is not None:
            self.cell(op, table, op["row"], op["column"], value)

    def do_clearTable(self, op):
        table = self.table(op)
        if table is None:
            return
        for row_index, row in enumerate(table):
            if "rows" in op and row_index not in op["rows"]:
                continue
            for column_index, value in enumerate(row):
                if value and ("columns" not in op or column_index in op["columns"]):
                    self.cell(op, table, row_index, column_index, "")
        if op.get("slot"):
            self.slots.append({"slide": op["slide"], "objectId": op["tableId"], "type": "table"})

    def do_imageSlot(self, op):
        xml = self.slide(op["slide"])
        if xml is None or op["pictureId"] not in object_ids(xml, "pic", "nvPicPr"):
            self.problem(op, "图片对象不存在")
            return
        self.replacements.append({"kind": "pictureSlot", "slide": op["slide"], "pictureId": op["pictureId"]})
        self.slots.append({"slide": op["slide"], "objectId": op["pictureId"], "type": "image"})

    def do_imageChart(self, op):
        """Replace a picture's content with a chart drawn from data, keeping its frame."""
        boxes = self.boxes(op)
        if boxes is None:
            return
        picture = boxes.get(op["pictureId"])
        if picture is None or picture["kind"] != "pic":
            self.problem(op, "图片对象不存在")
            return
        draw = self.source.get("images", {}).get(op.get("source"))
        if draw is None:
            self.problem(op, f"未知图表数据 {op.get('source')}")
            return
        svg, png, issues = draw(self.data, self.extras, picture["cx"] / PX, picture["cy"] / PX)
        self.source_issues.extend(issues)
        self.replacements.append({"kind": "pictureImage", "slide": op["slide"], "pictureId": op["pictureId"],
                                  "svg": svg, "png": base64.b64encode(png).decode("ascii")})

    def do_nativeChart(self, op):
        """Replace a picture with a native chart built from data, in the same frame."""
        boxes = self.boxes(op)
        if boxes is None:
            return
        picture = boxes.get(op["pictureId"])
        existing = None
        if picture is None or picture["kind"] != "pic":
            try:
                existing = resolve_chart(self.archive, op["slide"], op["pictureId"])
            except (KeyError, ValueError):
                self.problem(op, "图片或图表对象不存在")
                return
        build = self.source.get("charts", {}).get(op.get("source"))
        if build is None:
            self.problem(op, f"未知图表数据 {op.get('source')}")
            return
        chart, book, issues = build(self.data, self.extras)
        self.source_issues.extend(issues)
        if existing:
            self.replacements.append({"kind": "chartReplace", "slide": op["slide"], "part": existing[0], "workbookPart": existing[1],
                                      "chart": chart, "workbook": base64.b64encode(book).decode("ascii")})
            return
        self.replacements.append({"kind": "chartFrame", "slide": op["slide"], "pictureId": op["pictureId"],
                                  "name": op.get("name") or "数据图表", "chart": chart,
                                  "workbook": base64.b64encode(book).decode("ascii")})

    def do_barLength(self, op):
        """Set a progress bar's width from a number: the track's full width stands for `full` (default 100).

        The absolute value is used (the text beside it shows the sign); a minimum keeps small changes
        visible; a missing number collapses the bar so no old length is left behind.
        """
        boxes = self.boxes(op)
        if boxes is None:
            return
        bar, track = boxes.get(op["shapeId"]), boxes.get(op["trackId"])
        if bar is None or track is None:
            self.problem(op, "进度条或轨道对象不存在")
            return
        numbers = self.source["numbers"](self.data, self.extras) if self.source.get("numbers") else {}
        if op["value"] not in numbers:
            self.problem(op, f"未知数值 {op['value']}")
            return
        value = numbers[op["value"]]
        if value is None:
            width = 0
        else:
            ratio = min(1.0, abs(value) / float(op.get("full", 100)))
            width = round(track["cx"] * max(ratio, float(op.get("minRatio", 0.05))))
        if width != bar["cx"]:
            self.replacements.append({"kind": "shapeWidth", "slide": op["slide"], "shapeId": op["shapeId"],
                                      "expectedWidth": bar["cx"], "width": width})

    def do_removeObjects(self, op):
        """Delete objects the template should not carry into drafts (decoration tied to one month)."""
        boxes = self.boxes(op)
        if boxes is None:
            return
        for object_id in op["ids"]:
            if object_id not in boxes:
                self.problem({**op, "shapeId": object_id}, "要删除的对象不存在")
                continue
            if (op["slide"], object_id) in self.removed:
                continue
            self.removed.append((op["slide"], object_id))
            self.replacements.append({"kind": "removeObject", "slide": op["slide"], "objectId": object_id})

    def do_chartSlot(self, op):
        try:
            chart, workbook = resolve_chart(self.archive, op["slide"], op["chartId"])
        except (KeyError, ValueError):
            self.problem(op, "图表对象不存在")
            return
        self.blank_charts.append({"part": chart, "workbook": workbook})
        self.slots.append({"slide": op["slide"], "objectId": op["chartId"], "type": "chart"})

    def do_trendChart(self, op):
        build = self.source.get("charts", {}).get(op.get("source"))
        if not build:
            self.problem(op, "未知趋势图数据源")
            return
        try:
            chart, workbook = resolve_chart(self.archive, op["slide"], op["chartId"])
        except (KeyError, ValueError):
            self.problem(op, "图表对象不存在")
            return
        series, issues = build(self.data, self.extras)
        self.source_issues.extend(issues)
        if series is None:
            self.blank_charts.append({"part": chart, "workbook": workbook})
            self.slots.append({"slide": op["slide"], "objectId": op["chartId"], "type": "chart"})
            return
        self.charts.append({"part": chart, "workbook": workbook, "categories": series["categories"],
                            "series": [series["values"]], "columns": {}, "trend": True,
                            "categoriesVisible": bool(op.get("categoriesVisible"))})

    def do_dataChart(self, op):
        build = self.source.get("charts", {}).get(op.get("source"))
        if not build:
            self.problem(op, "未知图表数据源")
            return
        try:
            chart, workbook = resolve_chart(self.archive, op["slide"], op["chartId"])
        except (KeyError, ValueError):
            self.problem(op, "图表对象不存在")
            return
        series, issues = build(self.data, self.extras)
        self.source_issues.extend(issues)
        if series is None:
            self.blank_charts.append({"part": chart, "workbook": workbook})
            self.slots.append({"slide": op["slide"], "objectId": op["chartId"], "type": "chart"})
            return
        self.charts.append({"part": chart, "workbook": workbook, "categories": series["categories"],
                            "series": series["series"], "cacheOnly": True,
                            "numberFormat": op.get("numberFormat"),
                            "titleReplace": [op["titleFind"], self.text(op, op["titleValue"])]
                                if op.get("titleFind") and op.get("titleValue") else None})

    def do_growthArrow(self, op):
        summaries = (self.data.get("cn") or {}).get("meta", {}).get("category_summaries") or {}
        growth = (summaries.get(op.get("category")) or {}).get("revenue_growth_pct")
        if growth is not None and (Decimal(str(growth)) > 0) == bool(op.get("up")):
            return
        arrow_id = op["arrowId"]
        if arrow_id not in object_ids(self.slide(op["slide"]), "sp", "nvSpPr"):
            self.problem(op, "趋势箭头对象不存在")
            return
        self.removed.append((op["slide"], arrow_id))
        self.replacements.append({"kind": "removeObject", "slide": op["slide"], "objectId": arrow_id})

    def do_hideFill(self, op):
        if self.shape(op) is not None:
            self.replacements.append({"kind": "hideShapeFill", "slide": op["slide"], "shapeId": op["shapeId"],
                                      "expectedColor": op["color"]})

    def do_pageNumbers(self, op):
        for position, slide in enumerate(self.page_order, 1):
            numbers = [(shape_id, value) for shape_id, value in shape_texts(self.slide(slide)).items()
                       if re.fullmatch(op["find"].strip("^$"), value)]
            if len(numbers) > 1:
                self.problem({**op, "slide": slide}, "页码对象不唯一")
            elif numbers:
                shape_id, old = numbers[0]
                self.replacements.append({"kind": "shapeText", "slide": slide, "shapeId": shape_id,
                                          "expectedText": old, "oldFragment": old,
                                          "newFragment": f"{position:02d} / {len(self.page_order):02d}"})

    def do_chart(self, op):
        try:
            chart, workbook = resolve_chart(self.archive, op["slide"], op["chartId"])
        except (KeyError, ValueError):
            self.problem(op, "图表对象不存在")
            return
        names = [*op["series"], *op.get("workbook", {}).values()]
        unknown = [name for name in names if name not in self.series]
        if unknown:
            self.problem(op, f"未知图表数据 {unknown[0]}")
            return
        self.charts.append({"part": chart, "workbook": workbook, "categories": self.series["market.categories"],
                            "series": [self.series[name] for name in op["series"]],
                            "columns": {column: self.series[name] for column, name in op.get("workbook", {}).items()},
                            "blankAuxiliary": bool(op.get("blankAuxiliary"))})


    # Text-box layouts: tables drawn as separate text boxes, cards, and free regions.

    def boxes(self, op):
        xml = self.slide(op["slide"])
        if xml is None:
            self.problem(op, "幻灯片不存在")
            return None
        return {box["id"]: box for box in shape_boxes(xml)}

    def fill_cells(self, op, boxes, grid):
        """grid: rows of shape ids (None to skip). Data rows fill in order; spare rows are cleared."""
        rows = self.rows(op)
        if rows is None:
            return
        columns = op.get("columns") or list(range(len(grid[0]) if grid else 0))
        if len(rows) > len(grid):
            self.problem(op, f"版面只能放 {len(grid)} 行，{len(rows) - len(grid)} 行数据未填入")
        reference = grid[0] if grid else []
        for row_index, ids in enumerate(grid):
            values = rows[row_index] if row_index < len(rows) else None
            for position, shape_id in enumerate(ids):
                if shape_id is None or shape_id not in boxes:
                    if shape_id is not None:
                        self.problem({**op, "shapeId": shape_id}, "文字对象不存在")
                    continue
                box, column = boxes[shape_id], columns[position] if position < len(columns) else None
                value = "" if values is None or column is None or column >= len(values) else values[column]
                if not box["hasText"]:
                    if value:
                        self.problem({**op, "shapeId": shape_id}, "对象没有文本框，无法填入")
                    continue
                if value != box["text"]:
                    self.replacements.append({"kind": "shapeReplace", "slide": op["slide"], "shapeId": shape_id,
                                              "expectedText": box["text"], "value": value})
                if not value and (values is None or column is None):
                    self.slots.append({"slide": op["slide"], "objectId": shape_id, "type": "text"})
                style_id = reference[position] if position < len(reference) else None
                model = boxes.get(style_id, {})
                if op.get("uniformStyle") and model.get("style") and \
                        (box["style"], box["layout"]) != (model["style"], model["paragraph"]):
                    self.replacements.append({"kind": "shapeRunStyle", "slide": op["slide"], "shapeId": shape_id,
                                              "style": model["style"], "paragraph": model["paragraph"]})

    def do_fillShapes(self, op):
        boxes = self.boxes(op)
        if boxes is not None:
            self.fill_cells(op, boxes, op["cells"])

    def do_fillGrid(self, op):
        """Find a text-box table from its header boxes: each column is the boxes centred under its header."""
        boxes = self.boxes(op)
        if boxes is None:
            return
        headers = [boxes.get(shape_id) for shape_id in op["header"]]
        if None in headers:
            self.problem(op, "表头文字对象不存在")
            return
        tolerance = int(op.get("tolerance", 3)) * PX
        bottom = op.get("bottom", 10 ** 9 // PX) * PX
        columns = []
        for header in headers:
            centre = header["x"] + header["cx"] // 2
            members = [box for box in boxes.values()
                       if box["kind"] == "sp" and box["id"] not in op["header"] and box["y"] > header["y"]
                       and box["y"] < bottom and abs(box["x"] + box["cx"] // 2 - centre) <= tolerance
                       and box["cx"] <= header["cx"] * 2 and box["cy"] <= header["cy"] * 2]
            columns.append(sorted(members, key=lambda box: box["y"]))
        anchors, grid = columns[0], []
        for anchor in anchors:
            middle = anchor["y"] + anchor["cy"] // 2
            row = []
            for members in columns:
                found = [box for box in members if abs(box["y"] + box["cy"] // 2 - middle) <= 6 * PX]
                row.append(found[0]["id"] if len(found) == 1 else None)
                if len(found) != 1:
                    self.problem(op, f"第 {len(grid) + 1} 行有一列找不到唯一的文字对象")
            grid.append(row)
        if op.get("rows") and len(grid) != op["rows"]:
            self.problem(op, f"找到 {len(grid)} 行，映射预期 {op['rows']} 行")
        self.fill_cells(op, boxes, grid)

    def do_replaceAll(self, op):
        xml = self.slide(op["slide"])
        runs = shape_runs(xml, op["shapeId"]) if xml is not None else None
        value = self.text(op, op["value"])
        if runs is None or value is None:
            if runs is None:
                self.problem(op, "文字对象不存在")
            return
        joined = len(re.findall(op["find"], "".join(runs)))
        if not joined:
            self.problem(op, f"未找到文字 {op['find']}")
            return
        if joined != sum(len(re.findall(op["find"], run)) for run in runs):
            self.problem(op, f"文字 {op['find']} 跨越了不同格式，未替换")
            return
        values = [re.sub(op["find"], value, run) for run in runs]
        self.replacements.append({"kind": "shapeRuns", "slide": op["slide"], "shapeId": op["shapeId"],
                                  "expectedRuns": runs, "values": values})

    def do_clearRegion(self, op):
        """Empty every text box and picture fully inside a box (in px), except those kept."""
        boxes = self.boxes(op)
        if boxes is None:
            return
        left, top, right, bottom = (value * PX for value in op["box"])
        keep = set(op.get("keep") or [])
        found = 0
        for box in sorted(boxes.values(), key=lambda item: item["z"]):
            inside = left <= box["x"] and top <= box["y"] and box["x"] + box["cx"] <= right and box["y"] + box["cy"] <= bottom
            if not inside or box["id"] in keep or (op["slide"], box["id"]) in self.removed:
                continue
            if box["kind"] == "pic" and op.get("images", True):
                found += 1
                self.do_imageSlot({"op": "imageSlot", "slide": op["slide"], "pictureId": box["id"]})
            elif box["kind"] == "sp" and op.get("texts", True) and box["text"].strip():
                found += 1
                self.do_clearText({"op": "clearText", "slide": op["slide"], "shapeId": box["id"]})
        if not found:
            self.problem(op, "区域内没有可清空的对象")


def compile_mapping(mapping, template, data, extras=None):
    validate_mapping(mapping)
    extras = extras or {}
    source_name = mapping.get("dataSource", "steam-monthly")
    if source_name not in SOURCES:
        raise ValueError(f"Unknown data source {source_name}")
    source = SOURCES[source_name]
    contract = source["contract"](data, extras)
    with zipfile.ZipFile(template) as archive:
        if archive.testzip() is not None:
            raise ValueError("Template PPTX ZIP damaged")
        compiler = Compiler(archive, data, source, contract["month"], extras)
        market = source["market"] and uses_market(mapping)
        if market:
            text, compiler.series = source["market"](data)
            compiler.context.update(text)
        if source["values"]:
            text, issues = source["values"](data, extras)
            compiler.context.update(text)
            compiler.source_issues.extend(issues)
        for op in mapping["ops"]:
            getattr(compiler, "do_" + op["op"])(op)
        if market:
            compiler.source_issues.extend(source["marketIssues"])
    seen, slots = set(), []
    for slot in compiler.slots:
        if (slot["slide"], slot["objectId"]) not in seen:
            seen.add((slot["slide"], slot["objectId"]))
            slots.append(slot)
    compiler.slots = slots
    return {"replacements": compiler.replacements, "slots": compiler.slots, "charts": compiler.charts, "blankCharts": compiler.blank_charts,
            "sourceIssues": compiler.source_issues, "mappingIssues": compiler.mapping_issues, "contract": contract,
            "warning": source["warning"], "dataSource": source_name,
            "removed": [{"slide": slide, "objectId": object_id} for slide, object_id in compiler.removed]}


def check_mapping(mapping, template):
    """List mapped objects the PPTX no longer has, without any monthly data."""
    validate_mapping(mapping)
    problems = []
    with zipfile.ZipFile(template) as archive:
        names = set(archive.namelist())
        cloned = {item["newSlide"]: item["sourceSlide"] for item in mapping.get("continuations", [])}
        for item in mapping.get("continuations", []):
            if f"ppt/slides/slide{item['sourceSlide']}.xml" not in names:
                problems.append({"op": "continuation", "slide": item["sourceSlide"], "reason": "续页来源幻灯片不存在"})
            if f"ppt/slides/slide{item['newSlide']}.xml" in names:
                problems.append({"op": "continuation", "slide": item["newSlide"], "reason": "续页编号与现有幻灯片冲突"})
        for op in mapping["ops"]:
            if "slide" not in op:
                continue
            slide = cloned.get(op["slide"], op["slide"])
            name = f"ppt/slides/slide{slide}.xml"
            if name not in names:
                problems.append({"op": op["op"], "slide": op["slide"], "reason": "幻灯片不存在"})
                continue
            xml = archive.read(name)
            texts = shape_texts(xml)
            if op["op"] == "removeObjects":
                present = set(texts) | object_ids(xml, "pic", "nvPicPr") | object_ids(xml, "cxnSp", "nvCxnSpPr")
                problems.extend({"op": op["op"], "slide": op["slide"], "object": object_id, "reason": "要删除的对象不存在"}
                                for object_id in op["ids"] if object_id not in present)
            grid_ids = op["header"] if op["op"] == "fillGrid" else []
            grid_ids += [item for row in op.get("cells", []) for item in row if item is not None] if op["op"] == "fillShapes" else []
            for shape_id in grid_ids:
                if shape_id not in texts:
                    problems.append({"op": op["op"], "slide": op["slide"], "object": shape_id, "reason": "文字对象不存在"})
            if "shapeId" in op and op["shapeId"] not in texts:
                problems.append({"op": op["op"], "slide": op["slide"], "object": op["shapeId"], "reason": "文字对象不存在"})
            frames = object_ids(xml, "graphicFrame", "nvGraphicFramePr") if op["op"] == "nativeChart" else set()
            if "pictureId" in op and op["pictureId"] not in object_ids(xml, "pic", "nvPicPr") | frames:
                problems.append({"op": op["op"], "slide": op["slide"], "object": op["pictureId"], "reason": "图片对象不存在"})
            if op["op"] == "featuredGames":
                pictures = object_ids(xml, "pic", "nvPicPr")
                for card in op.get("cards", []):
                    if card.get("shapeId") not in texts:
                        problems.append({"op": op["op"], "slide": op["slide"], "object": card.get("shapeId"), "reason": "介绍文字对象不存在"})
                    if card.get("pictureId") not in pictures:
                        problems.append({"op": op["op"], "slide": op["slide"], "object": card.get("pictureId"), "reason": "介绍图片对象不存在"})
            if op["op"] in ("selectedGameCards", "selectedObservations"):
                present = (object_ids(xml, "sp", "nvSpPr") | object_ids(xml, "pic", "nvPicPr") |
                           object_ids(xml, "cxnSp", "nvCxnSpPr"))
                for card in op.get("cards", op.get("slots", [])):
                    required = card.get("objectIds", []) if op["op"] == "selectedGameCards" else [card["badgeId"], card["titleId"], card["bodyId"]]
                    for object_id in required:
                        if object_id not in present:
                            problems.append({"op": op["op"], "slide": op["slide"], "object": object_id, "reason": "入选游戏对象不存在"})
            if "chartId" in op and op["chartId"] not in object_ids(xml, "graphicFrame", "nvGraphicFramePr"):
                problems.append({"op": op["op"], "slide": op["slide"], "object": op["chartId"], "reason": "图表对象不存在"})
            if "tableId" in op:
                try:
                    table_values(xml, op["tableId"])
                except ValueError:
                    problems.append({"op": op["op"], "slide": op["slide"], "object": op["tableId"], "reason": "表格不存在"})
    return {"ok": not problems, "operations": len(mapping["ops"]), "problems": problems}
