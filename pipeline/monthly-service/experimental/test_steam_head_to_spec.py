import hashlib
import tempfile
import unittest
from pathlib import Path

from steam_head_to_spec import make_spec


class SteamHeadSpecTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.template = Path(self.tmp.name) / 'template.pptx'
        self.template.write_bytes(b'template')
        self.binding = {'templateSha256': hashlib.sha256(b'template').hexdigest(),
                        'slide': 2, 'tableId': 9, 'headerRow': 0, 'capacity': 2,
                        'expectedHeader': ['排名', '游戏名', '环比6月涨幅', '营收榜排名环比']}
        self.data = {'schema_version': '2.0', 'report_month': '2026-08', 'previous_month': '2026-07',
                     'snapshot_id': 'snapshot', 'head': {'status': 'ready', 'revenue_status': 'ready',
                     'missing_weeks': [], 'missing_previous_weeks': [], 'weeks': [1, 2, 3, 4],
                     'previous_weeks': [1, 2, 3, 4], 'top20': [
                         {'rank': 1, 'name': 'A', 'appid': 1, 'revenue_growth': -0.4178,
                          'revenue_growth_status': 'ok', 'revenue_growth_unit': 'ratio_0_1',
                          'rank_delta': 0, 'rank_delta_status': 'ok'},
                         {'rank': 2, 'name': 'B', 'appid': 2, 'revenue_growth': 0.7046,
                          'revenue_growth_status': 'ok', 'revenue_growth_unit': 'ratio_0_1',
                          'rank_delta': 2, 'rank_delta_status': 'ok'}]}}
        self.audit = {'month': '2026-08', 'snapshot_id': 'snapshot', 'contract_errors': []}

    def test_maps_only_upstream_values_and_updates_comparison_month(self):
        self.binding['monthText'] = [{'slide': 2, 'shapeId': 4, 'expectedText': '7月标题',
                                      'oldFragment': '7月', 'format': 'month_label'},
                                     {'slide': 2, 'shapeId': 24, 'expectedText': '2026.07.31截止',
                                      'oldFragment': '2026.07.31', 'format': 'month_end'}]
        spec = make_spec(self.template, self.binding, self.data, self.audit)
        table = spec['replacements'][0]
        self.assertEqual(table['newHeader'][2], '环比7月涨幅')
        self.assertEqual(table['rows'], [['1', 'A', '-42%', '-'], ['2', 'B', '+70%', '+2']])
        self.assertEqual([item['newFragment'] for item in spec['replacements'][1:]], ['8月', '2026.08.31'])
        self.assertEqual(spec['issues'], [])

    def test_missing_metric_is_blank_and_recorded(self):
        self.data['head']['top20'][1]['revenue_growth_status'] = 'missing'
        spec = make_spec(self.template, self.binding, self.data, self.audit)
        self.assertEqual(spec['replacements'][0]['rows'][1][2], '')
        self.assertEqual(spec['issues'][0]['missing'], ['revenue_growth'])

    def test_mismatched_snapshot_or_template_rejected(self):
        self.audit['snapshot_id'] = 'other'
        with self.assertRaisesRegex(ValueError, 'audit'):
            make_spec(self.template, self.binding, self.data, self.audit)
        self.audit['snapshot_id'] = 'snapshot'
        self.binding['templateSha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'template hash'):
            make_spec(self.template, self.binding, self.data, self.audit)

    def test_missing_week_rejected(self):
        self.data['head']['missing_weeks'] = ['2026-08-31']
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            make_spec(self.template, self.binding, self.data, self.audit)


if __name__ == '__main__':
    unittest.main()
