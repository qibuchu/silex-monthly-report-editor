"""Update the preserved market charts and their embedded editable workbooks."""

import copy
import html
import io
import os
import re
import tempfile
import zipfile
from pathlib import Path


def replace_section(xml: bytes, tag: bytes, replacement):
    match = re.search(b"<c:" + tag + b">.*?</c:" + tag + b">", xml, re.DOTALL)
    if not match:
        raise ValueError(f"Chart section {tag!r} missing")
    return xml[:match.start()] + replacement(match.group()) + xml[match.end():]


def patch_points(section: bytes, values: list[str]):
    points = list(re.finditer(rb'<c:pt\b[^>]*\bidx="(\d+)"[^>]*>.*?</c:pt>', section, re.DOTALL))
    if [int(point.group(1)) for point in points] != list(range(len(values))):
        raise ValueError("Chart point indices differ from reviewed template")
    for point, value in reversed(list(zip(points, values))):
        old = point.group()
        updated, count = re.subn(rb'(<c:v>).*?(</c:v>)',
                                  lambda match: match.group(1) + html.escape(str(value)).encode() + match.group(2),
                                  old, count=1, flags=re.DOTALL)
        if count != 1:
            raise ValueError("Chart point value missing")
        section = section[:point.start()] + updated + section[point.end():]
    return section


def patch_chart(xml: bytes, categories: list[str], series: list[list[int]]):
    matches = list(re.finditer(rb'<c:ser>.*?</c:ser>', xml, re.DOTALL))
    if len(matches) != len(series):
        raise ValueError("Chart series count changed")
    for match, values in reversed(list(zip(matches, series))):
        if len(values) != len(categories):
            raise ValueError("Chart series length mismatch")
        data = match.group()
        data = replace_section(data, b'cat', lambda section: patch_points(section, categories))
        data = replace_section(data, b'val', lambda section: patch_points(section, [str(value) for value in values]))
        xml = xml[:match.start()] + data + xml[match.end():]
    return xml


def patch_cell(sheet: bytes, reference: str, value: int | None):
    pattern = rb'<c\b[^>]*\br="' + reference.encode() + rb'"[^>]*>.*?</c>'
    match = re.search(pattern, sheet, re.DOTALL)
    if not match:
        if value is None:
            return sheet
        raise ValueError(f"Workbook cell {reference} missing")
    old = match.group()
    if value is None:
        updated, count = re.subn(rb'<v>.*?</v>', b'', old, count=1, flags=re.DOTALL)
    else:
        updated, count = re.subn(rb'(<v>).*?(</v>)',
                                  lambda part: part.group(1) + str(value).encode() + part.group(2),
                                  old, count=1, flags=re.DOTALL)
    if count != 1:
        raise ValueError(f"Workbook cell {reference} has no cached value")
    return sheet[:match.start()] + updated + sheet[match.end():]


def shared_index(sheet: bytes, reference: str):
    match = re.search(rb'<c\b[^>]*\br="' + reference.encode() + rb'"\s+t="s"[^>]*><v>(\d+)</v></c>', sheet)
    if not match:
        raise ValueError(f"Workbook category {reference} is not a shared string")
    return int(match.group(1))


def patch_shared_strings(xml: bytes, mapping: dict[int, str]):
    entries = list(re.finditer(rb'<si>.*?</si>', xml, re.DOTALL))
    if any(index >= len(entries) for index in mapping):
        raise ValueError("Workbook shared string index changed")
    for index in sorted(mapping, reverse=True):
        entry = entries[index]
        updated, count = re.subn(rb'(<t(?:\s[^>]*)?>).*?(</t>)',
                                  lambda match: match.group(1) + html.escape(mapping[index]).encode() + match.group(2),
                                  entry.group(), count=1, flags=re.DOTALL)
        if count != 1:
            raise ValueError("Workbook shared string has no text")
        xml = xml[:entry.start()] + updated + xml[entry.end():]
    return xml


def blank_internal_ai_chart(xml: bytes):
    def blank(section):
        cache = re.search(rb'<c:numCache>.*?</c:numCache>', section, re.DOTALL)
        if not cache:
            raise ValueError("Internal AI chart cache missing")
        changed = re.sub(rb'<c:pt\b[^>]*>.*?</c:pt>', b'', cache.group(), flags=re.DOTALL)
        changed = re.sub(rb'(<c:ptCount val=")\d+("/>)', rb'\g<1>0\2', changed)
        return section[:cache.start()] + changed + section[cache.end():]
    return replace_section(xml, b'val', blank)


def patch_workbook(blob: bytes, categories: list[str], columns: dict[str, list[int]], ai_auxiliary=False):
    source = zipfile.ZipFile(io.BytesIO(blob))
    parts = {name: source.read(name) for name in source.namelist()}
    sheet = parts["xl/worksheets/sheet1.xml"]
    mapping = {shared_index(sheet, f"A{row}"): label for row, label in zip((2, 3, 4), categories)}
    parts["xl/sharedStrings.xml"] = patch_shared_strings(parts["xl/sharedStrings.xml"], mapping)
    for column, values in columns.items():
        for row, value in zip((2, 3, 4), values):
            sheet = patch_cell(sheet, f"{column}{row}", value)
    if ai_auxiliary:
        for column in ("D", "B"):
            for row in ((2, 3, 4) if column == "D" else (7, 8, 9)):
                sheet = patch_cell(sheet, f"{column}{row}", None)
        for row in (7, 8, 9):
            sheet = patch_cell(sheet, f"E{row}", None)
        parts["xl/charts/chart1.xml"] = blank_internal_ai_chart(parts["xl/charts/chart1.xml"])
    parts["xl/worksheets/sheet1.xml"] = sheet
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as target:
        for info in source.infolist():
            target.writestr(copy.copy(info), parts[info.filename])
    source.close()
    return output.getvalue()


def resolve_chart(archive, slide: int, chart_id: int):
    """Find a chart's parts from the slide object, so part numbering can change."""
    slide_xml = archive.read(f"ppt/slides/slide{slide}.xml")
    frames = [match.group() for match in re.finditer(rb"<p:graphicFrame\b[^>]*>.*?</p:graphicFrame>", slide_xml, re.DOTALL)
              if re.search(rb'<p:cNvPr\b[^>]*\bid="' + str(chart_id).encode() + rb'"', match.group())]
    relation = re.search(rb'<c:chart\b[^>]*\br:id="([^"]+)"', frames[0]) if len(frames) == 1 else None
    if not relation:
        raise ValueError("Native chart missing or ambiguous")
    def target(rels_part, rel_id=None, kind=None):
        for item in re.findall(rb"<Relationship\b[^>]*/>", archive.read(rels_part)):
            found_id = re.search(rb'\bId="([^"]+)"', item).group(1)
            found_type = re.search(rb'\bType="([^"]+)"', item).group(1)
            if found_id == rel_id or (kind and found_type.endswith(kind)):
                return re.search(rb'\bTarget="([^"]+)"', item).group(1).decode()
        raise ValueError("Chart relationship missing")
    chart = "ppt/charts/" + target(f"ppt/slides/_rels/slide{slide}.xml.rels", rel_id=relation.group(1)).rsplit("/", 1)[-1]
    workbook = "ppt/embeddings/" + target(f"ppt/charts/_rels/{chart.rsplit('/', 1)[-1]}.rels", kind=b"/package").rsplit("/", 1)[-1]
    return chart, workbook


def patch_pptx(source: Path, output: Path, charts: list[dict]):
    if source.resolve() == output.resolve():
        raise ValueError("Chart output must differ from source")
    with zipfile.ZipFile(source) as archive:
        parts = {}
        for chart in charts:
            parts[chart["part"]] = patch_chart(archive.read(chart["part"]), chart["categories"], chart["series"])
            parts[chart["workbook"]] = patch_workbook(archive.read(chart["workbook"]), chart["categories"],
                                                      chart["columns"], ai_auxiliary=chart["blankAuxiliary"])
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".partial", delete=False) as temp:
            path = Path(temp.name)
        try:
            with zipfile.ZipFile(path, "w") as target:
                target.comment = archive.comment
                for info in archive.infolist():
                    target.writestr(copy.copy(info), parts.get(info.filename, archive.read(info.filename)))
            with zipfile.ZipFile(path) as check:
                if check.testzip() is not None:
                    raise ValueError("Market chart output ZIP damaged")
            os.replace(path, output)
        finally:
            path.unlink(missing_ok=True)
