"""Clone existing PPTX slides as editable continuation pages without re-rendering them."""

import argparse
import copy
import json
import os
import re
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree


SLIDE_REL = b"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
SLIDE_CONTENT = b"application/vnd.openxmlformats-officedocument.presentationml.slide+xml"


def clone_parts(parts: dict[str, bytes], requests: list[dict]):
    if not requests or len(requests) > 20:
        raise ValueError("Provide 1 to 20 continuation slides")
    presentation = parts["ppt/presentation.xml"]
    relationships = parts["ppt/_rels/presentation.xml.rels"]
    content_types = parts["[Content_Types].xml"]
    rel_root = ElementTree.fromstring(relationships)
    slide_rels = {}
    used_rel_ids = set()
    for rel in rel_root:
        rid = rel.get("Id")
        used_rel_ids.add(rid)
        if rel.get("Type", "").endswith("/slide"):
            slide_rels[rel.get("Target")] = rid
    used_slide_ids = [int(value) for value in re.findall(rb'<p:sldId\b[^>]*\bid="(\d+)"', presentation)]
    if not used_slide_ids:
        raise ValueError("Presentation has no slide list")
    next_slide_id = max(used_slide_ids) + 1
    next_rel_number = max(int(rid[3:]) for rid in used_rel_ids if re.fullmatch(r"rId\d+", rid)) + 1
    if len({item["newSlide"] for item in requests}) != len(requests):
        raise ValueError("Continuation slide numbers must be unique")
    for item in requests:
        original = int(item["sourceSlide"])
        new = int(item["newSlide"])
        source_path = f"ppt/slides/slide{original}.xml"
        new_path = f"ppt/slides/slide{new}.xml"
        if source_path not in parts or new_path in parts or new < 1:
            raise ValueError("Source slide missing or continuation part already exists")
        source_rid = slide_rels.get(f"slides/slide{original}.xml")
        if not source_rid:
            raise ValueError("Source slide is not in presentation order")
        source_entry = re.search(rb'<p:sldId\b[^>]*\br:id="' + source_rid.encode() + rb'"[^>]*/>', presentation)
        if not source_entry:
            raise ValueError("Source slide ID not found")
        new_rid = f"rId{next_rel_number}"
        next_rel_number += 1
        entry = f'<p:sldId id="{next_slide_id}" r:id="{new_rid}"/>'.encode()
        next_slide_id += 1
        presentation = presentation[:source_entry.end()] + entry + presentation[source_entry.end():]
        rel = b'<Relationship Id="' + new_rid.encode() + b'" Type="' + SLIDE_REL + b'" Target="slides/slide' + str(new).encode() + b'.xml"/>'
        relationships = relationships.replace(b'</Relationships>', rel + b'</Relationships>', 1)
        override = b'<Override PartName="/ppt/slides/slide' + str(new).encode() + b'.xml" ContentType="' + SLIDE_CONTENT + b'"/>'
        content_types = content_types.replace(b'</Types>', override + b'</Types>', 1)
        parts[new_path] = parts[source_path]
        original_rels = f"ppt/slides/_rels/slide{original}.xml.rels"
        if original_rels in parts:
            cloned_rels = re.sub(rb'<Relationship\b[^>]*\bType="[^\"]*/notesSlide"[^>]*/>', b'', parts[original_rels])
            parts[f"ppt/slides/_rels/slide{new}.xml.rels"] = cloned_rels
    parts["ppt/presentation.xml"] = presentation
    parts["ppt/_rels/presentation.xml.rels"] = relationships
    parts["[Content_Types].xml"] = content_types
    for name in ("ppt/presentation.xml", "ppt/_rels/presentation.xml.rels", "[Content_Types].xml"):
        ElementTree.fromstring(parts[name])
    return parts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("plan", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        raise ValueError("Output must differ from source")
    requests = json.loads(args.plan.read_text(encoding="utf-8"))
    with zipfile.ZipFile(args.source) as before:
        parts = {name: before.read(name) for name in before.namelist()}
        clone_parts(parts, requests)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=args.output.parent, suffix=".partial", delete=False) as temp:
            temp_path = Path(temp.name)
        try:
            with zipfile.ZipFile(temp_path, "w") as after:
                after.comment = before.comment
                for info in before.infolist():
                    after.writestr(copy.copy(info), parts.pop(info.filename))
                for name, data in parts.items():
                    after.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
            with zipfile.ZipFile(temp_path) as check:
                if check.testzip() is not None:
                    raise ValueError("Continuation PPTX integrity check failed")
            os.replace(temp_path, args.output)
        finally:
            temp_path.unlink(missing_ok=True)
    print(json.dumps({"output": str(args.output), "clonedSlides": len(requests)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
