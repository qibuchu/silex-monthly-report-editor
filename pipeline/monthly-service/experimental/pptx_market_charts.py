"""Update the preserved market charts and their embedded editable workbooks."""

import copy
import html
import io
import math
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


NUMBER = re.compile(rb"^[+-]?[\d,]+(?:\.\d+)?%?$")


def drop_static_labels(series: bytes):
    """Typed-over numbers on data labels would keep last month's value."""
    def fix(match):
        label = match.group()
        rich = re.search(rb"<c:tx><c:rich>.*?</c:rich></c:tx>", label, re.DOTALL)
        if not rich:
            return label
        text = b"".join(re.findall(rb"<a:t>(.*?)</a:t>", rich.group(), re.DOTALL)).strip()
        return label[:rich.start()] + label[rich.end():] if NUMBER.match(text) else label
    return re.sub(rb"<c:dLbl>.*?</c:dLbl>", fix, series, flags=re.DOTALL)


def fit_axis(xml: bytes, series: list[list[int]]):
    """Raise a fixed axis maximum that the new values would exceed."""
    axes = list(re.finditer(rb"<c:valAx>.*?</c:valAx>", xml, re.DOTALL))
    if len(axes) != 1 or not series:
        return xml
    axis = axes[0].group()
    fixed = re.search(rb'(<c:max val=")([^"]+)(")', axis)
    if not fixed:
        return xml
    grouping = re.search(rb'<c:grouping val="(\w+)"', xml)
    if grouping and grouping.group(1) == b"percentStacked":
        return xml
    stacked = grouping is not None and grouping.group(1) == b"stacked"
    columns = list(zip(*series))
    needed = max(sum(column) if stacked else max(column) for column in columns)
    if float(fixed.group(2)) >= needed:
        return xml
    unit = re.search(rb'<c:majorUnit val="([^"]+)"', axis)
    step = float(unit.group(1)) if unit else 10 ** math.floor(math.log10(needed)) / 2
    top = math.ceil(needed * 1.05 / step) * step
    value = (str(int(top)) if top == int(top) else str(top)).encode()
    axis = axis[:fixed.start()] + fixed.group(1) + value + fixed.group(3) + axis[fixed.end():]
    return xml[:axes[0].start()] + axis + xml[axes[0].end():]


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
        data = drop_static_labels(data)
        xml = xml[:match.start()] + data + xml[match.end():]
    return fit_axis(xml, series)


SLOT_TITLE = "图表标题待补"


def empty_caches(xml: bytes):
    def clear(cache):
        changed = re.sub(rb"<c:pt\b[^>]*>.*?</c:pt>", b"", cache.group(), flags=re.DOTALL)
        return re.sub(rb'(<c:ptCount val=")\d+("/>)', rb"\g<1>0\2", changed)
    return re.sub(rb"<c:(?:num|str|multiLvlStr)Cache>.*?</c:(?:num|str|multiLvlStr)Cache>", clear, xml, flags=re.DOTALL)


def rename_sheets(xml: bytes, names: dict):
    for old, new in names.items():
        for quoted in (b"'" + old.replace(b"'", b"''") + b"'!", old + b"!"):
            xml = xml.replace(quoted, new + b"!")
    return xml


def blank_chart_xml(xml: bytes, names: dict):
    """Keep the chart and its styling, but none of last month's data or wording."""
    title = re.search(rb"<c:title>.*?</c:title>", xml, re.DOTALL)
    if title:
        texts = list(re.finditer(rb"(<a:t>)(.*?)(</a:t>)", title.group(), re.DOTALL))
        changed = title.group()
        for index, text in reversed(list(enumerate(texts))):
            value = SLOT_TITLE.encode("utf-8") if index == 0 else b""
            changed = changed[:text.start()] + text.group(1) + value + text.group(3) + changed[text.end():]
        xml = xml[:title.start()] + changed + xml[title.end():]
    matches = list(re.finditer(rb"<c:ser>.*?</c:ser>", xml, re.DOTALL))
    for index, match in reversed(list(enumerate(matches))):
        data = match.group()
        name = re.search(rb"<c:tx>.*?</c:tx>", data, re.DOTALL)
        if name:
            label = f"系列{index + 1}".encode("utf-8")
            updated = re.sub(rb"(<c:v>).*?(</c:v>)", lambda part: part.group(1) + label + part.group(2), name.group(), count=1, flags=re.DOTALL)
            data = data[:name.start()] + updated + data[name.end():]
        data = re.sub(rb"<c:dLbl>.*?</c:dLbl>", b"", data, flags=re.DOTALL)
        # The series name cache was just set above; only categories and values are cleared.
        data = re.sub(rb"<c:(cat|val|xVal|yVal)>.*?</c:\1>", lambda part: empty_caches(part.group()), data, flags=re.DOTALL)
        xml = xml[:match.start()] + data + xml[match.end():]
    return rename_sheets(xml, names)


def series_name_cells(xml: bytes):
    cells = []
    for index, match in enumerate(re.finditer(rb"<c:ser>.*?</c:ser>", xml, re.DOTALL)):
        name = re.search(rb"<c:tx>.*?<c:f>(.*?)</c:f>", match.group(), re.DOTALL)
        if name:
            reference = html.unescape(name.group(1).decode("utf-8"))
            sheet, cell = reference.rsplit("!", 1)
            cells.append((sheet.strip("'").replace("''", "'"), cell.replace("$", ""), f"系列{index + 1}"))
    return cells


def blank_workbook(blob: bytes, chart_xml: bytes):
    """Clear the embedded workbook so Edit Data starts from an empty sheet."""
    source = zipfile.ZipFile(io.BytesIO(blob))
    parts = {name: source.read(name) for name in source.namelist()}
    workbook = parts["xl/workbook.xml"]
    sheets = re.findall(rb'<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]+)"', workbook)
    names = {html.unescape(old.decode("utf-8")).encode("utf-8"): ("数据" if len(sheets) == 1 else f"数据{index + 1}").encode("utf-8")
             for index, (old, _) in enumerate(sheets)}
    for old, new in names.items():
        workbook = workbook.replace(b'name="' + html.escape(old.decode("utf-8")).encode("utf-8") + b'"', b'name="' + new + b'"', 1)
    workbook = re.sub(rb"<externalReferences>.*?</externalReferences>", b"", workbook, flags=re.DOTALL)
    parts["xl/workbook.xml"] = workbook
    rels = parts["xl/_rels/workbook.xml.rels"]
    targets = {rid: target for rid, target in re.findall(rb'<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"', rels)}
    for name in [name for name in parts if name.startswith("xl/externalLinks/") or name == "xl/calcChain.xml"]:
        del parts[name]
    parts["xl/_rels/workbook.xml.rels"] = re.sub(rb'<Relationship\b[^>]*\bTarget="(?:externalLinks/[^"]*|calcChain\.xml)"[^>]*/>', b"", rels)
    parts["[Content_Types].xml"] = re.sub(rb'<Override\b[^>]*\bPartName="/xl/(?:externalLinks/[^"]*|calcChain\.xml)"[^>]*/>', b"", parts["[Content_Types].xml"])
    paths = {}
    for (old, rid), new in zip(sheets, names.values()):
        paths[new] = "xl/" + targets[rid].decode("utf-8").lstrip("/").removeprefix("xl/")
    strings = []
    for sheet in paths.values():
        parts[sheet] = re.sub(rb'<c\b([^>]*?)(?:/>|>.*?</c>)', lambda cell: b"<c" + re.sub(rb'\s+t="[^"]*"', b"", cell.group(1)) + b"/>",
                              parts[sheet], flags=re.DOTALL)
    renamed = {old.decode("utf-8"): new.decode("utf-8") for old, new in names.items()}
    for sheet, cell, label in series_name_cells(chart_xml):
        path = paths.get(renamed.get(sheet, sheet).encode("utf-8"))
        if not path:
            continue
        pattern = rb'<c\b(?=[^>]*\br="' + cell.encode() + rb'")([^>]*?)/>'
        if re.search(pattern, parts[path]):
            parts[path] = re.sub(pattern, lambda found: b"<c" + found.group(1) + b' t="s"><v>' + str(len(strings)).encode() + b"</v></c>", parts[path], count=1)
            strings.append(label)
    if "xl/sharedStrings.xml" in parts:
        items = "".join(f"<si><t>{html.escape(value)}</t></si>" for value in strings).encode("utf-8")
        parts["xl/sharedStrings.xml"] = (b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="'
                                         + str(len(strings)).encode() + b'" uniqueCount="' + str(len(strings)).encode() + b'">' + items + b"</sst>")
    for name in [name for name in parts if re.fullmatch(r"xl/charts/chart\d+\.xml", name)]:
        parts[name] = blank_chart_xml(parts[name], names)
    if "docProps/app.xml" in parts:
        for old, new in names.items():
            parts["docProps/app.xml"] = parts["docProps/app.xml"].replace(b">" + html.escape(old.decode("utf-8")).encode("utf-8") + b"<", b">" + new + b"<")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            if info.filename in parts:
                target.writestr(copy.copy(info), parts[info.filename])
    source.close()
    return output.getvalue(), names


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
    import posixpath
    chart = posixpath.normpath(posixpath.join("ppt/slides", target(f"ppt/slides/_rels/slide{slide}.xml.rels", rel_id=relation.group(1))))
    chart_rels = posixpath.join(posixpath.dirname(chart), "_rels", posixpath.basename(chart) + ".rels")
    workbook = None
    if chart_rels in archive.namelist():
        try:
            workbook = posixpath.normpath(posixpath.join(posixpath.dirname(chart), target(chart_rels, kind=b"/package")))
        except ValueError:
            pass
    return chart, workbook


def patch_pptx(source: Path, output: Path, charts: list[dict], blanks: list[dict] = ()):
    if source.resolve() == output.resolve():
        raise ValueError("Chart output must differ from source")
    with zipfile.ZipFile(source) as archive:
        parts = {}
        for blank in blanks:
            chart_xml = archive.read(blank["part"])
            if blank["workbook"]:
                parts[blank["workbook"]], names = blank_workbook(archive.read(blank["workbook"]), chart_xml)
            else:
                names = {}
            parts[blank["part"]] = blank_chart_xml(chart_xml, names)
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
