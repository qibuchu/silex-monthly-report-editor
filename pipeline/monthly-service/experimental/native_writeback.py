"""Read a PPTX's editable content and write object-level text changes back to it."""

import argparse
import copy
import html
import json
import os
import re
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from native_mapping import NS, presentation_order
from pptx_market_charts import resolve_chart


P = "{" + NS["p"] + "}"
A = "{" + NS["a"] + "}"
C = "{http://schemas.openxmlformats.org/drawingml/2006/chart}"
PARAGRAPH = rb"<a:p\s*/>|<a:p(?:\s[^>]*)?>.*?</a:p>"
TEXT = rb"<a:t(?:\s[^>]*)?/>|<a:t(?:\s[^>]*)?>.*?</a:t>"
RUN = rb"<a:r(?:\s[^>]*)?>.*?</a:r>"


def body_paragraphs(body):
    result = []
    for paragraph in body.findall(A + "p"):
        tokens = []
        for child in paragraph:
            if child.tag in (A + "r", A + "fld"):
                tokens.append(child.findtext(A + "t") or "")
            elif child.tag == A + "br":
                tokens.append("\n")
        result.append(tokens)
    return result


def chart_data(archive, slide, chart_id):
    part, _ = resolve_chart(archive, slide, chart_id)
    root = ElementTree.fromstring(archive.read(part))
    def points(node):
        found = {int(point.get("idx")): point.findtext(C + "v") for point in node.iter(C + "pt")} if node is not None else {}
        return [found[index] for index in sorted(found)]
    series = []
    categories = []
    for item in root.iter(C + "ser"):
        categories = categories or points(item.find(C + "cat"))
        name = item.find(C + "tx")
        series.append({"name": "".join(point.text or "" for point in name.iter(C + "v")) if name is not None else "",
                       "values": [float(value) for value in points(item.find(C + "val"))]})
    return {"categories": categories, "series": series}


def extract(source: Path):
    with zipfile.ZipFile(source) as archive:
        order = presentation_order(archive)
        slides = {}
        for slide in order:
            root = ElementTree.fromstring(archive.read(f"ppt/slides/slide{slide}.xml"))
            shapes, tables, charts = {}, {}, {}
            for shape in root.iter(P + "sp"):
                body = shape.find(P + "txBody")
                shapes[shape.find(P + "nvSpPr/" + P + "cNvPr").get("id")] = body_paragraphs(body) if body is not None else []
            for frame in root.iter(P + "graphicFrame"):
                identifier = frame.find(P + "nvGraphicFramePr/" + P + "cNvPr").get("id")
                table = frame.find(".//" + A + "tbl")
                if table is not None:
                    tables[identifier] = [[body_paragraphs(cell.find(A + "txBody")) if cell.find(A + "txBody") is not None else []
                                           for cell in row.findall(A + "tc")] for row in table.findall(A + "tr")]
                elif frame.find(".//" + C + "chart") is not None:
                    charts[identifier] = chart_data(archive, slide, int(identifier))
            pictures = [picture.find(P + "nvPicPr/" + P + "cNvPr").get("id") for picture in root.iter(P + "pic")]
            slides[str(slide)] = {"shapes": shapes, "tables": tables, "charts": charts, "pictures": pictures}
    return {"order": order, "slides": slides}


def strip_bullet(tokens):
    if tokens and tokens[0].lstrip().startswith("•"):
        rest = tokens[0].lstrip()[1:].lstrip()
        return ([rest] if rest else []) + tokens[1:]
    return tokens


def guard_text(paragraphs):
    """Whitespace-free text used only to detect that the PPTX moved under us."""
    return re.sub(r"\s+", "", "".join("".join(strip_bullet(tokens)) for tokens in paragraphs))


def native_text(body: bytes):
    return re.sub(r"\s+", "", "".join(html.unescape(re.sub(rb"<[^>]+>", b"", item).decode("utf-8"))
                                      for item in re.findall(TEXT, body, re.DOTALL)))


def encode(value):
    return html.escape(value, quote=False).encode("utf-8")


def with_text(run: bytes, value: str):
    match = re.search(TEXT, run, re.DOTALL)
    return run[:match.start()] + b"<a:t>" + encode(value) + b"</a:t>" + run[match.end():]


def new_run(paragraph: bytes):
    """Build a run for an empty paragraph from its end-of-paragraph formatting."""
    end = re.search(rb"<a:endParaRPr\b([^>]*?)(/>|>(.*?)</a:endParaRPr>)", paragraph, re.DOTALL)
    if not end:
        return b"<a:r><a:t></a:t></a:r>"
    inner = end.group(3)
    properties = b"<a:rPr" + end.group(1) + (b"/>" if inner is None else b">" + inner + b"</a:rPr>")
    return b"<a:r>" + properties + b"<a:t></a:t></a:r>"


def set_paragraph(paragraph: bytes, tokens: list):
    if re.fullmatch(rb"<a:p\s*/>", paragraph):
        paragraph = b"<a:p></a:p>"
    if re.search(rb"<a:bu(?:Char|AutoNum|Blip)\b", paragraph):
        tokens = strip_bullet(tokens)
    tokens = [] if not "".join(tokens).strip("\n") else tokens
    texts = [token for token in tokens if token != "\n"]
    runs = list(re.finditer(RUN, paragraph, re.DOTALL))
    breaks = len(re.findall(rb"<a:br\b", paragraph))
    if runs and len(runs) == len(texts) and tokens.count("\n") == breaks:
        for run, value in reversed(list(zip(runs, texts))):
            paragraph = paragraph[:run.start()] + with_text(run.group(), value) + paragraph[run.end():]
        return paragraph
    template = runs[0].group() if runs else new_run(paragraph)
    built = b"".join(b"<a:br/>" if token == "\n" else with_text(template, token) for token in tokens) or with_text(template, "")
    head = re.match(rb"<a:p(?:\s[^>]*)?>(?:<a:pPr\b[^>]*/>|<a:pPr\b[^>]*>.*?</a:pPr>)?", paragraph, re.DOTALL)
    tail = re.search(rb"<a:endParaRPr\b.*?(?:/>|</a:endParaRPr>)\s*</a:p>$|</a:p>$", paragraph, re.DOTALL)
    return head.group() + built + paragraph[tail.start():]


def set_body(body: bytes, paragraphs: list):
    existing = list(re.finditer(PARAGRAPH, body, re.DOTALL))
    if not existing:
        raise ValueError("文本框没有段落")
    paragraphs = paragraphs or [[]]
    built = [set_paragraph(existing[min(index, len(existing) - 1)].group(), tokens) for index, tokens in enumerate(paragraphs)]
    return body[:existing[0].start()] + b"".join(built) + body[existing[-1].end():]


def one_object(xml: bytes, pattern: bytes, identifier: int):
    marker = rb'<p:cNvPr\b[^>]*\bid="' + str(identifier).encode() + rb'"'
    found = [match for match in re.finditer(pattern, xml, re.DOTALL) if re.search(marker, match.group())]
    if len(found) != 1:
        raise ValueError(f"对象 {identifier} 不存在或不唯一")
    return found[0]


def apply_text(xml: bytes, change: dict):
    shape = one_object(xml, rb"<p:sp\b[^>]*>.*?</p:sp>", change["shapeId"])
    body = re.search(rb"<p:txBody>.*?</p:txBody>", shape.group(), re.DOTALL)
    if not body:
        raise ValueError("对象没有文本框")
    if native_text(body.group()) != guard_text(change["before"]):
        raise ValueError("PPTX 中的文字与修改前不一致")
    updated = set_body(body.group(), change["paragraphs"])
    changed = shape.group()[:body.start()] + updated + shape.group()[body.end():]
    return xml[:shape.start()] + changed + xml[shape.end():]


def apply_cell(xml: bytes, change: dict):
    frame = one_object(xml, rb"<p:graphicFrame\b[^>]*>.*?</p:graphicFrame>", change["tableId"])
    rows = list(re.finditer(rb"<a:tr\b[^>]*>.*?</a:tr>", frame.group(), re.DOTALL))
    if change["row"] >= len(rows):
        raise ValueError("表格行不存在")
    cells = list(re.finditer(rb"<a:tc\b[^>]*>.*?</a:tc>", rows[change["row"]].group(), re.DOTALL))
    if change["column"] >= len(cells):
        raise ValueError("表格列不存在")
    cell = cells[change["column"]]
    body = re.search(rb"<a:txBody>.*?</a:txBody>", cell.group(), re.DOTALL)
    if not body:
        raise ValueError("单元格没有文本框")
    if native_text(body.group()) != guard_text(change["before"]):
        raise ValueError("PPTX 中的单元格与修改前不一致")
    updated = set_body(body.group(), change["paragraphs"])
    new_cell = cell.group()[:body.start()] + updated + cell.group()[body.end():]
    new_row = rows[change["row"]].group()[:cell.start()] + new_cell + rows[change["row"]].group()[cell.end():]
    row = rows[change["row"]]
    new_frame = frame.group()[:row.start()] + new_row + frame.group()[row.end():]
    return xml[:frame.start()] + new_frame + xml[frame.end():]


def apply(source: Path, changes: list, output: Path):
    applied, rejected, updated = 0, [], {}
    with zipfile.ZipFile(source) as archive:
        names = set(archive.namelist())
        for change in changes:
            name = f"ppt/slides/slide{change['slide']}.xml"
            try:
                if name not in names:
                    raise ValueError("幻灯片不存在")
                xml = updated.get(name, archive.read(name))
                result = apply_text(xml, change) if change["kind"] == "text" else apply_cell(xml, change)
                ElementTree.fromstring(result)
                updated[name] = result
                applied += 1
            except (ValueError, ElementTree.ParseError) as error:
                rejected.append({"id": change.get("id"), "row": change.get("row"), "column": change.get("column"), "reason": str(error)})
        if not updated:
            return {"applied": 0, "rejected": rejected, "written": False}
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".partial", delete=False) as temp:
            path = Path(temp.name)
        try:
            with zipfile.ZipFile(path, "w") as target:
                target.comment = archive.comment
                for info in archive.infolist():
                    target.writestr(copy.copy(info), updated.get(info.filename, archive.read(info.filename)))
            with zipfile.ZipFile(path) as check:
                if check.testzip() is not None:
                    raise ValueError("写回后的 PPTX 校验失败")
            os.replace(path, output)
        finally:
            path.unlink(missing_ok=True)
    return {"applied": applied, "rejected": rejected, "written": True}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    read = commands.add_parser("extract")
    read.add_argument("source", type=Path)
    write = commands.add_parser("apply")
    for name in ("source", "changes", "output"):
        write.add_argument(name, type=Path)
    args = parser.parse_args()
    if args.command == "extract":
        print(json.dumps(extract(args.source), ensure_ascii=False))
    else:
        changes = json.loads(args.changes.read_text(encoding="utf-8"))
        print(json.dumps(apply(args.source, changes, args.output), ensure_ascii=False))


if __name__ == "__main__":
    main()
