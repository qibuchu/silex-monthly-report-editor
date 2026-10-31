import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from native_mapping import check_mapping, compile_mapping, validate_mapping
from native_sources import head_rows, month_context
from pptx_preserve_patch import patch_shape_fragment


P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'


def cell(text):
    return f'<a:tc><a:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></a:txBody></a:tc>'


def table(table_id, rows):
    body = ''.join('<a:tr h="100">' + ''.join(cell(value) for value in row) + '</a:tr>' for row in rows)
    return (f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{table_id}" name="t"/></p:nvGraphicFramePr>'
            '<p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData>'
            f'<a:tbl>{body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>')


def shape(shape_id, text):
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="s"/></p:nvSpPr><p:spPr/>'
            f'<p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp>')


def slide(*objects):
    return f'<p:sld {P} {A} {R}><p:cSld><p:spTree>{"".join(objects)}</p:spTree></p:cSld></p:sld>'


def pptx(path, slides):
    with zipfile.ZipFile(path, 'w') as archive:
        ids = ''.join(f'<p:sldId id="{255 + n}" r:id="rId{n}"/>' for n in slides)
        archive.writestr('ppt/presentation.xml', f'<p:presentation {P} {R}><p:sldIdLst>{ids}</p:sldIdLst></p:presentation>')
        rels = ''.join(f'<Relationship Id="rId{n}" Target="slides/slide{n}.xml"/>' for n in slides)
        archive.writestr('ppt/_rels/presentation.xml.rels', f'<Relationships>{rels}</Relationships>')
        for number, xml in slides.items():
            archive.writestr(f'ppt/slides/slide{number}.xml', xml)


def game(rank, growth=0.5):
    return {'rank': rank, 'name': f'G{rank}', 'appid': rank, 'revenue_growth': growth, 'revenue_growth_status': 'ok',
            'revenue_growth_unit': 'ratio_0_1', 'rank_delta': rank - 2, 'rank_delta_status': 'ok'}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.template = Path(self.tmp.name) / 'template.pptx'
        self.data = {'schema_version': '2.0', 'report_month': '2026-10', 'previous_month': '2026-09', 'snapshot_id': 's',
                     'head': {'status': 'ready', 'revenue_status': 'ready', 'missing_weeks': [], 'missing_previous_weeks': [],
                              'weeks': [1, 2, 3, 4], 'previous_weeks': [1, 2, 3, 4], 'top20': [game(1), game(2), game(3)]}}
        self.audit = {'month': '2026-10', 'snapshot_id': 's', 'contract_errors': []}

    def mapping(self, *ops):
        return {'format': 'native-pptx-mapping-v1', 'ops': list(ops)}


class SourceTests(Base):
    def test_maps_upstream_values_without_recomputing(self):
        rows, issues = head_rows(self.data)
        self.assertEqual(rows[0], ['1', 'G1', '+50%', '-1'])
        self.assertEqual(rows[1], ['2', 'G2', '+50%', '-'])
        self.assertEqual(rows[2], ['3', 'G3', '+50%', '+1'])
        self.assertEqual(issues, [])

    def test_missing_metric_is_blank_and_recorded(self):
        self.data['head']['top20'][0]['revenue_growth_status'] = 'missing'
        rows, issues = head_rows(self.data)
        self.assertEqual(rows[0][2], '')
        self.assertEqual(issues[0]['missing'], ['revenue_growth'])

    def test_missing_week_rejected(self):
        self.data['head']['missing_weeks'] = ['2026-10-06']
        with self.assertRaises(ValueError):
            head_rows(self.data)

    def test_month_context_handles_year_boundary(self):
        context = month_context('2026-01')
        self.assertEqual((context['monthEnd'], context['previousMonthNumber']), ('2026.01.31', '12'))


class CompileTests(Base):
    def compiled(self, *ops):
        return compile_mapping(self.mapping(*ops), self.template, self.data, {"audit": self.audit})

    def test_mismatched_audit_stops_generation(self):
        pptx(self.template, {1: slide(shape(4, '7月'))})
        self.audit['snapshot_id'] = 'other'
        with self.assertRaises(ValueError):
            self.compiled({'op': 'clearText', 'slide': 1, 'shapeId': 4})

    def test_moved_objects_are_reported_without_stopping(self):
        pptx(self.template, {1: slide(shape(4, '2026年7月新品'))})
        result = self.compiled({'op': 'replaceFragment', 'slide': 1, 'shapeId': 4, 'find': r'\d{1,2}月', 'value': '{monthNumber}月'},
                               {'op': 'clearText', 'slide': 1, 'shapeId': 99},
                               {'op': 'imageSlot', 'slide': 7, 'pictureId': 1})
        self.assertEqual(len(result['replacements']), 1)
        self.assertEqual(result['replacements'][0]['newFragment'], '10月')
        self.assertEqual([item['object'] for item in result['mappingIssues']], [99, 1])

    def test_table_overflow_keeps_what_fits_and_reports_the_rest(self):
        pptx(self.template, {1: slide(table(9, [['排名', '游戏名', '涨幅', '环比'], ['1', 'a', 'b', 'c'], ['2', 'd', 'e', 'f']]))})
        result = self.compiled({'op': 'fillTable', 'slide': 1, 'tableId': 9, 'headerRow': 0, 'source': 'head.top20'})
        self.assertEqual(len(result['replacements'][0]['rows']), 2)
        self.assertIn('1 行数据未填入', result['mappingIssues'][0]['reason'])

    def test_changed_column_count_is_reported_not_written(self):
        pptx(self.template, {1: slide(table(9, [['排名', '游戏名'], ['1', 'a'], ['2', 'b'], ['3', 'c']]))})
        result = self.compiled({'op': 'fillTable', 'slide': 1, 'tableId': 9, 'headerRow': 0, 'source': 'head.top20'})
        self.assertEqual(result['replacements'], [])
        self.assertEqual(len(result['mappingIssues']), 1)

    def test_unknown_variable_and_source_are_reported(self):
        pptx(self.template, {1: slide(shape(4, 'x'), table(9, [['a'], ['b']]))})
        result = self.compiled({'op': 'replaceText', 'slide': 1, 'shapeId': 4, 'value': '{nope}'},
                               {'op': 'fillTable', 'slide': 1, 'tableId': 9, 'source': 'nope.rows'})
        self.assertEqual(result['replacements'], [])
        self.assertEqual(len(result['mappingIssues']), 2)

    def test_highlight_marks_selected_head_rows_and_clears_others(self):
        pptx(self.template, {1: slide(table(9, [['排名', '游戏名', '涨幅', '环比'], ['1', 'a', 'b', 'c'], ['2', 'd', 'e', 'f'], ['3', 'g', 'h', 'i']]))})
        self.data['head']['highlights'] = [{'rank': 2, 'name': 'G2'}]
        result = self.compiled({'op': 'fillTable', 'slide': 1, 'tableId': 9, 'headerRow': 0, 'source': 'head.top20',
                                'highlight': {'source': 'head.highlights', 'color': 'FAF3E3'}})
        fills = [item for item in result['replacements'] if item['kind'] == 'tableFills']
        self.assertEqual(fills[0]['flags'], [False, True, False])
        self.assertEqual(fills[0]['firstRow'], 1)
        cleared = self.compiled({'op': 'fillTable', 'slide': 1, 'tableId': 9, 'headerRow': 0, 'source': 'head.top20', 'highlight': {'color': 'FAF3E3'}})
        self.assertEqual([item for item in cleared['replacements'] if item['kind'] == 'tableFills'][0]['flags'], [False, False, False])
        unknown = self.compiled({'op': 'fillTable', 'slide': 1, 'tableId': 9, 'headerRow': 0, 'source': 'head.top20', 'highlight': {'source': 'nope'}})
        self.assertEqual(len(unknown['mappingIssues']), 1)

    def test_page_numbers_follow_presentation_order(self):
        pptx(self.template, {1: slide(shape(2, '01 / 09')), 2: slide(shape(2, '02 / 09'))})
        result = self.compiled({'op': 'pageNumbers', 'find': r'^\d{2} / \d{2}$'})
        self.assertEqual([item['newFragment'] for item in result['replacements']], ['01 / 02', '02 / 02'])


class MappingTests(Base):
    def test_unknown_format_or_operation_rejected(self):
        with self.assertRaises(ValueError):
            validate_mapping({'format': 'other', 'ops': [{'op': 'clearText'}]})
        with self.assertRaises(ValueError):
            validate_mapping(self.mapping({'op': 'delete'}))

    def test_check_lists_missing_objects_and_accepts_continuations(self):
        pptx(self.template, {1: slide(shape(4, 'x'), table(9, [['a'], ['b']]))})
        mapping = self.mapping({'op': 'clearText', 'slide': 1, 'shapeId': 4},
                               {'op': 'fillTable', 'slide': 2, 'tableId': 9},
                               {'op': 'clearText', 'slide': 1, 'shapeId': 8})
        mapping['continuations'] = [{'sourceSlide': 1, 'newSlide': 2}]
        result = check_mapping(mapping, self.template)
        self.assertFalse(result['ok'])
        self.assertEqual([item.get('object') for item in result['problems']], [8])

    def test_shipped_steam_mapping_is_valid(self):
        mapping = json.loads((Path(__file__).parent / 'steam_monthly_mapping.json').read_text(encoding='utf-8'))
        self.assertGreater(len(validate_mapping(mapping)['ops']), 100)


class FragmentTests(unittest.TestCase):
    def test_longer_month_across_styled_runs_stays_in_first_run(self):
        xml = (f'<p:sp {P} {A}><p:nvSpPr><p:cNvPr id="4"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>7</a:t></a:r>'
               '<a:r><a:t>月新品</a:t></a:r></a:p></p:txBody></p:sp>').encode()
        changed = patch_shape_fragment(xml, 4, '7月新品', '7月', '10月')
        self.assertIn(b'<a:t>10\xe6\x9c\x88</a:t>', changed)
        self.assertIn('<a:t>新品</a:t>'.encode(), changed)


if __name__ == '__main__':
    unittest.main()
