"""Clear reviewed month-specific research content while preserving editable layout slots."""

import calendar
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from pptx_preserve_patch import table_values
from steam_release_to_spec import NS, shape_texts


TEXT_SLOTS = {
    1: [6],
    2: [19, 27, 38, 40, 42, 50],
    3: [4, 64, 10, 21, 33, 35, 37, 39, 41, 47, 66],
    6: [31, 32, 34, 39, 42, 14, 18, 3, 15, 24, 29, 35],
}
PICTURE_SLOTS = {
    2: [18, 26, 7, 41, 43, 48],
    3: [14, 16, 19, 23],
    6: [16, 10, 5],
    7: [20, 55, 57, 16],
    8: [57, 17, 20, 30, 13],
}
CHART_SLOTS = {3: [24], 7: [12], 8: [15]}
INDIE_KEEP = {3, 4, 25, 26, 10, 11}


def make_spec(template: Path, month: str):
    year, number = map(int, month.split("-"))
    end_date = f"{year}.{number:02d}.{calendar.monthrange(year, number)[1]}"
    replacements, slots = [], []
    with zipfile.ZipFile(template) as archive:
        for slide in (1, 2, 3, 6, 7, 8):
            xml = archive.read(f"ppt/slides/slide{slide}.xml")
            texts = shape_texts(xml)
            selected = TEXT_SLOTS.get(slide, [])
            if slide in (7, 8):
                selected = [shape_id for shape_id, value in texts.items() if value and shape_id not in INDIE_KEEP]
            for shape_id in selected:
                if not texts.get(shape_id):
                    raise ValueError(f"Reviewed manual text slot {slide}:{shape_id} missing")
                replacements.append({"kind": "shapeReplace", "slide": slide, "shapeId": shape_id,
                                     "expectedText": texts[shape_id], "value": ""})
                slots.append({"slide": slide, "objectId": shape_id, "type": "text"})
            root = ElementTree.fromstring(xml)
            pictures = {int(marker.get("id")) for picture in root.findall(".//p:pic", NS)
                        if (marker := picture.find("p:nvPicPr/p:cNvPr", NS)) is not None}
            for picture_id in PICTURE_SLOTS.get(slide, []):
                if picture_id not in pictures:
                    raise ValueError(f"Reviewed image slot {slide}:{picture_id} missing")
                replacements.append({"kind": "pictureSlot", "slide": slide, "pictureId": picture_id})
                slots.append({"slide": slide, "objectId": picture_id, "type": "image"})
            frames = {int(marker.get("id")) for frame in root.findall(".//p:graphicFrame", NS)
                      if (marker := frame.find("p:nvGraphicFramePr/p:cNvPr", NS)) is not None}
            for chart_id in CHART_SLOTS.get(slide, []):
                if chart_id not in frames:
                    raise ValueError(f"Reviewed chart slot {slide}:{chart_id} missing")
                replacements.append({"kind": "chartSlot", "slide": slide, "chartId": chart_id})
                slots.append({"slide": slide, "objectId": chart_id, "type": "chart"})
        table = table_values(archive.read("ppt/slides/slide8.xml"), 9)
        for row_index, row in enumerate(table):
            for column_index, value in enumerate(row):
                if value:
                    replacements.append({"slide": 8, "tableId": 9, "row": row_index,
                                         "column": column_index, "expected": value, "value": ""})
        slots.append({"slide": 8, "objectId": 9, "type": "table"})
        for slide, shape_id, new_text in ((1, 4, f"Steam{number}月月报"),
                                          (6, 4, f"{number}月热门新游："),
                                          (7, 4, f"{number}月Steam亮眼独游"),
                                          (8, 4, f"{number}月Steam亮眼独游")):
            old = shape_texts(archive.read(f"ppt/slides/slide{slide}.xml"))[shape_id]
            replacements.append({"kind": "shapeReplace", "slide": slide, "shapeId": shape_id,
                                 "expectedText": old, "value": new_text})
        for slide, shape_id, old_fragment, new_fragment in ((1, 3, "2026 H1", month.replace("-", ".")),
                                                             (3, 60, "2026.07.31", end_date),
                                                             (6, 25, "2026.08.31", end_date),
                                                             (7, 25, "2026.08.31", end_date),
                                                             (8, 25, "2026.08.31", end_date)):
            old = shape_texts(archive.read(f"ppt/slides/slide{slide}.xml"))[shape_id]
            if old_fragment not in old:
                raise ValueError(f"Reviewed month text {slide}:{shape_id} changed")
            replacements.append({"kind": "shapeText", "slide": slide, "shapeId": shape_id,
                                 "expectedText": old, "oldFragment": old_fragment, "newFragment": new_fragment})
    return {"replacements": replacements, "slots": slots}
