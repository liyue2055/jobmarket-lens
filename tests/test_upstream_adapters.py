"""Offline synthetic fixtures for upstream collectors under the fork's evidence rules."""
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from collector.adapters import ADAPTERS, avature, lever, taleo
from collector.quality import collection_completeness


class UpstreamAdapterTests(unittest.TestCase):
    def test_all_configured_collectors_have_registered_implementations(self):
        cfg = json.loads((Path(__file__).resolve().parents[1] / 'config/companies.json').read_text())
        unresolved = {c['adapter'] for c in cfg['companies']} - set(ADAPTERS) - {'none'}
        self.assertEqual(unresolved, set())
        self.assertTrue(cfg['collection']['respect_robots_txt'])

    def test_lever_repeated_listing_pages_fail_before_an_uncapped_loop(self):
        page = [{'id': f'synthetic-{i}'} for i in range(100)]
        for limit in (5, sys.maxsize):
            with self.subTest(limit=limit):
                http = Mock()
                http.get.side_effect = [SimpleNamespace(json=lambda: page)] * 2
                stats = {}
                with self.assertRaisesRegex(ValueError, 'Repeated Lever'):
                    list(lever.collect('TEST', {'site': 'synthetic'}, http, limit, stats))
                self.assertEqual(http.get.call_count, 2)
                self.assertEqual(stats['duplicates'], 1)
                self.assertNotEqual(collection_completeness(0, limit, stats), 'complete')

    def test_lever_valid_pagination_preserves_newest_cap_and_reported_inventory(self):
        jobs = [{'id': f'synthetic-{i}', 'text': 'Synthetic example role',
                 'createdAt': 1_700_000_000_000 + i * 1000,
                 'hostedUrl': f'https://example.test/jobs/{i}'} for i in range(101)]
        http = Mock()
        http.get.side_effect = [SimpleNamespace(json=lambda: jobs[:100]),
                                SimpleNamespace(json=lambda: jobs[100:])]
        stats = {}
        records = list(lever.collect('TEST', {'site': 'synthetic'}, http, 5, stats))
        self.assertEqual([r['source_id'] for r in records],
                         [f'synthetic-{i}' for i in range(100, 95, -1)])
        self.assertEqual(stats['site_total'], 101)
        self.assertEqual(http.get.call_args_list[1].kwargs['params']['skip'], 100)
        self.assertEqual(collection_completeness(5, 5, stats), 'partial')

    def test_taleo_repeated_pages_stop_before_fetching_detail(self):
        http = Mock()
        http.get.return_value.text = "portalNo: '1'"
        payload = {'requisitionList': [{'contestNo': i, 'column': ['Synthetic example role']}
                                      for i in range(100)],
                   'pagingData': {'totalCount': 1000}}
        http.post.side_effect = [SimpleNamespace(json=lambda: payload)] * 2
        stats = {}
        with self.assertRaisesRegex(ValueError, 'Repeated Taleo'):
            list(taleo.collect('TEST', {'host': 'example.test', 'section': 'synthetic'},
                               http, sys.maxsize, stats))
        self.assertEqual(http.post.call_count, 2)
        self.assertEqual(http.get.call_count, 1)
        self.assertEqual(stats['duplicates'], 1)
        self.assertNotEqual(collection_completeness(0, sys.maxsize, stats), 'complete')

    def test_avature_keeps_unknown_date_inventory(self):
        http = Mock()
        http.get.return_value = SimpleNamespace(headers={}, text='synthetic fixture')
        record = {'source_id': 'synthetic-1', 'title': 'Synthetic example role',
                  'posted_date': None}
        with patch.object(avature, '_sitemap_entries', return_value=[
                ('https://example.test/JobDetail/Synthetic/1', '2026-10-16')]), \
                patch.object(avature, '_detail', return_value=record):
            stats = {}
            records = list(avature.collect('TEST', {'sitemap': 'https://example.test/sitemap.xml'},
                                          http, 10, stats))
        self.assertEqual(records, [record])
        self.assertIsNone(records[0]['posted_date'])
        self.assertEqual(stats['no_date'], 1)


if __name__ == '__main__':
    unittest.main()
