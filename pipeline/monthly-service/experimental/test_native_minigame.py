import tempfile
import unittest
from pathlib import Path

from native_mapping import compile_mapping
from native_sources_minigame import board_rows, contract, featured_rows, whole_percent
from pptx_preserve_patch import replace_shape_text, run_text, set_run_style
from test_native_mapping import pptx, slide


def export(month, previous, games=None):
    year, number = map(int, month.split("-"))
    ends = {"08": "31", "09": "30", "07": "31"}
    return {"month": month,
            "range": {"start": f"{month}-01", "end": f"{month}-{ends[month[-2:]]}",
                      "previous_start": f"{previous}-01", "previous_end": f"{previous}-{ends[previous[-2:]]}"},
            "coverage": {"calendar_complete": True, "datasets": []},
            "snapshot": {"id": 7, "revision": 2},
            "adx_kpi": {"month": month, "douyin_material_growth_pct": -20.9},
            "bestseller": games or [], "new_games": {"bestseller": []}}


def game(game_id, name, plan=100.4, delta=12.4, previous_plan=90):
    return {"game_id": game_id, "game_name": name, "publisher": "P", "genre": "SLG", "avg_plan": plan,
            "plan_delta_pct": delta, "previous_avg_plan": previous_plan}


def box(shape_id, x, y, text, colour="111827", width=40):
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="s"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{x * 9525}" y="{y * 9525}"/>'
            f'<a:ext cx="{width * 9525}" cy="{14 * 9525}"/></a:xfrm></p:spPr><p:txBody><a:p><a:pPr algn="ctr"/><a:r>'
            f'<a:rPr sz="800"><a:solidFill><a:srgbClr val="{colour}"/></a:solidFill></a:rPr><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp>')


class MinigameSourceTests(unittest.TestCase):
    def test_contract_checks_month_window_and_previous_export(self):
        self.assertEqual(contract(export("2026-09", "2026-08"), {"previous": export("2026-08", "2026-07")})["snapshotId"], "7@2")
        with self.assertRaises(ValueError):
            contract(export("2026-09", "2026-08"), {"previous": export("2026-09", "2026-08")})
        late = export("2026-09", "2026-08")
        late["coverage"]["calendar_complete"] = False
        with self.assertRaises(ValueError):
            contract(late, {})

    def test_board_change_comes_from_previous_export_positions(self):
        current = export("2026-09", "2026-08", [game(1, "A"), game(3, "C"), game(2, "B", delta=None, previous_plan=None)])
        previous = export("2026-08", "2026-07", [game(2, "B"), game(1, "A")])
        rows, issues = board_rows("bestseller")(current, {"previous": previous})
        self.assertEqual([row[4] for row in rows], ["+1", "新", "-2"])
        self.assertEqual(rows[0][5:], ["100", "+12%"])
        self.assertEqual(rows[2][6], "/")
        self.assertEqual(issues, [])

    def test_without_previous_export_change_is_blank_and_recorded(self):
        rows, issues = board_rows("bestseller")(export("2026-09", "2026-08", [game(1, "A")]), {})
        self.assertEqual(rows[0][4], "")
        self.assertEqual(issues[0]["reason"], "previous_month_export_missing")

    def test_percent_formats_match_template(self):
        self.assertEqual([whole_percent(v) for v in (-0.4, 291.2, 10576, -100, None)], ["0%", "+291%", "+1.1万%", "-100%", None])

    def test_featured_games_follow_featured_rank_and_flag_unverified_dates(self):
        data = export("2026-09", "2026-08")
        data["new_games"]["bestseller"] = [
            {"game_name": "B", "featured_rank": 2, "first_buying_date": "2026-07-19", "first_entry_date": "2026-09-01", "avg_rank": 42.9, "avg_plan": 4964.8, "first_buying_date_status": "ok"},
            {"game_name": "A", "featured_rank": 1, "first_buying_date": None, "first_entry_date": "2026-09-13", "avg_rank": 37.8, "avg_plan": 11, "first_buying_date_status": "not_found"},
            {"game_name": "X", "featured_rank": None}]
        rows, issues = featured_rows("bestseller", 3)(data, {})
        self.assertEqual(rows, [["A", "", "9.13", "37.8", "11"], ["B", "7.19", "9.01", "42.9", "4965"]])
        self.assertEqual({issue.get("game") for issue in issues if "game" in issue}, {"A"})
        self.assertTrue(any(issue.get("reason") == "fewer_featured_games" for issue in issues))


class TextBoxGridTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.template = Path(self.tmp.name) / "t.pptx"

    def test_grid_found_from_headers_fills_rows_clears_spares_and_unifies_colour(self):
        header = [box(10, 0, 0, "#"), box(11, 50, 0, "游戏"), box(12, 100, 0, "环比"), box(13, 150, 0, "日均计划数"),
                  box(14, 200, 0, "计划数环比"), box(15, 250, 0, "MAU")]
        rows = []
        for index, colour in enumerate(["111827", "C89C4A", "111827"]):
            base = 100 + index * 10
            rows += [box(base, 0, 20 + index * 20, str(index + 1), colour), box(base + 1, 50, 20 + index * 20, "旧", colour),
                     box(base + 2, 100, 20 + index * 20, "-", colour), box(base + 3, 150, 20 + index * 20, "1", colour),
                     box(base + 4, 200, 20 + index * 20, "+1%", colour), box(base + 5, 250, 20 + index * 20, "9", colour)]
        pptx(self.template, {1: slide(*header, *rows)})
        data = export("2026-09", "2026-08", [game(1, "甲"), game(2, "乙")])
        mapping = {"format": "native-pptx-mapping-v1", "dataSource": "minigame-monthly",
                   "ops": [{"op": "fillGrid", "slide": 1, "source": "minigame.bestseller", "header": [10, 11, 12, 13, 14, 15],
                            "columns": [0, 1, 4, 5, 6, None], "rows": 3, "uniformStyle": True}]}
        compiled = compile_mapping(mapping, self.template, data, {"previous": export("2026-08", "2026-07", [game(2, "乙")])})
        self.assertEqual(compiled["mappingIssues"], [])
        values = {item["shapeId"]: item["value"] for item in compiled["replacements"] if item["kind"] == "shapeReplace"}
        self.assertEqual((values[101], values[102], values[111], values[112]), ("甲", "新", "乙", "-1"))  # 乙 fell from 1st to 2nd
        self.assertEqual({values[shape_id] for shape_id in (120, 121, 122, 123, 124, 125)}, {""})
        self.assertEqual(values[105], "")  # no MAU data: the old value goes, the cell becomes a slot
        self.assertIn({"slide": 1, "objectId": 105, "type": "text"}, compiled["slots"])
        restyled = [item["shapeId"] for item in compiled["replacements"] if item["kind"] == "shapeRunStyle"]
        self.assertEqual(sorted(restyled), [110, 111, 112, 113, 114, 115])

    def test_grid_reports_layout_that_no_longer_matches(self):
        pptx(self.template, {1: slide(box(10, 0, 0, "#"), box(11, 50, 0, "游戏"), box(100, 0, 20, "1"))})
        mapping = {"format": "native-pptx-mapping-v1", "dataSource": "minigame-monthly",
                   "ops": [{"op": "fillGrid", "slide": 1, "source": "minigame.bestseller", "header": [10, 11], "rows": 20}]}
        compiled = compile_mapping(mapping, self.template, export("2026-09", "2026-08", [game(1, "甲")]), {})
        reasons = " ".join(item["reason"] for item in compiled["mappingIssues"])
        self.assertIn("找不到唯一", reasons)
        self.assertIn("映射预期 20 行", reasons)


class RemoveTests(unittest.TestCase):
    def test_remove_picture_after_shape_and_its_unused_relationship(self):
        from pptx_preserve_patch import remove_object
        picture = ('<p:pic><p:nvPicPr><p:cNvPr id="2" name="p"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/></p:blipFill></p:pic>')
        xml = slide(box(1, 0, 0, "a"), picture, box(3, 0, 20, "b")).encode()
        rels = (b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                b'<Relationship Id="rId3" Target="../media/x.png"/><Relationship Id="rId9" Target="../media/y.png"/></Relationships>')
        out, out_rels = remove_object(xml, rels, 2)
        self.assertNotIn(b"<p:pic>", out)
        self.assertIn(b'id="1"', out)
        self.assertIn(b'id="3"', out)
        self.assertNotIn(b"rId3", out_rels)
        self.assertIn(b"rId9", out_rels)
        with self.assertRaises(ValueError):
            remove_object(out, out_rels, 2)

    def test_removed_objects_are_not_turned_into_slots(self):
        with tempfile.TemporaryDirectory() as folder:
            template = Path(folder) / "t.pptx"
            pptx(template, {1: slide(box(10, 900, 200, "旧观察"), box(11, 900, 230, "7月"))})
            mapping = {"format": "native-pptx-mapping-v1", "dataSource": "minigame-monthly",
                       "ops": [{"op": "removeObjects", "slide": 1, "ids": [11, 99]},
                               {"op": "clearRegion", "slide": 1, "box": [800, 150, 1260, 680]}]}
            compiled = compile_mapping(mapping, template, export("2026-09", "2026-08"), {})
            self.assertEqual(compiled["removed"], [{"slide": 1, "objectId": 11}])
            self.assertEqual([slot["objectId"] for slot in compiled["slots"]], [10])
            self.assertEqual([issue["reason"] for issue in compiled["mappingIssues"]], ["要删除的对象不存在"])


class PatchTests(unittest.TestCase):
    def test_line_breaks_compare_like_an_xml_parser(self):
        self.assertEqual(run_text(b"<a:t>a\r\nb &amp; c</a:t>"), "a\nb & c")
        xml = slide(box(4, 0, 0, "8月买量\r\n8月榜单")).encode()
        self.assertIn("9月", replace_shape_text(xml, 4, "8月买量\n8月榜单", "9月").decode())

    def test_run_style_also_restyles_cleared_paragraph_marker(self):
        xml = slide(box(4, 0, 0, "x", "C89C4A")).encode()
        cleared = replace_shape_text(xml, 4, "x", "")
        style = '<a:rPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" sz="800"><a:solidFill><a:srgbClr val="111827"/></a:solidFill></a:rPr>'
        result = set_run_style(cleared, 4, style).decode()
        self.assertNotIn("C89C4A", result)
        self.assertRegex(result, r'<a:endParaRPr sz="800"><a:solidFill><a:srgbClr val="111827"\s*/></a:solidFill></a:endParaRPr>')


if __name__ == "__main__":
    unittest.main()
