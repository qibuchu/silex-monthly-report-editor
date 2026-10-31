import unittest
from xml.etree import ElementTree

from pptx_preserve_patch import patch_cell


XML = (b'<p:spTree xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
       b'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
       b'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="table"/></p:nvGraphicFramePr>'
       b'<a:tbl><a:tr><a:tc><a:t>header</a:t></a:tc></a:tr>'
       b'<a:tr><a:tc><a:r><a:t>CS</a:t></a:r><a:r><a:t>2</a:t></a:r></a:tc></a:tr>'
       b'</a:tbl></p:graphicFrame><p:sp><a:t>unchanged</a:t></p:sp></p:spTree>')


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

    def test_rejects_missing_table(self):
        with self.assertRaisesRegex(ValueError, 'missing or ambiguous'):
            patch_cell(XML, 8, 1, 0, 'CS2', 'new')


if __name__ == '__main__':
    unittest.main()
