"""Build the independent Pages template from an audited public upstream snapshot, offline.

No collector, local database, upstream JavaScript or private history is read or executed.
"""
import argparse
import base64
import csv
import gzip
import hashlib
import io
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from normalize import parse, skills, soc
from scripts.export_v2 import upstream_record
from scripts.import_upstream import parse_rows, safe_url
from scripts.public_data import PUBLIC_POSTING_FIELDS
from scripts.export_csv import posted_pay

DEFAULT_COMMIT = '2fc50364f3056b1dfa930e8dfeba576a5b28a3c8'
REGISTRY = ROOT / 'node25/scripts/source-candidates.json'


def sha(content):
    return hashlib.sha256(content).hexdigest()


def load_candidate(directory, commit=DEFAULT_COMMIT, registry=None):
    """Verify actual files against trusted registry, never a mutable intake report."""
    registry = registry if registry is not None else json.loads(REGISTRY.read_text())
    entry = registry['candidates'][commit]
    blobs = {}
    for name, expected in entry['files'].items():
        if name != Path(name).name or name not in ('Job postings.csv', 'data source.csv', 'index.html'):
            raise ValueError('Unexpected candidate artifact')
        content = (Path(directory) / name).read_bytes()
        if len(content) != expected['bytes'] or sha(content) != expected['sha256']:
            raise ValueError('Candidate checksum/length mismatch: ' + name)
        blobs[name] = content
    if set(blobs) != {'Job postings.csv', 'data source.csv', 'index.html'}:
        raise ValueError('Missing audited artifact')
    postings, rejects = parse_rows(blobs['Job postings.csv'], 'postings')
    companies, source_rejects = parse_rows(blobs['data source.csv'], 'companies')
    if rejects or source_rejects:
        raise ValueError('Candidate contains rejected CSV records')
    expected = entry['expected']
    if (len(postings), len({r['Ticker'] for r in postings}), len(companies)) != (
            expected['postings'], expected['postingCompanies'], expected['sourceCompanies']):
        raise ValueError('Candidate inventory counts mismatch')
    match = re.search(rb'const EMBEDDED = ("[^"\n]+")', blobs['index.html'])
    if not match:
        raise ValueError('Missing typed payload')
    compressed = base64.b64decode(json.loads(match.group(1)), validate=True)
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
        decoded = stream.read(entry['typedDecodedBytes'] + 1)
    if len(decoded) != entry['typedDecodedBytes']:
        raise ValueError('Typed decoded byte length mismatch')
    typed = json.loads(decoded)
    fields = typed['fields']
    if (fields != entry['typedFields'] or len(set(fields)) != len(fields)
            or set(fields) - (set(PUBLIC_POSTING_FIELDS) | {'skills', 'lic'})):
        raise ValueError('Typed fields mismatch')
    records = {}
    for values in typed['rows']:
        if len(values) != len(fields):
            raise ValueError('Typed row width mismatch')
        record = dict(zip(fields, values))
        if record['id'] in records:
            raise ValueError('Duplicate typed ID')
        records[record['id']] = record
    if set(records) != {r['Posting ID'] for r in postings}:
        raise ValueError('Typed/CSV ID set mismatch')
    for row in postings:
        record = records[row['Posting ID']]
        for csv_key, key in [('Title', 'title'), ('Ticker', 'co'), ('URL', 'url'),
                             ('Posted', 'posted'), ('Last seen', 'last_seen')]:
            if (row[csv_key] or None) != (record[key] or None):
                raise ValueError('Typed/CSV shared field mismatch: ' + csv_key)
        if type(record['open']) is not bool or (row['Status'] == 'Open') != record['open']:
            raise ValueError('Typed/CSV status mismatch')
    return entry, postings, companies, records


def build_payload(entry, postings, companies, typed, commit=DEFAULT_COMMIT, universe=None):
    skill_names = sorted({s.strip() for r in postings for s in r['Skills'].split(';') if s.strip()})
    license_names = sorted({s.strip() for r in postings for s in r['Licenses and certifications'].split(';') if s.strip()})
    skill_index = {s: i for i, s in enumerate(skill_names)}
    license_index = {s: i for i, s in enumerate(license_names)}
    source = 'upstream:' + commit
    fields = list(PUBLIC_POSTING_FIELDS) + ['skills', 'lic']
    rows = []
    for csv_row in postings:
        r = typed[csv_row['Posting ID']]
        # The author's CSV repeats an explicit non-USD currency before both bounds.
        # Reformat that declared native range for our parser; infer no currency.
        pay_row = dict(csv_row)
        explicit = re.fullmatch(r'([A-Z]{3})\s+([\d,.]+)(?:[–-]\1\s+([\d,.]+))?\s+per\s+(hour|month|year)', csv_row['Pay'])
        if explicit:
            currency, low, high, period = explicit.groups()
            pay_row['Pay'] = f'{low} - {high or low} {currency} per {period}'
        normalized = upstream_record(pay_row, source, entry['asOf'], r)
        pay = normalized['pay']
        projected = {k: r.get(k) for k in PUBLIC_POSTING_FIELDS}
        projected.update(
            status=csv_row['Status'], date_basis='upstream_reported_posted',
            first_seen=None, last_seen=csv_row['Last seen'] or None,
            src=source, has_text=None,
            future_date=bool(csv_row['Posted'] and csv_row['Posted'] > entry['asOf'][:10]),
            locations=[{'country': normalized['locations'][0]['country'],
                        'state': normalized['locations'][0]['region'],
                        'city': normalized['locations'][0]['city']}],
            pay_min=pay['annualLow'] if pay else None, pay_max=pay['annualHigh'] if pay else None,
            pay_lo=pay['low'] if pay else None, pay_hi=pay['high'] if pay else None,
            pay_period=pay['period'] if pay else None, pay_cur=pay['currency'] if pay else None,
            pay_valid=bool(pay and pay['valid']), pay_flags=pay['flags'] if pay else [],
            skills=sorted({skill_index[s.strip()] for s in csv_row['Skills'].split(';') if s.strip()}),
            lic=sorted({license_index[s.strip()] for s in csv_row['Licenses and certifications'].split(';') if s.strip()}))
        rows.append([projected[key] for key in fields])
    public_companies = [{
        'rank': int(c['Rank']), 'ticker': c['Ticker'], 'name': c['Company'],
        'sector': c['Sector'], 'career_site': safe_url(c['Career site']), 'adapter': c['Platform'],
        'reported_status': c['Status'], 'reported_last_collected': c['Last collected'] or None,
        'reported_count': int(c['Postings in dashboard'] or 0),
    } for c in companies]
    return {'generated': entry['asOf'][:10], 'posted_from': min(r['Posted'] for r in postings if r['Posted']),
            'history_origin': 'Upstream public snapshot; local observation history and description coverage unknown',
            'source': {'kind': 'upstream_public_snapshot', 'commit': commit, 'asOf': entry['asOf'],
                       'reportedStatus': True, 'localHistoryAvailable': False, 'textCoverage': 'unknown',
                       'artifacts': {name: {'sha256': v['sha256'], 'bytes': v['bytes']} for name, v in entry['files'].items()}},
            'universe': universe or {'retrieved': '2026-10-15'}, 'companies': public_companies,
            'soc_major': soc.SOC_MAJOR, 'levels': parse.LEVELS, 'degree_order': parse.DEGREE_ORDER,
            'skills': [{'name': s, 'family': skills.SKILL_FAMILY.get(s, 'Other')} for s in skill_names],
            'licenses': license_names, 'snapshots': [], 'fields': fields, 'rows': rows}


def write_csv(path, headers, rows):
    def safe(value):
        return "'" + value if isinstance(value, str) and value.startswith(('=', '+', '-', '@')) else value
    with path.open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=headers, lineterminator='\n')
        writer.writeheader()
        writer.writerows({k: safe(row[k]) for k in headers} for row in rows)


def export_page(directory, commit=DEFAULT_COMMIT, output_root=ROOT):
    entry, postings, companies, typed = load_candidate(directory, commit)
    root = Path(output_root)
    config = json.loads((ROOT / 'config/companies.json').read_text())
    payload = build_payload(entry, postings, companies, typed, commit, config['universe'])
    raw = json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode()
    encoded = json.dumps(base64.b64encode(gzip.compress(raw, compresslevel=9, mtime=0)).decode())
    template = (ROOT / 'web/template.html').read_text()
    if template.count('/*DATA*/null') != 1:
        raise ValueError('Expected one publication template data slot')
    html = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head>'
            '<body style="margin:0">\n' + template.replace('/*DATA*/null', encoded) + '\n</body></html>\n')
    rows = [dict(zip(payload['fields'], r)) for r in payload['rows']]
    report = {'generated': payload['generated'], 'history_origin': payload['history_origin'],
              'source': payload['source'], 'postings': len(rows),
              'employers_with_postings': len({r['co'] for r in rows}), 'employers_in_scope': len(companies),
              'posting_status': dict(Counter(r['status'] for r in rows)), 'collection_dates': [],
              'with_full_text': None, 'text_coverage': 'unknown',
              'usable_usd_pay': sum(r['pay_valid'] and r['pay_cur'] == 'USD' for r in rows),
              'pay_flags': dict(Counter(f for r in rows for f in r['pay_flags'])),
              'missing_fields': {k: sum(r[k] in (None, parse.NS) for r in rows) for k in ['country', 'arr', 'deg', 'yrs', 'posted']},
              'limitations': ['Upstream reported snapshot; no local collection run or private history imported.',
                              'Reported last-seen dates are upstream metadata, not locally observed dates.',
                              'Unknown text coverage is not negative skill evidence; employer coverage is non-representative.']}
    (root / 'web').mkdir(parents=True, exist_ok=True)
    (root / 'data').mkdir(parents=True, exist_ok=True)
    (root / 'web/index.html').write_text(html)
    (root / 'data/quality-report.json').write_text(json.dumps(report, indent=2) + '\n')
    for original, record in zip(postings, rows):
        original['Pay'] = posted_pay(record)
    write_csv(root / 'data/Job postings.csv', list(postings[0]), postings)
    for c in companies:
        c['Notes'] = 'Upstream reported snapshot; local completeness unverified.'
    write_csv(root / 'data/data source.csv', list(companies[0]), companies)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', default=DEFAULT_COMMIT)
    parser.add_argument('--input-dir')
    parser.add_argument('--output-root', default=str(ROOT))
    args = parser.parse_args()
    directory = args.input_dir or ROOT / '.private/upstream-candidates' / args.commit
    report = export_page(directory, args.commit, args.output_root)
    print(json.dumps({k: report[k] for k in ['postings', 'employers_with_postings', 'posting_status', 'usable_usd_pay']}))


if __name__ == '__main__':
    main()
