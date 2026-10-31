import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from native_writeback import apply, extract, set_paragraph


P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
BOLD = '<a:rPr b="1"/>'


def run(text, properties=BOLD):
    return f'<a:r>{properties}<a:t>{text}</a:t></a:r>'


def shape(identifier, *paragraphs):
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{identifier}" name="s"/></p:nvSpPr><p:spPr/>'
            f'<p:txBody><a:bodyPr/>{"".join(paragraphs)}</p:txBody></p:sp>')


def table(identifier, rows):
    body = ''.join('<a:tr h="100">' + ''.join(f'<a:tc><a:txBody><a:bodyPr/><a:p>{run(value)}</a:p></a:txBody><a:tcPr/></a:tc>' for value in row) + '</a:tr>' for row in rows)
    return (f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{identifier}" name="t"/></p:nvGraphicFramePr><p:xfrm/>'
            f'<a:graphic><a:graphicData><a:tbl>{body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>')


class WritebackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.source = Path(self.tmp.name) / 'source.pptx'
        self.output = Path(self.tmp.name) / 'output.pptx'
        slide = (f'<p:sld {P} {A} {R}><p:cSld><p:spTree>'
                 + shape(4, f'<a:p>{run("8")}{run("月")}</a:p>', f'<a:p><a:pPr><a:buChar char="•"/></a:pPr>{run("要点")}</a:p>')
                 + shape(5, '<a:p><a:endParaRPr sz="1400"/></a:p>')
                 + table(9, [['排名', '游戏'], ['1', 'HELLDIVERS™ 2']])
                 + '</p:spTree></p:cSld></p:sld>')
        with zipfile.ZipFile(self.source, 'w') as archive:
            archive.writestr('ppt/presentation.xml', f'<p:presentation {P} {R}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>')
            archive.writestr('ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>')
            archive.writestr('ppt/slides/slide1.xml', slide)
            archive.writestr('ppt/media/image1.png', b'image')

    def written(self):
        with zipfile.ZipFile(self.output) as archive:
            return archive.read('ppt/slides/slide1.xml').decode('utf-8')

    def test_extract_reads_runs_paragraphs_and_tables(self):
        slide = extract(self.source)['slides']['1']
        self.assertEqual(slide['shapes']['4'], [['8', '月'], ['要点']])
        self.assertEqual(slide['tables']['9'][1][1], [['HELLDIVERS™ 2']])

    def test_same_structure_keeps_each_run_and_only_the_slide_changes(self):
        change = {'kind': 'text', 'slide': 1, 'shapeId': 4, 'before': [['8', '月'], ['• ', '要点']], 'paragraphs': [['10', '月'], ['• ', '新要点']]}
        result = apply(self.source, [change], self.output)
        self.assertEqual((result['applied'], result['rejected']), (1, []))
        text = self.written()
        self.assertIn(f'{BOLD}<a:t>10</a:t>', text)
        self.assertIn('<a:t>新要点</a:t>', text)
        self.assertIn('<a:buChar', text)
        self.assertNotIn('• ', text.replace('char="•"', ''))
        with zipfile.ZipFile(self.source) as before, zipfile.ZipFile(self.output) as after:
            self.assertEqual(before.read('ppt/media/image1.png'), after.read('ppt/media/image1.png'))

    def test_changed_run_count_keeps_first_run_style(self):
        change = {'kind': 'text', 'slide': 1, 'shapeId': 4, 'before': [['8', '月'], ['要点']], 'paragraphs': [['八月报告'], ['要点'], ['新增段落']]}
        apply(self.source, [change], self.output)
        slide = extract(self.output)['slides']['1']
        self.assertEqual(slide['shapes']['4'], [['八月报告'], ['要点'], ['新增段落']])
        self.assertIn(f'{BOLD}<a:t>八月报告</a:t>', self.written())

    def test_removing_paragraphs_and_filling_empty_shape(self):
        changes = [{'kind': 'text', 'slide': 1, 'shapeId': 4, 'before': [['8', '月'], ['要点']], 'paragraphs': [['8', '月']]},
                   {'kind': 'text', 'slide': 1, 'shapeId': 5, 'before': [[]], 'paragraphs': [['人工文案']]}]
        apply(self.source, changes, self.output)
        slide = extract(self.output)['slides']['1']
        self.assertEqual(slide['shapes']['4'], [['8', '月']])
        self.assertEqual(slide['shapes']['5'], [['人工文案']])
        self.assertIn('<a:rPr sz="1400"/><a:t>人工文案</a:t>', self.written())

    def test_table_cell_and_escaping(self):
        change = {'kind': 'cell', 'slide': 1, 'tableId': 9, 'row': 1, 'column': 1, 'before': [['HELLDIVERS™ 2']], 'paragraphs': [['A & B']]}
        apply(self.source, [change], self.output)
        self.assertEqual(extract(self.output)['slides']['1']['tables']['9'][1][1], [['A & B']])
        self.assertIn('A &amp; B', self.written())

    def test_stale_or_missing_objects_are_rejected_without_writing(self):
        changes = [{'id': 'a', 'kind': 'text', 'slide': 1, 'shapeId': 4, 'before': [['别的文字']], 'paragraphs': [['x']]},
                   {'id': 'b', 'kind': 'text', 'slide': 1, 'shapeId': 99, 'before': [], 'paragraphs': [['x']]},
                   {'id': 'c', 'kind': 'cell', 'slide': 1, 'tableId': 9, 'row': 8, 'column': 0, 'before': [], 'paragraphs': [['x']]},
                   {'id': 'd', 'kind': 'text', 'slide': 3, 'shapeId': 4, 'before': [], 'paragraphs': [['x']]}]
        result = apply(self.source, changes, self.output)
        self.assertEqual((result['applied'], result['written']), (0, False))
        self.assertEqual([item['id'] for item in result['rejected']], ['a', 'b', 'c', 'd'])
        self.assertFalse(self.output.exists())

    def test_line_break_is_written(self):
        changed = set_paragraph(f'<a:p>{run("甲")}</a:p>'.encode(), ['甲', '\n', '乙']).decode('utf-8')
        self.assertIn('<a:br/>', changed)
        self.assertEqual(changed.count('<a:t>'), 2)


if __name__ == '__main__':
    unittest.main()
