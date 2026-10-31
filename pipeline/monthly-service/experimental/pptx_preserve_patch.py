"""Proof of concept: replace selected native PPTX table cells without rebuilding slides."""

import argparse
import copy
import hashlib
import html
import json
import os
import re
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree


def scoped_sub(data: bytes, pattern: bytes, index: int, replacement):
    matches = list(re.finditer(pattern, data, re.DOTALL))
    if index < 0 or index >= len(matches):
        raise ValueError(f"Object index {index} outside 0..{len(matches) - 1}")
    match = matches[index]
    return data[:match.start()] + replacement(match.group()) + data[match.end():]


def patch_cell(slide_xml: bytes, table_id: int, row: int, column: int, expected: str | None, value: str):
    frames = list(re.finditer(rb"<p:graphicFrame\b[^>]*>.*?</p:graphicFrame>", slide_xml, re.DOTALL))
    matches = [m for m in frames if re.search(rb'<p:cNvPr\b[^>]*\bid="' + str(table_id).encode() + rb'"', m.group())]
    if len(matches) != 1 or b"<a:tbl>" not in matches[0].group():
        raise ValueError(f"Native table id {table_id} missing or ambiguous")
    frame = matches[0]

    def patch_frame(data):
        def patch_row(data):
            def patch_column(data):
                text_runs = list(re.finditer(rb"<a:t(?:\s[^>]*)?>.*?</a:t>", data, re.DOTALL))
                old = "".join(html.unescape(re.sub(rb"<[^>]+>", b"", m.group()).decode("utf-8")) for m in text_runs)
                if expected is not None and old != expected:
                    raise ValueError(f"Expected cell {expected!r}, found {old!r}")
                if value == old:
                    return data
                if not text_runs:
                    raise ValueError("Cell has no editable text run")
                encoded = html.escape(value, quote=False).encode("utf-8")
                for i, match in reversed(list(enumerate(text_runs))):
                    start, end = match.span()
                    original = match.group()
                    opening = original[:original.find(b">") + 1]
                    data = data[:start] + opening + (encoded if i == 0 else b"") + b"</a:t>" + data[end:]
                return data
            return scoped_sub(data, rb"<a:tc\b[^>]*>.*?</a:tc>", column, patch_column)
        return scoped_sub(data, rb"<a:tr\b[^>]*>.*?</a:tr>", row, patch_row)

    changed = patch_frame(frame.group())
    return slide_xml[:frame.start()] + changed + slide_xml[frame.end():]


def table_values(slide_xml: bytes, table_id: int):
    ns = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main",
          "a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
    root = ElementTree.fromstring(slide_xml)
    frames = [frame for frame in root.findall(".//p:graphicFrame", ns)
              if frame.find("p:nvGraphicFramePr/p:cNvPr", ns) is not None
              and frame.find("p:nvGraphicFramePr/p:cNvPr", ns).get("id") == str(table_id)]
    if len(frames) != 1:
        raise ValueError(f"Native table id {table_id} missing or ambiguous")
    rows = frames[0].findall("a:graphic/a:graphicData/a:tbl/a:tr", ns)
    if not rows:
        raise ValueError(f"Native table id {table_id} has no rows")
    return [["".join(t.text or "" for t in cell.findall(".//a:t", ns))
             for cell in row.findall("a:tc", ns)] for row in rows]


def patch_table(slide_xml: bytes, table_id: int, header_row: int, expected_header: list[str],
                rows: list[list[str]], first_data_row: int | None = None,
                new_header: list[str] | None = None):
    old = table_values(slide_xml, table_id)
    if header_row < 0 or header_row >= len(old) or old[header_row] != expected_header:
        raise ValueError("Table header changed; remap before filling")
    first = header_row + 1 if first_data_row is None else first_data_row
    if first <= header_row or first >= len(old):
        raise ValueError("First data row is outside the template table")
    capacity = len(old) - first
    if len(rows) > capacity:
        raise ValueError(f"Table has {len(rows)} source rows but only {capacity} editable rows; add a continuation page")
    columns = len(old[header_row])
    if any(len(row) != columns for row in rows) or any(len(row) != columns for row in old[first:]):
        raise ValueError("Table column count changed; remap before filling")
    if new_header is not None:
        if len(new_header) != columns:
            raise ValueError("New table header column count differs from template")
        for column, value in enumerate(new_header):
            slide_xml = patch_cell(slide_xml, table_id, header_row, column, expected_header[column], str(value))
    for index in range(capacity):
        values = rows[index] if index < len(rows) else [""] * columns
        for column, value in enumerate(values):
            if not isinstance(value, (str, int, float)) or isinstance(value, bool):
                raise ValueError("Table cell must contain an explicit string or number")
            slide_xml = patch_cell(slide_xml, table_id, first + index, column, old[first + index][column], str(value))
    return slide_xml


def patch_shape_fragment(slide_xml: bytes, shape_id: int, expected_text: str, old_fragment: str, new_fragment: str):
    shapes = list(re.finditer(rb"<p:sp\b[^>]*>.*?</p:sp>", slide_xml, re.DOTALL))
    matches = [match for match in shapes if re.search(rb'<p:cNvPr\b[^>]*\bid="' + str(shape_id).encode() + rb'"', match.group())]
    if len(matches) != 1:
        raise ValueError(f"Native shape id {shape_id} missing or ambiguous")
    shape = matches[0]
    runs = list(re.finditer(rb"<a:t(?:\s[^>]*)?>.*?</a:t>", shape.group(), re.DOTALL))
    texts = [html.unescape(re.sub(rb"<[^>]+>", b"", run.group()).decode("utf-8")) for run in runs]
    if "".join(texts) != expected_text or not old_fragment:
        raise ValueError("Shape text changed; review month binding")
    full_text = "".join(texts)
    if full_text.count(old_fragment) != 1:
        raise ValueError("Month fragment is not unique")
    start = full_text.index(old_fragment)
    end = start + len(old_fragment)
    affected = []
    offset = 0
    for index, value in enumerate(texts):
        left, right = max(start, offset), min(end, offset + len(value))
        if left < right:
            affected.append((index, left - offset, right - offset, left - start, right - start))
        offset += len(value)
    if len(affected) > 1 and len(old_fragment) != len(new_fragment):
        raise ValueError("Changed-length fragment crosses styled text runs")
    if old_fragment == new_fragment:
        return slide_xml
    changed = shape.group()
    for index, left, right, replacement_left, replacement_right in reversed(affected):
        run = runs[index]
        original = run.group()
        opening = original[:original.find(b">") + 1]
        fragment_part = new_fragment if len(affected) == 1 else new_fragment[replacement_left:replacement_right]
        replacement_text = texts[index][:left] + fragment_part + texts[index][right:]
        if replacement_text == texts[index]:
            continue
        replacement = opening + html.escape(replacement_text, quote=False).encode("utf-8") + b"</a:t>"
        changed = changed[:run.start()] + replacement + changed[run.end():]
    return slide_xml[:shape.start()] + changed + slide_xml[shape.end():]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("spec", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        raise ValueError("Output must differ from source")
    spec = json.loads(args.spec.read_text(encoding="utf-8"))
    replacements = spec.get("replacements") if isinstance(spec, dict) else spec
    if not isinstance(replacements, list) or not replacements:
        raise ValueError("Spec must be a nonempty array")
    with zipfile.ZipFile(args.source) as source:
        if any(item.get("kind") == "table" for item in replacements):
            actual = hashlib.sha256(args.source.read_bytes()).hexdigest()
            if not isinstance(spec, dict) or spec.get("sourceSha256") != actual:
                raise ValueError("PPTX source hash changed; review table mapping before filling")
        changed = {}
        for item in replacements:
            slide = int(item["slide"])
            name = f"ppt/slides/slide{slide}.xml"
            if name not in source.namelist():
                raise ValueError(f"Missing {name}")
            data = changed.get(name, source.read(name))
            if item.get("kind") == "table":
                changed[name] = patch_table(data, int(item["tableId"]), int(item["headerRow"]),
                                            item["expectedHeader"], item["rows"], item.get("firstDataRow"),
                                            item.get("newHeader"))
            elif item.get("kind") == "shapeText":
                changed[name] = patch_shape_fragment(data, int(item["shapeId"]), item["expectedText"],
                                                     item["oldFragment"], item["newFragment"])
            else:
                changed[name] = patch_cell(data, int(item["tableId"]), int(item["row"]),
                                           int(item["column"]), str(item["expected"]), str(item["value"]))
            ElementTree.fromstring(changed[name])
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=args.output.parent, suffix=".partial", delete=False) as temp:
            temp_path = Path(temp.name)
        try:
            with zipfile.ZipFile(temp_path, "w") as output:
                output.comment = source.comment
                for info in source.infolist():
                    output.writestr(copy.copy(info), changed.get(info.filename, source.read(info.filename)))
            with zipfile.ZipFile(temp_path) as after:
                modified = [name for name in source.namelist()
                            if hashlib.sha256(source.read(name)).digest() != hashlib.sha256(after.read(name)).digest()]
                if not set(modified).issubset(changed) or after.testzip() is not None:
                    raise ValueError("PPTX output integrity check failed")
            os.replace(temp_path, args.output)
        finally:
            temp_path.unlink(missing_ok=True)
    print(json.dumps({"output": str(args.output), "modifiedEntries": modified, "replacements": len(replacements)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
