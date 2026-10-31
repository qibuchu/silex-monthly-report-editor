import io
import unittest
import zipfile

from pptx_market_charts import blank_chart_xml, blank_workbook, patch_chart, patch_cell, patch_shared_strings


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

    def test_fixed_numeric_label_follows_the_data(self):
        series = ('<c:ser><c:dLbls><c:dLbl><c:idx val="0"/><c:layout/><c:tx><c:rich><a:p><a:r><a:t>53</a:t></a:r></a:p></c:rich></c:tx>'
                  '<c:showVal val="1"/></c:dLbl><c:dLbl><c:idx val="1"/><c:tx><c:rich><a:p><a:r><a:t>注释</a:t></a:r></a:p></c:rich></c:tx></c:dLbl></c:dLbls>'
                  '<c:cat><c:strCache><c:pt idx="0"><c:v>6</c:v></c:pt></c:strCache></c:cat>'
                  '<c:val><c:numCache><c:pt idx="0"><c:v>55</c:v></c:pt></c:numCache></c:val></c:ser>').encode()
        result = patch_chart(b'<c:lineChart>' + series + b'</c:lineChart>', ['6月'], [[66]])
        self.assertNotIn(b'<a:t>53</a:t>', result)
        self.assertIn('注释'.encode(), result)
        self.assertIn(b'<c:showVal val="1"/>', result)

    def test_fixed_axis_maximum_grows_to_fit_stacked_totals(self):
        def chart(values, maximum):
            series = b''.join(b'<c:ser><c:cat><c:strCache>' + b''.join(b'<c:pt idx="%d"><c:v>m</c:v></c:pt>' % i for i in range(2)) +
                              b'</c:strCache></c:cat><c:val><c:numCache>' + b''.join(b'<c:pt idx="%d"><c:v>0</c:v></c:pt>' % i for i in range(2)) +
                              b'</c:numCache></c:val></c:ser>' for _ in values)
            return b'<c:barChart><c:grouping val="stacked"/>' + series + b'</c:barChart><c:valAx><c:scaling><c:max val="' + maximum + b'"/></c:scaling></c:valAx>'
        result = patch_chart(chart([0, 0], b'2500'), ['7月', '8月'], [[2363, 2565], [230, 284]])
        self.assertIn(b'<c:max val="3000"/>', result)
        kept = patch_chart(chart([0, 0], b'2500'), ['7月', '8月'], [[1000, 1200], [100, 200]])
        self.assertIn(b'<c:max val="2500"/>', kept)

    def test_chart_slot_keeps_chart_but_drops_old_data_and_names(self):
        xml = ("<c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>午夜轮班</a:t></a:r><a:r><a:t> PCU</a:t></a:r></a:p></c:rich></c:tx></c:title>"
               "<c:lineChart><c:ser><c:tx><c:strRef><c:f>'Shift At Midnight'!$B$1</c:f><c:strCache><c:pt idx=\"0\"><c:v>PCU</c:v></c:pt></c:strCache></c:strRef></c:tx>"
               "<c:dLbls><c:dLbl><c:idx val=\"0\"/></c:dLbl></c:dLbls>"
               "<c:cat><c:numRef><c:f>'Shift At Midnight'!$A$2:$A$3</c:f><c:numCache><c:ptCount val=\"2\"/><c:pt idx=\"0\"><c:v>46225</c:v></c:pt></c:numCache></c:numRef></c:cat>"
               "<c:val><c:numRef><c:f>'Shift At Midnight'!$B$2:$B$3</c:f><c:numCache><c:ptCount val=\"2\"/><c:pt idx=\"0\"><c:v>9</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:lineChart></c:chart>").encode()
        names = {'Shift At Midnight'.encode(): '数据'.encode()}
        result = blank_chart_xml(xml, names).decode()
        self.assertIn('<a:t>图表标题待补</a:t>', result)
        self.assertNotIn('午夜轮班', result)
        self.assertEqual(result.count('<c:pt '), 1)
        self.assertNotIn('46225', result)
        self.assertNotIn('<c:v>9</c:v>', result)
        self.assertIn('<c:ptCount val="0"/>', result)
        self.assertIn('<c:v>系列1</c:v>', result)
        self.assertIn('<c:f>数据!$B$2:$B$3</c:f>', result)
        self.assertNotIn('<c:dLbl>', result)
        book = io.BytesIO()
        with zipfile.ZipFile(book, 'w') as archive:
            archive.writestr('[Content_Types].xml', '<Types><Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="x"/></Types>')
            archive.writestr('xl/workbook.xml', '<workbook><sheets><sheet name="Shift At Midnight" sheetId="1" r:id="rId1"/></sheets><externalReferences><externalReference r:id="rId9"/></externalReferences></workbook>')
            archive.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId9" Target="externalLinks/externalLink1.xml"/></Relationships>')
            archive.writestr('xl/worksheets/sheet1.xml', '<sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" s="2" t="s"><v>1</v></c></row><row><c r="A2"><v>46225</v></c><c r="B2" s="3"><f>B1</f><v>9</v></c></row></sheetData>')
            archive.writestr('xl/sharedStrings.xml', '<sst><si><t>日期</t></si><si><t>午夜轮班</t></si></sst>')
            archive.writestr('xl/externalLinks/externalLink1.xml', '<externalLink/>')
        blob, renamed = blank_workbook(book.getvalue(), xml)
        self.assertEqual(renamed, names)
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            self.assertNotIn('xl/externalLinks/externalLink1.xml', archive.namelist())
            self.assertNotIn('externalReferences', archive.read('xl/workbook.xml').decode())
            self.assertIn('name="数据"', archive.read('xl/workbook.xml').decode())
            sheet = archive.read('xl/worksheets/sheet1.xml').decode()
            self.assertIn('<c r="B1" s="2" t="s"><v>0</v></c>', sheet)
            self.assertIn('<c r="A2"/>', sheet)
            self.assertIn('<c r="B2" s="3"/>', sheet)
            strings = archive.read('xl/sharedStrings.xml').decode()
            self.assertIn('<t>系列1</t>', strings)
            self.assertNotIn('午夜轮班', strings)
            self.assertNotIn('externalLink', archive.read('[Content_Types].xml').decode())


if __name__ == '__main__':
    unittest.main()
