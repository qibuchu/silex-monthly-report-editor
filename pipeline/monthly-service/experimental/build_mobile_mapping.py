"""Build the reviewed object map for the 20-slide June mobile source deck."""

import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

P = "http://schemas.openxmlformats.org/presentationml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
C = "http://schemas.openxmlformats.org/drawingml/2006/chart"
N = {"p": P, "a": A, "c": C}
EXPECTED = "481fd10fd608e23d2d14373eb266e86017d4fa4d7c85691edb129f8434f43f64"


def main(source, output):
    source = Path(source)
    if hashlib.sha256(source.read_bytes()).hexdigest() != EXPECTED:
        raise ValueError("This map is for the reviewed 6月手游榜单.pptx only")
    ops = []
    notes = {}
    with zipfile.ZipFile(source) as archive:
        for slide in range(1, 21):
            root = ET.fromstring(archive.read(f"ppt/slides/slide{slide}.xml"))
            for shape in root.findall(".//p:sp", N):
                marker = shape.find("p:nvSpPr/p:cNvPr", N)
                if marker is None:
                    continue
                sid = int(marker.get("id"))
                value = "".join(node.text or "" for node in shape.findall(".//a:t", N)).strip()
                if not value:
                    continue
                if slide == 1 and sid == 269:
                    ops.append({"op": "replaceFragment", "slide": slide, "shapeId": sid,
                                "find": r"\d{4} M\d{1,2}", "value": "{year} M{monthNumber}"})
                elif slide in (1, 13) and sid in (270, 122):
                    ops.append({"op": "replaceFragment", "slide": slide, "shapeId": sid,
                                "find": r"\d{4}年\d{1,2}月", "value": "{year}年{monthNumber}月"})
                elif slide in (1, 13) and sid in (275, 126):
                    ops.append({"op": "replaceFragment", "slide": slide, "shapeId": sid,
                                "find": r"\d{4}\.\d{2}", "value": "{publicationDate}"})
                elif value in ("RESEARCH TEAM", "研究团队 · 内部研究", "DATE / VER"):
                    continue
                elif value.startswith(("*数据来源", "数据来源", "收入量（", "营收环比变动", "MAU（")):
                    continue
                elif re.fullmatch(r"(?:国区|海外)营收趋势|(?:6月|26年H1 )?Top\d+(?:-\d+)?重点变动|上线 AI 预审机|增收显著|收入锐减|活动玩法|联动内容", value):
                    if "6月" in value:
                        ops.append({"op": "replaceFragment", "slide": slide, "shapeId": sid,
                                    "find": "6月", "value": "{monthNumber}月"})
                else:
                    ops.append({"op": "clearText", "slide": slide, "shapeId": sid})
            for frame in root.findall(".//p:graphicFrame", N):
                marker = frame.find("p:nvGraphicFramePr/p:cNvPr", N)
                if marker is None:
                    continue
                tid = int(marker.get("id"))
                if frame.find(".//a:tbl", N) is None:
                    continue
                if (slide, tid) == (4, 340):
                    ops.append({"op": "fillTable", "slide": slide, "tableId": tid,
                                "source": "mobile.cn", "from": 0, "to": 20})
                elif (slide, tid) == (15, 144):
                    ops.append({"op": "fillTable", "slide": slide, "tableId": tid,
                                "source": "mobile.global", "from": 0, "to": 20})
                else:
                    ops.append({"op": "clearTable", "slide": slide, "tableId": tid, "slot": True})
            for pic in root.findall(".//p:pic", N):
                marker = pic.find("p:nvPicPr/p:cNvPr", N)
                if marker is not None:
                    ops.append({"op": "imageSlot", "slide": slide, "pictureId": int(marker.get("id"))})
            for frame in root.findall(".//p:graphicFrame", N):
                marker = frame.find("p:nvGraphicFramePr/p:cNvPr", N)
                if marker is not None and frame.find(".//c:chart", N) is not None:
                    ops.append({"op": "chartSlot", "slide": slide, "chartId": int(marker.get("id"))})
            if slide not in (1, 4, 13, 15):
                notes[str(slide)] = "原稿含该月案例、趋势或H1内容；接口未提供完整对应字段，已清空为人工编辑空槽。"
    mapping = {"format": "native-pptx-mapping-v1", "dataSource": "mobile-monthly",
               "sourceMonth": "2026-06", "seedSha256": EXPECTED, "pageNotes": notes, "ops": ops}
    Path(output).write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(ops)} rules -> {output}")


if __name__ == "__main__":
    main(*sys.argv[1:])
