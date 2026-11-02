import base64
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from chart_images import ads_trend, crosses, label_box, nice_axis, overlaps
from native_mapping import compile_mapping
from native_sources_minigame import ads_trend_image
from native_writeback import extract
from pptx_preserve_patch import picture_to_image
from test_native_minigame import export
from test_native_mapping import P, A, R, pptx

PIC = (f'<p:pic {R}><p:nvPicPr><p:cNvPr id="121" name="Picture 70" descr="overview.png"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
       '<p:blipFill><a:blip r:embed="rId3"/><a:srcRect t="15116" r="3226"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
       '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="7529896" cy="3828749"/></a:xfrm></p:spPr></p:pic>')
RELS = ('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"/>'
        '</Relationships>')


def trend(month, games=(18894, 19698, 20097)):
    year, number = map(int, month.split("-"))
    keys = [f"{year}-{number - offset:02d}" for offset in (2, 1, 0)]
    return [{"month": key, "complete": True, "douyin_info_flow_wan": 237.5, "douyin_talent_wan": 416.5,
             "douyin_split_sum_wan": 653.9, "wechat_info_flow_wan": 265, "wechat_talent_wan": 0,
             "wechat_split_sum_wan": 265, "douyin_games": value, "wechat_games": 13914} for key, value in zip(keys, games)]


class ChartTests(unittest.TestCase):
    def test_axis_steps_match_the_hand_made_chart(self):
        self.assertEqual(nice_axis(827.6, 9, 1.08), (900, 100))
        self.assertEqual(nice_axis(22702, 7, 1.2), (28000, 4000))

    def test_svg_carries_every_value_and_no_label_overlaps(self):
        months = [{"label": f"{m}月", "douyin": (237.5, 416.5, 653.9), "wechat": (265, 0, 265),
                   "douyinGames": g, "wechatGames": 13914} for m, g in ((7, 18894), (8, 19698), (9, 20097))]
        svg, png = ads_trend(months, 790.6, 402)
        root = ElementTree.fromstring(svg)
        texts = [node for node in root.iter("{http://www.w3.org/2000/svg}text")]
        values = [node.text for node in texts]
        for value in ("653.9", "416.5", "237.5", "265.0", "20,097", "13,914", "9月", "微信达人广告（极少）"):
            self.assertIn(value, values)
        boxes = [label_box(float(node.get("x")), float(node.get("y")), node.text, float(node.get("font-size")), node.get("font-weight") == "bold")
                 for node in texts if node.text[0].isdigit() and not node.get("text-anchor") in ("start", "end")]
        boxes = [box for box in boxes if box[1] > 0.147 * 402 - 20 and box[3] < 0.886 * 402]  # data labels inside the plot
        self.assertFalse([pair for i, a in enumerate(boxes) for b in boxes[i + 1:] if overlaps(a, b) for pair in [(a, b)]])
        self.assertTrue(png.startswith(b"\x89PNG"))

    def test_line_crossing_detection(self):
        self.assertTrue(crosses((10, 10, 30, 20), [(0, 15), (40, 15)]))
        self.assertFalse(crosses((10, 10, 30, 20), [(0, 40), (40, 40)]))

    def test_incomplete_month_is_left_empty_and_reported(self):
        data = export("2026-08", "2026-07")
        data["charts"] = {"ads_trend": trend("2026-08")}
        data["charts"]["ads_trend"][0]["complete"] = False
        svg, _, issues = ads_trend_image(data, {}, 790, 402)
        self.assertEqual(issues, [{"field": "charts.ads_trend.2026-06", "reason": "month_missing_or_incomplete"}])
        self.assertIn("6月", svg)
        self.assertEqual(svg.count("18,894"), 0)  # June's games are not drawn
        self.assertEqual(svg.count("19,698"), 1)

    def test_months_outside_the_window_are_ignored(self):
        data = export("2026-09", "2026-08")
        data["charts"] = {"ads_trend": trend("2026-08")}  # June-August: wrong window for September
        _, _, issues = ads_trend_image(data, {}, 790, 402)
        self.assertEqual([issue["field"] for issue in issues], ["charts.ads_trend.2026-09"])


class PictureTests(unittest.TestCase):
    def test_picture_gets_svg_with_png_fallback_and_loses_old_crop(self):
        slide = f'<p:sld {P} {A} {R}><p:cSld><p:spTree>{PIC}</p:spTree></p:cSld></p:sld>'.encode()
        xml, rels = picture_to_image(slide, RELS.encode(), 121, "c.png", "c.svg")
        ElementTree.fromstring(xml), ElementTree.fromstring(rels)
        self.assertNotIn(b"srcRect", xml)
        self.assertIn(b'descr="\xe6\x95\xb0\xe6\x8d\xae\xe7\x94\x9f\xe6\x88\x90\xe5\x9b\xbe\xe8\xa1\xa8"', xml)
        self.assertIn(b'<a:blip r:embed="rId4">', xml)
        self.assertIn(b'asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rId5"', xml)
        self.assertNotIn(b"image2.png", rels)  # the template image is no longer referenced

    def test_generation_embeds_chart_and_read_back_returns_it(self):
        with tempfile.TemporaryDirectory() as folder:
            template, output = Path(folder) / "t.pptx", Path(folder) / "o.pptx"
            pptx(template, {2: f'<p:sld {P} {A} {R}><p:cSld><p:spTree>{PIC}</p:spTree></p:cSld></p:sld>'})
            with zipfile.ZipFile(template, "a") as archive:
                archive.writestr("ppt/slides/_rels/slide2.xml.rels", RELS)
                archive.writestr("ppt/media/image2.png", b"old")
                archive.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
            data = export("2026-09", "2026-08")
            data["charts"] = {"ads_trend": trend("2026-09")}
            mapping = {"format": "native-pptx-mapping-v1", "dataSource": "minigame-monthly",
                       "ops": [{"op": "imageChart", "slide": 2, "pictureId": 121, "source": "minigame.adsTrend"}]}
            compiled = compile_mapping(mapping, template, data, {})
            spec = Path(folder) / "spec.json"
            spec.write_text(json.dumps({"replacements": compiled["replacements"]}), encoding="utf-8")
            import subprocess, sys
            here = Path(__file__).resolve().parent
            subprocess.run([sys.executable, "-B", str(here / "pptx_preserve_patch.py"), str(template), str(spec), str(output)], check=True, capture_output=True)
            with zipfile.ZipFile(output) as archive:
                self.assertIn(b'Extension="svg"', archive.read("[Content_Types].xml"))
                svg = archive.read("ppt/media/monthly-chart-s2-p121.svg")
            generated = extract(output)["slides"]["2"]["generated"]["121"]
            self.assertEqual(base64.b64decode(generated.split(",", 1)[1]), svg)
            self.assertIn(b"20,097", svg)


if __name__ == "__main__":
    unittest.main()
