"""Synthetic Pages projection tests: no collectors, private database or network."""
import base64
import copy
import csv
import gzip
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import export_upstream_page as page
from scripts.import_upstream import POSTING_HEADERS, COMPANY_HEADERS
from scripts.public_data import PUBLIC_POSTING_FIELDS


class UpstreamPageTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.csv_row = dict.fromkeys(POSTING_HEADERS, '')
        self.csv_row.update({'Posting ID': 'TEST:1', 'Title': 'Synthetic role', 'Company': 'Synthetic employer',
                             'Ticker': 'TEST', 'SOC code': '15', 'SOC group': 'Computer', 'Job level': 'Mid',
                             'Job type': 'Full-time', 'Work arrangement': 'Remote', 'Country': 'United States',
                             'Number of locations': '2', 'Posted': '2026-10-01', 'Last seen': '2026-10-16',
                             'Pay': '$100,000–$200,000 per year', 'Status': 'Open',
                             'URL': 'https://example.invalid/1', 'Skills': 'Python',
                             'Accepts equivalent experience': 'Not specified'})
        self.company = dict.fromkeys(COMPANY_HEADERS, '')
        self.company.update({'Rank': '1', 'Ticker': 'TEST', 'Company': 'Synthetic employer',
                             'Career site': 'https://example.invalid', 'Platform': 'synthetic',
                             'Status': 'Collected', 'Last collected': '2026-10-16',
                             'Postings in dashboard': '1', 'Notes': 'PRIVATE_NOTES_SENTINEL'})
        self.typed = dict(id='TEST:1', co='TEST', title='Synthetic role', url='https://example.invalid/1',
                          posted='2026-10-01', year=2026, month='2026-10', open=True, soc='15',
                          sched='Full-time', arr='Remote', deg='Not specified', deg_equiv=False,
                          yrs=None, yrs_b='Not specified', lvl='Mid', pay_min=999999, pay_max=999999,
                          pay_lo=100000, pay_hi=200000, pay_period='year', pay_cur='USD',
                          country='United States', state=None, city=None, nloc=2, src='api',
                          first_seen='2020-01-01', last_seen='2026-10-16', skills=[0], lic=[])
        self.fields = list(self.typed)
        self.refresh()

    def refresh(self):
        files = {}
        for name, headers, row in [('Job postings.csv', POSTING_HEADERS, self.csv_row),
                                    ('data source.csv', COMPANY_HEADERS, self.company)]:
            stream = io.StringIO(newline='')
            writer = csv.DictWriter(stream, fieldnames=headers)
            writer.writeheader(); writer.writerow(row)
            files[name] = stream.getvalue().encode()
        decoded = json.dumps({'fields': self.fields, 'rows': [[self.typed[k] for k in self.fields]]}).encode()
        encoded = json.dumps(base64.b64encode(gzip.compress(decoded)).decode())
        files['index.html'] = ('const EMBEDDED = ' + encoded + ';\n<script>UPSTREAM_CODE_SENTINEL</script>').encode()
        self.entry = {'asOf': '2026-10-16T22:26:25Z', 'expected': {'postings': 1, 'postingCompanies': 1, 'sourceCompanies': 1},
                      'typedFields': self.fields.copy(), 'typedDecodedBytes': len(decoded),
                      'files': {name: {'bytes': len(raw), 'sha256': page.sha(raw)} for name, raw in files.items()}}
        self.registry = {'candidates': {page.DEFAULT_COMMIT: self.entry}}
        for name, raw in files.items():
            (self.directory / name).write_bytes(raw)

    def payload(self):
        entry, postings, companies, typed = page.load_candidate(self.directory, registry=self.registry)
        payload = page.build_payload(entry, postings, companies, typed)
        return payload, dict(zip(payload['fields'], payload['rows'][0]))

    def test_projection_excludes_history_text_and_untrusted_annual_values(self):
        payload, row = self.payload()
        self.assertEqual(set(payload['fields']), set(PUBLIC_POSTING_FIELDS) | {'skills', 'lic'})
        self.assertIsNone(row['has_text']); self.assertIsNone(row['first_seen'])
        self.assertEqual(row['last_seen'], '2026-10-16')
        self.assertEqual(row['date_basis'], 'upstream_reported_posted')
        self.assertEqual(row['status'], 'Open')
        self.assertEqual((row['pay_min'], row['pay_max']), (100000, 200000))
        self.assertTrue(row['pay_valid'])
        self.assertEqual(payload['snapshots'], [])
        self.assertNotIn('PRIVATE_NOTES_SENTINEL', json.dumps(payload))

    def test_explicit_valid_non_usd_and_hourly_period_are_preserved(self):
        self.csv_row['Pay'] = 'CAD 25.00–CAD 30.00 per hour'
        self.typed.update(pay_lo=25, pay_hi=30, pay_cur='CAD', pay_period='hour')
        self.refresh()
        _, row = self.payload()
        self.assertEqual((row['pay_lo'], row['pay_hi'], row['pay_cur'], row['pay_period']), (25, 30, 'CAD', 'hour'))
        self.assertTrue(row['pay_valid'])
        self.assertEqual((row['pay_min'], row['pay_max']), (52000, 62400))
        self.assertEqual(row['pay_flags'], [])

    def test_ambiguous_dollar_currency_remains_excluded(self):
        self.typed['pay_cur'] = None
        self.refresh()
        _, row = self.payload()
        self.assertIsNone(row['pay_cur']); self.assertIsNone(row['pay_min'])
        self.assertFalse(row['pay_valid'])
        self.assertIn('ambiguous_csv_currency', row['pay_flags'])

    def test_currency_requires_matching_native_bounds_and_period(self):
        self.typed['pay_hi'] = 900000
        self.refresh()
        _, row = self.payload()
        self.assertFalse(row['pay_valid'])
        self.assertIn('typed_pay_mismatch', row['pay_flags'])

    def test_actual_bytes_override_mutable_report(self):
        (self.directory / 'candidate-report.json').write_text('{"status":"accepted"}')
        with (self.directory / 'Job postings.csv').open('ab') as stream:
            stream.write(b'\n')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            page.load_candidate(self.directory, registry=self.registry)

    def test_unknown_typed_field_and_csv_shared_conflict_fail_closed(self):
        self.typed['description'] = 'PRIVATE_DESCRIPTION_SENTINEL'
        self.fields.append('description'); self.refresh()
        with self.assertRaisesRegex(ValueError, 'fields'):
            page.load_candidate(self.directory, registry=self.registry)
        self.fields.remove('description'); del self.typed['description']
        self.typed['title'] = 'Different role'; self.refresh()
        with self.assertRaisesRegex(ValueError, 'shared field'):
            page.load_candidate(self.directory, registry=self.registry)

    def test_generated_page_uses_own_template_and_sanitizes_source_csv(self):
        verified = page.load_candidate(self.directory, registry=self.registry)
        output = self.directory / 'output'
        with patch.object(page, 'load_candidate', return_value=verified):
            report = page.export_page(self.directory, output_root=output)
        html = (output / 'web/index.html').read_text()
        self.assertNotIn('UPSTREAM_CODE_SENTINEL', html)
        self.assertIn('JobMarket', html)
        self.assertIn('upstream ? "Upstream reported open"', html)
        self.assertIn('id === "f-status" && !upstream', html)
        self.assertEqual(report['postings'], 1)
        self.assertIsNone(report['with_full_text'])
        csv_text = (output / 'data/data source.csv').read_text()
        self.assertNotIn('PRIVATE_NOTES_SENTINEL', csv_text)
        self.assertIn('local completeness unverified', csv_text)


if __name__ == '__main__':
    unittest.main()
