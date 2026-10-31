import unittest
from xml.etree import ElementTree

from pptx_preserve_patch import (patch_cell, patch_shape_fragment, patch_table, table_values,
                                 trim_table_rows, replace_shape_text, replace_picture_with_slot,
                                 replace_chart_with_slot, replace_shape_runs, hide_shape_fill)


XML = (b'<p:spTree xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
       b'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
       b'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="table"/></p:nvGraphicFramePr>'
       b'<a:tbl><a:tr><a:tc><a:t>header</a:t></a:tc></a:tr>'
       b'<a:tr><a:tc><a:r><a:t>CS</a:t></a:r><a:r><a:t>2</a:t></a:r></a:tc></a:tr>'
       b'</a:tbl></p:graphicFrame><p:sp><a:t>unchanged</a:t></p:sp></p:spTree>')

TABLE_XML = XML.replace(b'<a:tbl>', b'<a:graphic><a:graphicData><a:tbl>')\
               .replace(b'</a:tbl>', b'<a:tr><a:tc><a:t>old</a:t></a:tc></a:tr></a:tbl></a:graphicData></a:graphic>')
SHAPE_XML = b'<p:sp><p:nvSpPr><p:cNvPr id="24"/></p:nvSpPr><a:r><a:t>DATE </a:t></a:r><a:r><a:t>2026.07.31</a:t></a:r><a:r><a:t>end</a:t></a:r></p:sp>'


class PreservePatchTests(unittest.TestCase):
    def test_replaces_only_requested_cell_and_keeps_editable_runs(self):
        result = patch_cell(XML, 9, 1, 0, 'CS2', '新游 & 2')
        self.assertIn('新游 &amp; 2'.encode(), result)
        self.assertIn(b'<p:sp><a:t>unchanged</a:t></p:sp>', result)
        root = ElementTree.fromstring(result)
        ns = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
        cells = root.findall('.//a:tr/a:tc', ns)
        self.assertEqual(''.join(n.text or '' for n in cells[1].findall('.//a:t', ns)), '新游 & 2')
        self.assertEqual(len(cells[1].findall('.//a:t', ns)), 2)

    def test_rejects_stale_expected_value(self):
        with self.assertRaisesRegex(ValueError, 'Expected cell'):
            patch_cell(XML, 9, 1, 0, 'APEX', 'new')

    def test_same_value_preserves_original_run_markup_byte_for_byte(self):
        self.assertEqual(patch_cell(XML, 9, 1, 0, 'CS2', 'CS2'), XML)

    def test_rejects_missing_table(self):
        with self.assertRaisesRegex(ValueError, 'missing or ambiguous'):
            patch_cell(XML, 8, 1, 0, 'CS2', 'new')

    def test_fills_native_table_and_clears_remaining_old_rows(self):
        result = patch_table(TABLE_XML, 9, 0, ['header'], [['新游戏']], new_header=['新表头'])
        self.assertEqual(table_values(result, 9), [['新表头'], ['新游戏'], ['']])
        self.assertIn(b'<p:sp><a:t>unchanged</a:t></p:sp>', result)

    def test_refuses_overflow_or_changed_header(self):
        with self.assertRaisesRegex(ValueError, 'continuation page'):
            patch_table(TABLE_XML, 9, 0, ['header'], [['a'], ['b'], ['c']])
        with self.assertRaisesRegex(ValueError, 'header changed'):
            patch_table(TABLE_XML, 9, 0, ['other'], [['a']])

    def test_shape_month_fragment_preserves_other_runs(self):
        result = patch_shape_fragment(SHAPE_XML, 24, 'DATE 2026.07.31end', '2026.07.31', '2026.08.31')
        self.assertIn(b'<a:r><a:t>DATE </a:t></a:r>', result)
        self.assertIn(b'<a:r><a:t>2026.08.31</a:t></a:r>', result)
        self.assertIn(b'<a:r><a:t>end</a:t></a:r>', result)

    def test_shape_fragment_refuses_unreviewed_text(self):
        with self.assertRaisesRegex(ValueError, 'Shape text changed'):
            patch_shape_fragment(SHAPE_XML, 24, 'DATE 2026.07.30end', '2026.07.31', '2026.08.31')

    def test_shape_fragment_across_runs_keeps_each_run(self):
        source = b'<p:sp><p:cNvPr id="4"/><a:r><a:t>7</a:t></a:r><a:r><a:t>month</a:t></a:r></p:sp>'
        result = patch_shape_fragment(source, 4, '7month', '7month', '8month')
        self.assertIn(b'<a:r><a:t>8</a:t></a:r><a:r><a:t>month</a:t></a:r>', result)
        # A month that grows (7月 to 10月) keeps its text in the first styled run.
        changed = patch_shape_fragment(source, 4, '7month', '7month', 'Aug')
        self.assertIn(b'<a:r><a:t>Aug</a:t></a:r><a:r><a:t></a:t></a:r>', changed)

    def test_trim_native_table_updates_frame_height_and_preserves_cells(self):
        source = TABLE_XML.replace(b'<p:graphicFrame>',
                                   b'<p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="90"/></p:xfrm>')
        source = source.replace(b'<a:tr>', b'<a:tr h="30">')
        result = trim_table_rows(source, 9, 2)
        self.assertEqual(table_values(result, 9), [['header'], ['CS2']])
        self.assertIn(b'cy="60"', result)
        self.assertIn(b'<p:sp><a:t>unchanged</a:t></p:sp>', result)
        with self.assertRaisesRegex(ValueError, 'Invalid table row count'):
            trim_table_rows(source, 9, 4)

    def test_manual_text_slot_removes_old_bullet_and_keeps_shape(self):
        source = b'<p:sp><p:cNvPr id="7"/><a:p><a:pPr><a:buChar char="-"/></a:pPr><a:r><a:t>old month</a:t></a:r></a:p></p:sp>'
        result = replace_shape_text(source, 7, 'old month', '')
        self.assertIn(b'<p:cNvPr id="7"', result)
        self.assertNotIn(b'old month', result)
        self.assertNotIn(b'a:buChar', result)

    def test_picture_and_chart_become_editable_visual_slots(self):
        picture = (b'<p:pic><p:nvPicPr><p:cNvPr id="8"/></p:nvPicPr><p:spPr>'
                   b'<a:xfrm><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:xfrm>'
                   b'</p:spPr></p:pic>')
        result = replace_picture_with_slot(picture, 8)
        self.assertIn(b'<p:sp>', result)
        self.assertNotIn(b'<p:pic>', result)
        self.assertIn('图片待补'.encode(), result)
        chart = (b'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="12"/></p:nvGraphicFramePr>'
                 b'<p:xfrm><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></p:xfrm>'
                 b'<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/>'
                 b'</p:graphicFrame>')
        result = replace_chart_with_slot(chart, 12)
        self.assertIn(b'<p:sp>', result)
        self.assertNotIn(b'<p:graphicFrame>', result)
        self.assertIn('图表待补'.encode(), result)

    def test_market_kpi_runs_keep_styles_and_missing_ai_bar_is_hidden(self):
        source = (b'<p:sp><p:cNvPr id="70"/><p:spPr><a:solidFill>'
                  b'<a:srgbClr val="E6CD97"/></a:solidFill></p:spPr>'
                  b'<a:r><a:rPr sz="1000"/><a:t>7</a:t></a:r>'
                  b'<a:r><a:rPr sz="2000"/><a:t>2635</a:t></a:r></p:sp>')
        result = replace_shape_runs(source, 70, ['7', '2635'], ['8', '2849'])
        self.assertIn(b'<a:rPr sz="1000"/><a:t>8</a:t>', result)
        self.assertIn(b'<a:rPr sz="2000"/><a:t>2849</a:t>', result)
        result = hide_shape_fill(result, 70, 'E6CD97')
        self.assertIn(b'<p:spPr><a:noFill/></p:spPr>', result)
        with self.assertRaisesRegex(ValueError, 'fill color changed'):
            hide_shape_fill(result, 70, 'E6CD97')


if __name__ == '__main__':
    unittest.main()
