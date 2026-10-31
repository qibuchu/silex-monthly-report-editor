import unittest
from xml.etree import ElementTree

from pptx_preserve_patch import patch_cell, patch_shape_fragment, patch_table, table_values


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
        with self.assertRaisesRegex(ValueError, 'crosses styled text runs'):
            patch_shape_fragment(source, 4, '7month', '7month', 'Aug')


if __name__ == '__main__':
    unittest.main()
