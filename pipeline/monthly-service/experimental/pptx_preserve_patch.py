"""Proof of concept: replace selected native PPTX table cells without rebuilding slides."""

import argparse
import hashlib
import html
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree


def scoped_sub(data: bytes, pattern: bytes, index: int, replacement):
    matches = list(re.finditer(pattern, data, re.DOTALL))
    if index < 0 or index >= len(matches):
        raise ValueError(f"Object index {index} outside 0..{len(matches) - 1}")
    match = matches[index]
    return data[:match.start()] + replacement(match.group()) + data[match.end():]


def patch_cell(slide_xml: bytes, table_id: int, row: int, column: int, expected: str, value: str):
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
                if old != expected:
                    raise ValueError(f"Expected cell {expected!r}, found {old!r}")
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("spec", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        raise ValueError("Output must differ from source")
    replacements = json.loads(args.spec.read_text(encoding="utf-8"))
    if not isinstance(replacements, list) or not replacements:
        raise ValueError("Spec must be a nonempty array")
    with zipfile.ZipFile(args.source) as source:
        changed = {}
        for item in replacements:
            slide = int(item["slide"])
            name = f"ppt/slides/slide{slide}.xml"
            if name not in source.namelist():
                raise ValueError(f"Missing {name}")
            data = changed.get(name, source.read(name))
            changed[name] = patch_cell(data, int(item["tableId"]), int(item["row"]), int(item["column"]), str(item["expected"]), str(item["value"]))
            ElementTree.fromstring(changed[name])
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(args.output, "w") as output:
            output.comment = source.comment
            for info in source.infolist():
                output.writestr(info, changed.get(info.filename, source.read(info.filename)))
    with zipfile.ZipFile(args.source) as before, zipfile.ZipFile(args.output) as after:
        modified = [name for name in before.namelist() if hashlib.sha256(before.read(name)).digest() != hashlib.sha256(after.read(name)).digest()]
        assert modified == sorted(changed), modified
        assert after.testzip() is None
    print(json.dumps({"output": str(args.output), "modifiedEntries": modified, "replacements": len(replacements)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
