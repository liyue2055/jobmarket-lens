"""Synthetic, offline listing regressions for the October 17 upstream merge."""
import json
import re
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import requests
from collector.adapters import avature, html_sites, icims, successfactors, talentbrew, walmart, workday
from collector.adapters.common import raw_posting, seen_before
from collector.quality import collection_completeness


class UpstreamListingTests(unittest.TestCase):
    def test_cached_workday_sighting_stops_at_total_without_detail_or_extra_page(self):
        url = 'https://example.test/jobs/role-1'
        http = SimpleNamespace(known={'R1': url}, known_urls={url: 'R1'},
            post=Mock(return_value=SimpleNamespace(json=lambda: {
                'total': 1, 'jobPostings': [{'externalPath': '/role-1'}]})),
            get=Mock(side_effect=AssertionError('Cached detail must not be fetched')))
        stats = {}
        records = list(workday.collect('TEST', {'host': 'example.test', 'tenant': 'test', 'site': 'jobs'},
                                       http, 100, stats))
        self.assertEqual([r['source_id'] for r in records], ['R1'])
        self.assertTrue(records[0]['seen_only'])
        self.assertEqual(http.post.call_count, 1)
        http.get.assert_not_called()
        self.assertEqual(collection_completeness(1, 100, stats), 'complete')

    def test_workday_cap_counts_both_cached_and_new_records(self):
        url = 'https://example.test/jobs/role-1'
        http = SimpleNamespace(known={'R1': url}, known_urls={url: 'R1'},
            post=Mock(return_value=SimpleNamespace(json=lambda: {'total': 3,
                'jobPostings': [{'externalPath': f'/role-{i}'} for i in (1,2,3)]})),
            get=Mock(return_value=SimpleNamespace(json=lambda: {
                'jobPostingInfo': {'jobReqId': 'R2', 'title': 'Synthetic new role'}})))
        stats = {}
        records = list(workday.collect('TEST', {'host': 'example.test', 'tenant': 'test', 'site': 'jobs'},
                                       http, 2, stats))
        self.assertEqual([r['source_id'] for r in records], ['R1','R2'])
        self.assertEqual(http.get.call_count, 1)
        self.assertEqual(collection_completeness(2, 2, stats), 'partial')

    def test_stale_sitemap_entries_still_require_a_live_detail_check(self):
        cases = [
            (html_sites, html_sites.collect_sitemap, html_sites, '/job/synthetic/2000000001',
             {'sitemap': 'https://example.test/sitemap.xml'}),
            (avature, avature.collect, avature, '/JobDetail/Synthetic/2000000001',
             {'sitemap': 'https://example.test/sitemap.xml'}),
            (talentbrew, talentbrew.collect, talentbrew, '/job/synthetic/100001/2000000001',
             {'sitemap': 'https://example.test/sitemap.xml'}),
            (icims, icims.collect, icims, '/jobs/2000000001/synthetic/', {'host': 'example.test'}),
            (successfactors, successfactors._from_sitemap, html_sites, '/job/synthetic/2000000001',
             'example.test'),
        ]
        for module, collect, sitemap_module, path, params in cases:
            with self.subTest(adapter=module.__name__):
                url = 'https://example.test' + path
                http = SimpleNamespace(known={'2000000001':url}, known_urls={url:'2000000001'},
                                       get=Mock(side_effect=requests.HTTPError('Synthetic 404')))
                stats = {}
                with patch.object(sitemap_module, '_sitemap_entries', return_value=[(url,None)]):
                    records = list(collect('TEST', params, http, 10, stats))
                self.assertEqual(records, [])
                self.assertEqual(http.get.call_count, 1)
                self.assertEqual(stats['gone'], 1)
                self.assertNotEqual(collection_completeness(0,10,stats), 'complete')

    def test_walmart_cached_sitemap_url_cannot_reopen_a_closed_detail(self):
        url = 'https://careers.walmart.com/us/en/jobs/R-2000000001'
        payload = {'props': {'pageProps': {'jobDetails': {
            'jobId':'R1', 'requisitionStatus':{'value':'Closed','id':'CLOSED'}}}}}
        http = SimpleNamespace(known={'R1':url}, known_urls={url:'R1'}, get=Mock(side_effect=[
            SimpleNamespace(text=f'<urlset><url><loc>{url}</loc></url></urlset>'),
            SimpleNamespace(headers={}, text='<script id="__NEXT_DATA__">'+json.dumps(payload)+'</script>')]))
        stats = {}
        self.assertEqual(list(walmart.collect('TEST',{},http,10,stats)), [])
        self.assertEqual(http.get.call_count,2)
        self.assertEqual(stats['not_open'],1)
        self.assertEqual(collection_completeness(0,10,stats),'partial')

    def test_talentbrew_configuration_extracts_posting_id_instead_of_organization_id(self):
        cfg=json.loads((Path(__file__).resolve().parents[1]/'config/companies.json').read_text())
        tickers={'BLK','CARR','CVX','F','JKHY','KDP','MCO','NTAP','SYF','SNPS'}
        found=[company for company in cfg['companies'] if company['ticker'] in tickers]
        self.assertEqual(len(found),10)
        for company in found:
            pattern=company['params']['id_pattern']
            self.assertEqual(re.search(pattern,'https://example.test/job/city/title/100001/2000000001')[1],
                             '2000000001')
        params={'sitemap':'https://example.test/sitemap.xml', 'id_pattern':found[0]['params']['id_pattern']}
        urls=[('https://example.test/job/city/title/100001/'+identity,None)
              for identity in ['2000000001','2000000002']]
        http=SimpleNamespace()
        with patch.object(html_sites,'_sitemap_entries',return_value=urls), \
             patch.object(html_sites,'_detail',side_effect=lambda company,sid,url,http:
                          raw_posting(company,sid,url,'Synthetic role',source_method='jsonld')):
            records=list(html_sites.collect_sitemap('TEST',params,http,10,{}))
        self.assertEqual({r['source_id'] for r in records},{'2000000001','2000000002'})

    def test_seen_before_uses_only_unambiguous_known_identity(self):
        self.assertIsNone(seen_before('TEST',SimpleNamespace(),source_id='R1'))
        http=SimpleNamespace(known={'R1':'https://example.test/job'},
                             known_urls={'https://example.test/job':None,'https://example.test/unknown':'R2'})
        self.assertIsNone(seen_before('TEST',http,url='https://example.test/job'))
        self.assertIsNone(seen_before('TEST',http,url='https://example.test/unknown'))
        self.assertEqual(seen_before('TEST',http,source_id='R1')['source_id'],'R1')


if __name__ == '__main__':
    unittest.main()
