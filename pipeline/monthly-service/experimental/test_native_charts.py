import base64
import io
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from native_charts import ads_trend_chart, category_chart, preview_svg, workbook
from native_mapping import compile_mapping
from native_sources_minigame import category_top_native
from native_writeback import extract
from test_chart_images import PIC, RELS, trend
from test_native_mapping import A, P, R, pptx
from test_native_minigame import export

C = "{http://schemas.openxmlformats.org/drawingml/2006/chart}"
HERE = Path(__file__).resolve().parent


def months():
    return [{"label": "7月", "douyin": (194.2, 615.9, 810.1), "wechat": (278.8, 0, 278.8), "douyinGames": 18894, "wechatGames": 11540},
            {"label": "8月", "douyin": None, "wechat": None, "douyinGames": None, "wechatGames": None},
            {"label": "9月", "douyin": (237.5, 416.5, 653.9), "wechat": (265, 0, 265), "douyinGames": 20097, "wechatGames": 13914}]


class WorkbookTests(unittest.TestCase):
    def test_workbook_holds_strings_numbers_and_skips_blanks(self):
        book = zipfile.ZipFile(io.BytesIO(workbook([["名", "值"], ["a&b", 1.5], [None, 2]])))
        sheet = book.read("xl/worksheets/sheet1.xml").decode()
        self.assertIn('<c r="A2" t="inlineStr"><is><t>a&amp;b</t></is></c><c r="B2"><v>1.5</v></c>', sheet)
        self.assertNotIn('r="A3"', sheet)
        for name in book.namelist():
            ElementTree.fromstring(book.read(name))
        self.assertEqual(workbook([["a", 1]]), workbook([["a", 1]]))


class TrendChartTests(unittest.TestCase):
    def setUp(self):
        chart, self.book = ads_trend_chart(months())
        self.root = ElementTree.fromstring(chart)

    def test_two_level_categories_and_series_layout(self):
        names = ["".join(t.text for t in s.find(C + "tx").iter(C + "v")) for s in self.root.iter(C + "ser")]
        self.assertEqual(names, ["抖音信息流广告", "抖音达人广告", "微信信息流广告", "微信达人广告", "合计", "抖音游戏数", "微信游戏数"])
        levels = self.root.find(f".//{C}multiLvlStrCache").findall(C + "lvl")
        self.assertEqual([p.findtext(C + "v") for p in levels[0]], ["抖音", "微信"] * 3)
        self.assertEqual([(p.get("idx"), p.findtext(C + "v")) for p in levels[1]], [("0", "7月"), ("2", "8月"), ("4", "9月")])
        self.assertEqual(self.root.find(f".//{C}dispBlanksAs").get("val"), "span")
        self.assertEqual(self.root.find(f".//{C}legendEntry/{C}delete").get("val"), "1")  # the total helper is not in the legend

    def test_missing_month_has_no_points_and_tiny_segments_have_no_label(self):
        douyin = next(self.root.iter(C + "ser"))
        self.assertEqual(sorted(int(p.get("idx")) for p in douyin.find(C + "val").iter(C + "pt")), [0, 4])
        wechat_talent = list(self.root.iter(C + "ser"))[3]
        self.assertEqual({d.find(C + "idx").get("val") for d in wechat_talent.iter(C + "dLbl") if d.find(C + "delete") is not None}, {"1", "5"})

    def test_point_labels_keep_number_format_and_avoid_the_total(self):
        games = list(self.root.iter(C + "ser"))[5]
        labels = {d.find(C + "idx").get("val"): d for d in games.iter(C + "dLbl")}
        self.assertEqual(labels["4"].find(C + "numFmt").get("formatCode"), "#,##0")
        self.assertEqual(labels["4"].find(C + "dLblPos").get("val"), "b")  # 20,097 would sit on 653.9

    def test_workbook_matches_chart_formulas(self):
        sheet = zipfile.ZipFile(io.BytesIO(self.book)).read("xl/worksheets/sheet1.xml").decode()
        self.assertIn('<c r="A6" t="inlineStr"><is><t>9月</t></is></c>', sheet)
        self.assertIn('<c r="C6"><v>237.5</v></c>', sheet)
        self.assertEqual(self.root.find(f".//{C}multiLvlStrRef/{C}f").text, "Sheet1!$A$2:$B$7")


class CategoryChartTests(unittest.TestCase):
    def test_top_genres_with_change_labels_from_cells(self):
        data = export("2026-09", "2026-08")
        data["iaa"] = {"top50": {"currentDate": "2026-09-30", "previousDate": "2026-08-31", "rows": [
            {"genre": "A", "current_count": 2, "delta": 0}, {"genre": "B", "current_count": 11, "delta": 3},
            {"genre": "Z", "current_count": 0, "delta": -1}]}}
        chart, book, issues = category_top_native(data, {})
        root = ElementTree.fromstring(chart)
        self.assertEqual(issues, [])
        self.assertEqual([p.findtext(C + "v") for p in root.find(f".//{C}cat").iter(C + "pt")], ["B", "A"])
        ranges = root.findall(".//{http://schemas.microsoft.com/office/drawing/2012/chart}datalabelsRange")
        self.assertEqual(len(ranges), 2)  # PowerPoint reads one, Excel the other
        self.assertEqual([p.findtext(C + "v") for p in ranges[0].iter(C + "pt")], ["11 (+3)", "2 (-)"])
        self.assertEqual(len([f for f in root.iter("{http://schemas.openxmlformats.org/drawingml/2006/main}fld") if f.get("type") == "CELLRANGE"]), 2)
        self.assertIn("9月TOP50品类数量", chart)
        self.assertIn("11 (+3)", preview_svg(chart.encode(), 600, 400))

    def test_wrong_window_leaves_chart_empty(self):
        data = export("2026-09", "2026-08")
        data["iaa"] = {"top50": {"currentDate": "2026-08-31", "previousDate": "2026-07-31", "rows": [{"genre": "B", "current_count": 1, "delta": 0}]}}
        chart, _, issues = category_top_native(data, {})
        self.assertEqual(issues[0]["reason"], "window_mismatch")
        self.assertIsNone(ElementTree.fromstring(chart).find(f".//{C}cat/{C}strRef/{C}strCache/{C}pt"))


class PackageTests(unittest.TestCase):
    def test_picture_becomes_native_chart_and_read_back_has_a_preview(self):
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
                       "ops": [{"op": "nativeChart", "slide": 2, "pictureId": 121, "source": "minigame.adsTrend", "name": "趋势"}]}
            compiled = compile_mapping(mapping, template, data, {})
            spec = Path(folder) / "spec.json"
            spec.write_text(json.dumps({"replacements": compiled["replacements"]}), encoding="utf-8")
            subprocess.run([sys.executable, "-B", str(HERE / "pptx_preserve_patch.py"), str(template), str(spec), str(output)], check=True, capture_output=True)
            with zipfile.ZipFile(output) as archive:
                slide = archive.read("ppt/slides/slide2.xml").decode()
                types = archive.read("[Content_Types].xml").decode()
                rels = archive.read("ppt/charts/_rels/chart1.xml.rels").decode()
                self.assertNotIn("<p:pic>", slide)
                self.assertIn('<p:cNvPr id="121" name="趋势" descr="数据生成图表"/>', slide)
                self.assertIn('<a:off x="0" y="0"/><a:ext cx="7529896" cy="3828749"/>', slide)
                self.assertIn('PartName="/ppt/charts/chart1.xml"', types)
                self.assertIn('Extension="xlsx"', types)
                self.assertIn("../embeddings/Microsoft_Excel_Worksheet1.xlsx", rels)
                self.assertNotIn("image2.png", archive.read("ppt/slides/_rels/slide2.xml.rels").decode())
            slide = extract(output)["slides"]["2"]
            self.assertIn("121", slide["charts"])
            # The draft itself used as the next template: the existing chart is refilled in place.
            data["charts"]["ads_trend"][2]["douyin_games"] = 30000
            again = compile_mapping(mapping, output, data, {})
            self.assertEqual([item["kind"] for item in again["replacements"]], ["chartReplace"])
            self.assertEqual(again["replacements"][0]["part"], "ppt/charts/chart1.xml")
            self.assertIn("30000", again["replacements"][0]["chart"])
            preview = base64.b64decode(slide["generated"]["121"].split(",", 1)[1]).decode()
            self.assertIn("20,097", preview)


if __name__ == "__main__":
    unittest.main()
