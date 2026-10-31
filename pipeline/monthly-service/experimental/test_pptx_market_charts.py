import unittest

from pptx_market_charts import patch_chart, patch_cell, patch_shared_strings


class MarketChartTests(unittest.TestCase):
    def test_updates_chart_categories_and_series_without_replacing_series_markup(self):
        series = (b'<c:ser><c:cat><c:strCache><c:pt idx="0"><c:v>7month</c:v></c:pt>'
                  b'<c:pt idx="1"><c:v>8month</c:v></c:pt></c:strCache></c:cat>'
                  b'<c:val><c:numCache><c:pt idx="0"><c:v>1</c:v></c:pt>'
                  b'<c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:val></c:ser>')
        result = patch_chart(b'<c:barChart>' + series + b'</c:barChart>', ['8月', '9月'], [[12, 23]])
        self.assertIn('8月'.encode(), result)
        self.assertIn('9月'.encode(), result)
        self.assertIn(b'<c:v>12</c:v>', result)
        self.assertIn(b'<c:v>23</c:v>', result)
        self.assertNotIn(b'7month', result)
        with self.assertRaisesRegex(ValueError, 'series count'):
            patch_chart(series, ['8月'], [])

    def test_clears_unavailable_workbook_cell_and_updates_shared_string(self):
        sheet = b'<row><c r="D2"><v>717</v></c><c r="B2"><v>100</v></c></row>'
        self.assertIn(b'<c r="D2"></c>', patch_cell(sheet, 'D2', None))
        self.assertIn(b'<c r="B2"><v>180</v></c>', patch_cell(sheet, 'B2', 180))
        strings = b'<sst><si><t>7month</t></si><si><t>old</t></si></sst>'
        self.assertIn('8月'.encode(), patch_shared_strings(strings, {0: '8月'}))


if __name__ == '__main__':
    unittest.main()
