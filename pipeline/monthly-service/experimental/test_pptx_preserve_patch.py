import unittest
from xml.etree import ElementTree

from pptx_preserve_patch import (patch_cell, patch_shape_fragment, patch_table, table_values,
                                 trim_table_rows, replace_shape_text, picture_to_slot, set_row_fills,
                                 slot_png, replace_shape_runs, hide_shape_fill)


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

    def test_manual_text_slot_keeps_each_paragraph_ready_to_fill(self):
        source = (b'<p:sp><p:cNvPr id="7"/><a:p><a:pPr algn="ctr"><a:buChar char="-"/></a:pPr><a:r><a:rPr sz="1500" b="1"><a:solidFill/></a:rPr>'
                  b'<a:t>old</a:t></a:r><a:r><a:rPr sz="900"/><a:t> month</a:t></a:r></a:p><a:p><a:r><a:rPr sz="1200"/><a:t>body</a:t></a:r></a:p></p:sp>')
        result = replace_shape_text(source, 7, 'old monthbody', '')
        self.assertIn(b'<p:cNvPr id="7"', result)
        self.assertNotIn(b'<a:r>', result)
        self.assertNotIn(b'<a:t>', result)
        self.assertIn(b'<a:p><a:pPr algn="ctr"><a:buChar char="-"/></a:pPr><a:endParaRPr sz="1500" b="1"><a:solidFill/></a:endParaRPr></a:p>', result)
        self.assertIn(b'<a:p><a:endParaRPr sz="1200"/></a:p>', result)

    def test_cleared_cell_keeps_font_for_manual_filling(self):
        result = patch_cell(b'<p:graphicFrame><p:cNvPr id="9"/><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:rPr sz="1200"/><a:t>old</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:graphicFrame>', 9, 0, 0, 'old', '')
        self.assertIn(b'<a:p><a:endParaRPr sz="1200"/></a:p>', result)

    def test_picture_slot_keeps_the_frame_and_swaps_only_the_image(self):
        picture = (b'<p:sld><p:pic><p:nvPicPr><p:cNvPr id="8" name="pic" descr="old.jpg"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/>'
                   b'<a:srcRect l="10"/></p:blipFill><p:spPr><a:xfrm><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:xfrm>'
                   b'<a:prstGeom prst="roundRect"/></p:spPr></p:pic><p:pic><p:nvPicPr><p:cNvPr id="9"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/></p:blipFill></p:pic></p:sld>')
        rels = (b'<Relationships><Relationship Id="rId1" Target="../slideLayouts/slideLayout1.xml"/>'
                b'<Relationship Id="rId2" Target="../media/image1.jpg"/><Relationship Id="rId3" Target="../media/image2.jpg"/></Relationships>')
        slide, rels = picture_to_slot(picture, rels, 8)
        self.assertIn(b'<p:pic>', slide)
        self.assertIn('descr="图片待补"'.encode(), slide)
        self.assertNotIn(b'old.jpg', slide)
        self.assertIn(b'<a:blip r:embed="rId4"/>', slide)
        self.assertIn(b'<a:prstGeom prst="roundRect"/>', slide)
        self.assertIn(b'Target="../media/monthly-image-slot.png"', rels)
        self.assertNotIn(b'image1.jpg', rels)
        slide, rels = picture_to_slot(slide, rels, 9)
        self.assertEqual(slide.count(b'r:embed="rId4"'), 2)
        self.assertEqual(rels.count(b'monthly-image-slot.png'), 1)
        self.assertTrue(slot_png().startswith(b'\x89PNG'))

    def test_row_fills_follow_the_selected_rows(self):
        def cell(fill):
            return (b'<a:tc><a:txBody><a:p><a:r><a:t>x</a:t></a:r></a:p></a:txBody><a:tcPr><a:lnL><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnL>'
                    + fill + b'</a:tcPr></a:tc>')
        white, gold = b'<a:solidFill><a:schemeClr val="bg1"/></a:solidFill>', b'<a:solidFill><a:srgbClr val="FAF3E3"/></a:solidFill>'
        rows = b''.join(b'<a:tr h="1">' + cell(fill) + b'</a:tr>' for fill in (white, gold, white, gold))
        table = b'<p:graphicFrame><p:cNvPr id="9"/><a:tbl>' + rows + b'</a:tbl></p:graphicFrame>'
        result = set_row_fills(table, 9, 1, [False, True, False], 'faf3e3')
        filled = [row for row in result.split(b'<a:tr ')[1:]]
        self.assertIn(white, filled[1])
        self.assertIn(gold, filled[2])
        self.assertIn(white, filled[3])
        self.assertIn(white, filled[0])
        self.assertNotIn(gold, filled[1] + filled[3])
        self.assertEqual(result.count(b'val="000000"'), 4)

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
