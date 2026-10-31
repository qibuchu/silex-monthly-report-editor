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


PARAGRAPH = rb"<a:p\s*/>|<a:p(?:\s[^>]*)?>.*?</a:p>"


def run_text(element: bytes):
    """Text of an a:t element as an XML parser reads it (line breaks normalised to \n)."""
    raw = re.sub(rb"<[^>]+>", b"", element).replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return html.unescape(raw.decode("utf-8"))
RUN = rb"<a:r(?:\s[^>]*)?>.*?</a:r>"


def blank_paragraph(paragraph: bytes):
    """Empty a paragraph but keep its formatting for whoever fills it in.

    PowerPoint drops runs without text on load, and their formatting with them.
    An empty paragraph keeps its style only on the end-of-paragraph marker.
    """
    run = re.search(RUN, paragraph, re.DOTALL)
    if not run:
        return paragraph
    head = re.match(rb"<a:p(?:\s[^>]*)?>(?:<a:pPr\b[^>]*/>|<a:pPr\b[^>]*>.*?</a:pPr>)?", paragraph, re.DOTALL).group()
    properties = re.search(rb"<a:rPr\b([^>]*?)(/>|>(.*?)</a:rPr>)", run.group(), re.DOTALL)
    existing = re.search(rb"<a:endParaRPr\b[^>]*/>|<a:endParaRPr\b[^>]*>.*?</a:endParaRPr>", paragraph, re.DOTALL)
    if properties:
        inner = properties.group(3)
        end = b"<a:endParaRPr" + properties.group(1) + (b"/>" if inner is None else b">" + inner + b"</a:endParaRPr>")
    else:
        end = existing.group() if existing else b""
    return head + end + b"</a:p>"


def settle_blank_paragraphs(xml: bytes):
    def settle(match):
        texts = re.findall(rb"<a:t(?:\s[^>]*)?>(.*?)</a:t>", match.group(), re.DOTALL)
        return match.group() if any(texts) else blank_paragraph(match.group())
    return re.sub(PARAGRAPH, settle, xml, flags=re.DOTALL)


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
                return settle_blank_paragraphs(data)
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


def trim_table_rows(slide_xml: bytes, table_id: int, keep_rows: int):
    """Remove unused native table rows and set the frame height to their summed heights."""
    frames = list(re.finditer(rb"<p:graphicFrame\b[^>]*>.*?</p:graphicFrame>", slide_xml, re.DOTALL))
    matches = [match for match in frames if re.search(rb'<p:cNvPr\b[^>]*\bid="' + str(table_id).encode() + rb'"', match.group())]
    if len(matches) != 1 or b"<a:tbl>" not in matches[0].group():
        raise ValueError("Native table missing or ambiguous")
    frame = matches[0]
    rows = list(re.finditer(rb"<a:tr\b[^>]*>.*?</a:tr>", frame.group(), re.DOTALL))
    if keep_rows < 2 or keep_rows > len(rows):
        raise ValueError("Invalid table row count")
    heights = []
    for row in rows[:keep_rows]:
        match = re.search(rb'<a:tr\b[^>]*\bh="(\d+)"', row.group())
        if not match:
            raise ValueError("Table row has no height")
        heights.append(int(match.group(1)))
    changed = frame.group()
    for row in reversed(rows[keep_rows:]):
        changed = changed[:row.start()] + changed[row.end():]
    xfrm = re.search(rb'<p:xfrm>.*?</p:xfrm>', changed, re.DOTALL)
    if not xfrm or not re.search(rb'<a:ext\b[^>]*\bcy="\d+"', xfrm.group()):
        raise ValueError("Table frame has no height")
    new_xfrm = re.sub(rb'(<a:ext\b[^>]*\bcy=")\d+("[^>]*/>)',
                      lambda match: match.group(1) + str(sum(heights)).encode() + match.group(2), xfrm.group(), count=1)
    changed = changed[:xfrm.start()] + new_xfrm + changed[xfrm.end():]
    return slide_xml[:frame.start()] + changed + slide_xml[frame.end():]


def patch_shape_fragment(slide_xml: bytes, shape_id: int, expected_text: str, old_fragment: str, new_fragment: str):
    shapes = list(re.finditer(rb"<p:sp\b[^>]*>.*?</p:sp>", slide_xml, re.DOTALL))
    matches = [match for match in shapes if re.search(rb'<p:cNvPr\b[^>]*\bid="' + str(shape_id).encode() + rb'"', match.group())]
    if len(matches) != 1:
        raise ValueError(f"Native shape id {shape_id} missing or ambiguous")
    shape = matches[0]
    runs = list(re.finditer(rb"<a:t(?:\s[^>]*)?>.*?</a:t>", shape.group(), re.DOTALL))
    texts = [run_text(run.group()) for run in runs]
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
    if old_fragment == new_fragment:
        return slide_xml
    changed = shape.group()
    # A longer or shorter value (7月 to 10月) keeps its text in the first styled run.
    same_length = len(old_fragment) == len(new_fragment)
    for position, (index, left, right, replacement_left, replacement_right) in reversed(list(enumerate(affected))):
        run = runs[index]
        original = run.group()
        opening = original[:original.find(b">") + 1]
        if len(affected) == 1:
            fragment_part = new_fragment
        elif same_length:
            fragment_part = new_fragment[replacement_left:replacement_right]
        else:
            fragment_part = new_fragment if position == 0 else ""
        replacement_text = texts[index][:left] + fragment_part + texts[index][right:]
        if replacement_text == texts[index]:
            continue
        replacement = opening + html.escape(replacement_text, quote=False).encode("utf-8") + b"</a:t>"
        changed = changed[:run.start()] + replacement + changed[run.end():]
    return slide_xml[:shape.start()] + changed + slide_xml[shape.end():]


def replace_shape_text(slide_xml: bytes, shape_id: int, expected_text: str, value: str):
    """Replace a reviewed text shape while retaining its geometry and first-run style."""
    shapes = list(re.finditer(rb"<p:sp\b[^>]*>.*?</p:sp>", slide_xml, re.DOTALL))
    matches = [match for match in shapes if re.search(rb'<p:cNvPr\b[^>]*\bid="' + str(shape_id).encode() + rb'"', match.group())]
    if len(matches) != 1:
        raise ValueError("Native text shape missing or ambiguous")
    shape = matches[0]
    runs = list(re.finditer(rb"<a:t(?:\s[^>]*)?>.*?</a:t>", shape.group(), re.DOTALL))
    old = "".join(run_text(run.group()) for run in runs)
    if not runs or old != expected_text:
        raise ValueError("Text shape changed; review manual slot mapping")
    changed = shape.group()
    for index, run in reversed(list(enumerate(runs))):
        opening = run.group()[:run.group().find(b">") + 1]
        replacement = opening + (html.escape(value, quote=False).encode("utf-8") if index == 0 else b"") + b"</a:t>"
        changed = changed[:run.start()] + replacement + changed[run.end():]
    # Bullets stay: PowerPoint hides them on empty lines and restores them when filled.
    return slide_xml[:shape.start()] + settle_blank_paragraphs(changed) + slide_xml[shape.end():]


def replace_shape_runs(slide_xml: bytes, shape_id: int, expected_runs: list[str], values: list[str]):
    """Replace each styled run independently, preserving KPI label and number styles."""
    shapes = list(re.finditer(rb"<p:sp\b[^>]*>.*?</p:sp>", slide_xml, re.DOTALL))
    matches = [match for match in shapes if re.search(rb'<p:cNvPr\b[^>]*\bid="' + str(shape_id).encode() + rb'"', match.group())]
    if len(matches) != 1:
        raise ValueError("Native text shape missing or ambiguous")
    shape = matches[0]
    runs = list(re.finditer(rb"<a:t(?:\s[^>]*)?>.*?</a:t>", shape.group(), re.DOTALL))
    old = [run_text(run.group()) for run in runs]
    if old != expected_runs or len(values) != len(old):
        raise ValueError("Styled shape runs changed; review KPI binding")
    changed = shape.group()
    for run, value in reversed(list(zip(runs, values))):
        opening = run.group()[:run.group().find(b">") + 1]
        replacement = opening + html.escape(str(value), quote=False).encode("utf-8") + b"</a:t>"
        changed = changed[:run.start()] + replacement + changed[run.end():]
    return slide_xml[:shape.start()] + settle_blank_paragraphs(changed) + slide_xml[shape.end():]


SLOT_MEDIA = "ppt/media/monthly-image-slot.png"
SLOT_LABEL = "图片待补"
IMAGE_REL = b"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"


def slot_png(size=200):
    """A light grey picture glyph. It stretches to any frame, so it carries no text."""
    import struct
    import zlib
    background, mark = (240, 240, 240), (200, 205, 211)
    rows = []
    for y in range(size):
        row = bytearray(b"\x00")
        for x in range(size):
            border = x < 3 or y < 3 or x >= size - 3 or y >= size - 3
            sun = (x - 0.66 * size) ** 2 + (y - 0.33 * size) ** 2 < (0.09 * size) ** 2
            base = 0.78 * size
            left = y > base - (0.32 * size - abs(x - 0.38 * size)) and y < base and abs(x - 0.38 * size) < 0.32 * size
            right = y > base - (0.2 * size - abs(x - 0.68 * size)) and y < base and abs(x - 0.68 * size) < 0.2 * size
            row += bytes(mark if border or sun or left or right else background)
        rows.append(bytes(row))
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")


def picture_to_slot(slide_xml: bytes, rels_xml: bytes, picture_id: int):
    """Swap the image inside a picture for a placeholder.

    The picture frame, position, size, crop and effects stay, so the person
    filling the draft can right-click it and use Change Picture.
    """
    pictures = list(re.finditer(rb"<p:pic\b[^>]*>.*?</p:pic>", slide_xml, re.DOTALL))
    matches = [match for match in pictures if re.search(rb'<p:cNvPr\b[^>]*\bid="' + str(picture_id).encode() + rb'"', match.group())]
    if len(matches) != 1:
        raise ValueError("Picture object missing or ambiguous")
    picture = matches[0].group()
    embed = re.search(rb'(<a:blip\b[^>]*\br:embed=")([^"]+)(")', picture)
    if not embed:
        raise ValueError("Picture has no embedded image")
    relations = re.findall(rb"<Relationship\b[^>]*/>", rels_xml)
    slot_id = next((re.search(rb'\bId="([^"]+)"', item).group(1) for item in relations
                    if re.search(rb'\bTarget="\.\./media/monthly-image-slot\.png"', item)), None)
    if slot_id is None:
        numbers = [int(value) for value in re.findall(rb'\bId="rId(\d+)"', rels_xml)]
        slot_id = b"rId" + str(max(numbers, default=0) + 1).encode()
        entry = b'<Relationship Id="' + slot_id + b'" Type="' + IMAGE_REL + b'" Target="../media/monthly-image-slot.png"/>'
        rels_xml = rels_xml.replace(b"</Relationships>", entry + b"</Relationships>", 1)
    old_id = embed.group(2)
    picture = picture[:embed.start()] + embed.group(1) + slot_id + embed.group(3) + picture[embed.end():]
    picture = re.sub(rb'<asvg:svgBlip\b[^>]*/>', b"", picture)
    marker = re.search(rb"<p:cNvPr\b[^>]*?(/?>)", picture)
    tag = re.sub(rb'\sdescr="[^"]*"', b"", marker.group()[:-len(marker.group(1))])
    picture = picture[:marker.start()] + tag + b' descr="' + SLOT_LABEL.encode("utf-8") + b'"' + marker.group(1) + picture[marker.end():]
    slide_xml = slide_xml[:matches[0].start()] + picture + slide_xml[matches[0].end():]
    if old_id != slot_id and not re.search(rb'r:(?:embed|link|id)="' + re.escape(old_id) + rb'"', slide_xml):
        rels_xml = re.sub(rb'<Relationship\b[^>]*\bId="' + re.escape(old_id) + rb'"[^>]*/>', b"", rels_xml)
    return slide_xml, rels_xml


def table_fill_span(cell: bytes):
    """Locate the cell background, the fill that follows the border lines."""
    properties = re.search(rb"<a:tcPr\b[^>]*?(/>|>.*?</a:tcPr>)", cell, re.DOTALL)
    if not properties:
        return None
    inner_start = cell.find(b">", properties.start()) + 1
    if properties.group(1) == b"/>":
        return properties, None
    inner_end = properties.end() - len(b"</a:tcPr>")
    inner = cell[inner_start:inner_end]
    last = 0
    for border in re.finditer(rb"<a:ln(L|R|T|B|TlToBr|BlToTr)\b[^>]*?(?:/>|>.*?</a:ln\1>)", inner, re.DOTALL):
        last = border.end()
    fill = re.compile(rb"<a:noFill/>|<a:solidFill>.*?</a:solidFill>|<a:gradFill\b.*?</a:gradFill>|<a:pattFill\b.*?</a:pattFill>", re.DOTALL).match(inner, last)
    if fill:
        return properties, (inner_start + fill.start(), inner_start + fill.end())
    return properties, (inner_start + last, inner_start + last)


def set_row_fills(slide_xml: bytes, table_id: int, first_row: int, flags: list, color: str):
    """Mark selected data rows with the highlight colour and reset the others."""
    frames = list(re.finditer(rb"<p:graphicFrame\b[^>]*>.*?</p:graphicFrame>", slide_xml, re.DOTALL))
    matches = [match for match in frames if re.search(rb'<p:cNvPr\b[^>]*\bid="' + str(table_id).encode() + rb'"', match.group())]
    if len(matches) != 1 or b"<a:tbl>" not in matches[0].group():
        raise ValueError(f"Native table id {table_id} missing or ambiguous")
    frame = matches[0].group()
    rows = list(re.finditer(rb"<a:tr\b[^>]*>.*?</a:tr>", frame, re.DOTALL))
    if first_row + len(flags) > len(rows):
        raise ValueError("Highlight rows exceed the table")
    highlight = b'<a:solidFill><a:srgbClr val="' + color.upper().encode() + b'"/></a:solidFill>'
    normal = None
    for row in rows[first_row:first_row + len(flags)]:
        for cell in re.finditer(rb"<a:tc\b[^>]*>.*?</a:tc>", row.group(), re.DOTALL):
            span = table_fill_span(cell.group())
            if span and span[1] and span[1][0] != span[1][1]:
                fill = cell.group()[span[1][0]:span[1][1]]
                if color.upper().encode() not in fill.upper():
                    normal = normal or fill
    normal = normal or b"<a:noFill/>"
    for index in reversed(range(len(flags))):
        row = rows[first_row + index]
        updated = row.group()
        for cell in reversed(list(re.finditer(rb"<a:tc\b[^>]*>.*?</a:tc>", updated, re.DOTALL))):
            text = cell.group()
            span = table_fill_span(text)
            value = highlight if flags[index] else normal
            if span is None:
                text = text.replace(b"</a:tc>", b"<a:tcPr>" + value + b"</a:tcPr></a:tc>", 1)
            elif span[1] is None:
                properties = span[0]
                text = text[:properties.start()] + properties.group()[:-2] + b">" + value + b"</a:tcPr>" + text[properties.end():]
            else:
                text = text[:span[1][0]] + value + text[span[1][1]:]
            updated = updated[:cell.start()] + text + updated[cell.end():]
        frame = frame[:row.start()] + updated + frame[row.end():]
    return slide_xml[:matches[0].start()] + frame + slide_xml[matches[0].end():]


def drawing_xml(element: str, tag: str):
    """Serialise an ElementTree a:* fragment back with the slide's a: prefix."""
    node = ElementTree.fromstring(element)
    if node.tag != "{http://schemas.openxmlformats.org/drawingml/2006/main}" + tag:
        raise ValueError(f"Style must be a:{tag}")
    ElementTree.register_namespace("a", "http://schemas.openxmlformats.org/drawingml/2006/main")
    text = ElementTree.tostring(node, encoding="unicode")
    return re.sub(r'\s+xmlns:a="[^"]+"', "", text, count=1).encode("utf-8")


def set_run_style(slide_xml: bytes, shape_id: int, style: str, paragraph: str | None = None):
    """Give every run (and paragraph) in a shape the same properties as a reference cell.

    Used to clear per-row highlight colours and stray fonts in text-box tables.
    """
    shapes = list(re.finditer(rb"<p:sp\b[^>]*>.*?</p:sp>", slide_xml, re.DOTALL))
    matches = [match for match in shapes if re.search(rb'<p:cNvPr\b[^>]*\bid="' + str(shape_id).encode() + rb'"', match.group())]
    if len(matches) != 1:
        raise ValueError("Styled text shape missing or ambiguous")
    replacement = drawing_xml(style, "rPr")
    pattern = rb"<a:rPr\b[^>]*/>|<a:rPr\b[^>]*>.*?</a:rPr>"
    changed = re.sub(rb"(<a:r>|<a:r\s[^>]*>)(" + pattern + rb")?", lambda m: m.group(1) + replacement,
                     matches[0].group(), flags=re.DOTALL)
    # Cleared cells keep their style on the end-of-paragraph marker; restyle that too.
    marker = b"<a:endParaRPr" + replacement[len(b"<a:rPr"):]
    if marker.endswith(b"</a:rPr>"):
        marker = marker[:-len(b"</a:rPr>")] + b"</a:endParaRPr>"
    changed = re.sub(rb"<a:endParaRPr\b[^>]*/>|<a:endParaRPr\b[^>]*>.*?</a:endParaRPr>", lambda m: marker,
                     changed, flags=re.DOTALL)
    if paragraph:
        layout = drawing_xml(paragraph, "pPr")
        changed = re.sub(rb"(<a:p>|<a:p\s[^>]*>)(<a:pPr\b[^>]*/>|<a:pPr\b[^>]*>.*?</a:pPr>)?",
                         lambda m: m.group(1) + layout, changed, flags=re.DOTALL)
    return slide_xml[:matches[0].start()] + changed + slide_xml[matches[0].end():]


def hide_shape_fill(slide_xml: bytes, shape_id: int, expected_color: str):
    shapes = list(re.finditer(rb"<p:sp\b[^>]*>.*?</p:sp>", slide_xml, re.DOTALL))
    matches = [match for match in shapes if re.search(rb'<p:cNvPr\b[^>]*\bid="' + str(shape_id).encode() + rb'"', match.group())]
    if len(matches) != 1:
        raise ValueError("Filled shape missing or ambiguous")
    shape = matches[0]
    properties = re.search(rb'<p:spPr>.*?</p:spPr>', shape.group(), re.DOTALL)
    if not properties:
        raise ValueError("Shape has no visual properties")
    pattern = rb'<a:solidFill><a:srgbClr val="' + expected_color.encode() + rb'"/></a:solidFill>'
    changed, count = re.subn(pattern, b'<a:noFill/>', properties.group(), count=1)
    if count != 1:
        raise ValueError("Reviewed fill color changed")
    new_shape = shape.group()[:properties.start()] + changed + shape.group()[properties.end():]
    return slide_xml[:shape.start()] + new_shape + slide_xml[shape.end():]


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
        if any(item.get("kind") in ("table", "trimTable") for item in replacements):
            actual = hashlib.sha256(args.source.read_bytes()).hexdigest()
            if not isinstance(spec, dict) or spec.get("sourceSha256") != actual:
                raise ValueError("PPTX source hash changed; review table mapping before filling")
        changed, added = {}, {}
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
            elif item.get("kind") == "trimTable":
                changed[name] = trim_table_rows(data, int(item["tableId"]), int(item["keepRows"]))
            elif item.get("kind") == "shapeText":
                changed[name] = patch_shape_fragment(data, int(item["shapeId"]), item["expectedText"],
                                                     item["oldFragment"], item["newFragment"])
            elif item.get("kind") == "shapeReplace":
                changed[name] = replace_shape_text(data, int(item["shapeId"]), item["expectedText"], item["value"])
            elif item.get("kind") == "shapeRuns":
                changed[name] = replace_shape_runs(data, int(item["shapeId"]), item["expectedRuns"], item["values"])
            elif item.get("kind") == "pictureSlot":
                rels = f"ppt/slides/_rels/slide{slide}.xml.rels"
                changed[name], changed[rels] = picture_to_slot(data, changed.get(rels, source.read(rels)), int(item["pictureId"]))
                ElementTree.fromstring(changed[rels])
                added[SLOT_MEDIA] = slot_png()
            elif item.get("kind") == "tableFills":
                changed[name] = set_row_fills(data, int(item["tableId"]), int(item["firstRow"]), item["flags"], item["color"])
            elif item.get("kind") == "shapeRunStyle":
                changed[name] = set_run_style(data, int(item["shapeId"]), item["style"], item.get("paragraph"))
            elif item.get("kind") == "hideShapeFill":
                changed[name] = hide_shape_fill(data, int(item["shapeId"]), item["expectedColor"])
            else:
                changed[name] = patch_cell(data, int(item["tableId"]), int(item["row"]),
                                           int(item["column"]), str(item["expected"]), str(item["value"]))
            ElementTree.fromstring(changed[name])
        added = {name: data for name, data in added.items() if name not in source.namelist()}
        if added:
            types = changed.get("[Content_Types].xml", source.read("[Content_Types].xml"))
            if not re.search(rb'<Default\b[^>]*\bExtension="png"', types, re.IGNORECASE):
                types = types.replace(b"</Types>", b'<Default Extension="png" ContentType="image/png"/></Types>', 1)
                changed["[Content_Types].xml"] = types
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=args.output.parent, suffix=".partial", delete=False) as temp:
            temp_path = Path(temp.name)
        try:
            with zipfile.ZipFile(temp_path, "w") as output:
                output.comment = source.comment
                for info in source.infolist():
                    output.writestr(copy.copy(info), changed.get(info.filename, source.read(info.filename)))
                for name, data in added.items():
                    output.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
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
