"""Compile a template's native mapping into patch operations for one target month.

A template change must not stop the workflow. Objects or text the mapping can no
longer find are skipped and listed in mappingIssues; only a broken data contract
stops generation.
"""

import json
import re
import zipfile
from xml.etree import ElementTree

from native_sources import HIGHLIGHT_SOURCES, MARKET_ISSUES, TABLE_SOURCES, check_contract, market_values, month_context
from pptx_market_charts import resolve_chart
from pptx_preserve_patch import table_values


FORMAT = "native-pptx-mapping-v1"
NS = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main",
      "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
OPS = {"fillTable", "replaceFragment", "replaceText", "clearText", "setRuns", "setCell", "clearTable",
       "imageSlot", "chartSlot", "hideFill", "pageNumbers", "chart"}


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
    def __init__(self, archive, data):
        self.archive, self.data = archive, data
        self.replacements, self.slots, self.source_issues, self.mapping_issues, self.charts, self.blank_charts = [], [], [], [], [], []
        self.table_rows, self.context, self.series = {}, month_context(data["report_month"]), {}
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
        source = op.get("source")
        if source not in TABLE_SOURCES:
            self.problem(op, f"未知数据源字段 {source}")
            return None
        if source not in self.table_rows:
            rows, issues = TABLE_SOURCES[source](self.data)
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
            if source and source not in HIGHLIGHT_SOURCES:
                self.problem(op, f"未知高亮数据 {source}")
            else:
                keys = HIGHLIGHT_SOURCES[source](self.data) if source else set()
                column = int(highlight.get("keyColumn", 0))
                self.replacements.append({"kind": "tableFills", "slide": op["slide"], "tableId": op["tableId"],
                                          "firstRow": header_row + 1, "color": highlight.get("color", "FAF3E3"),
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
        if not current:
            self.problem(op, "文字对象已为空")
            return
        self.replacements.append({"kind": "shapeReplace", "slide": op["slide"], "shapeId": op["shapeId"],
                                  "expectedText": current, "value": ""})
        if op.get("slot", True):
            self.slots.append({"slide": op["slide"], "objectId": op["shapeId"], "type": "text"})

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

    def do_chartSlot(self, op):
        try:
            chart, workbook = resolve_chart(self.archive, op["slide"], op["chartId"])
        except (KeyError, ValueError):
            self.problem(op, "图表对象不存在")
            return
        self.blank_charts.append({"part": chart, "workbook": workbook})
        self.slots.append({"slide": op["slide"], "objectId": op["chartId"], "type": "chart"})

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


def compile_mapping(mapping, template, data, audit):
    validate_mapping(mapping)
    check_contract(data, audit)
    with zipfile.ZipFile(template) as archive:
        if archive.testzip() is not None:
            raise ValueError("Template PPTX ZIP damaged")
        compiler = Compiler(archive, data)
        if uses_market(mapping):
            text, compiler.series = market_values(data)
            compiler.context.update(text)
        for op in mapping["ops"]:
            getattr(compiler, "do_" + op["op"])(op)
        if uses_market(mapping):
            compiler.source_issues.extend(MARKET_ISSUES)
    return {"replacements": compiler.replacements, "slots": compiler.slots, "charts": compiler.charts, "blankCharts": compiler.blank_charts,
            "sourceIssues": compiler.source_issues, "mappingIssues": compiler.mapping_issues}


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
            if "shapeId" in op and op["shapeId"] not in shape_texts(xml):
                problems.append({"op": op["op"], "slide": op["slide"], "object": op["shapeId"], "reason": "文字对象不存在"})
            if "pictureId" in op and op["pictureId"] not in object_ids(xml, "pic", "nvPicPr"):
                problems.append({"op": op["op"], "slide": op["slide"], "object": op["pictureId"], "reason": "图片对象不存在"})
            if "chartId" in op and op["chartId"] not in object_ids(xml, "graphicFrame", "nvGraphicFramePr"):
                problems.append({"op": op["op"], "slide": op["slide"], "object": op["chartId"], "reason": "图表对象不存在"})
            if "tableId" in op:
                try:
                    table_values(xml, op["tableId"])
                except ValueError:
                    problems.append({"op": op["op"], "slide": op["slide"], "object": op["tableId"], "reason": "表格不存在"})
    return {"ok": not problems, "operations": len(mapping["ops"]), "problems": problems}
