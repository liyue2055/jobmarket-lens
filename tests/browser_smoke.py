"""Optional browser checks: pip install playwright; python -m playwright install chromium."""
import base64
import gzip
import re
import csv
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    embedded = re.search(r'const EMBEDDED = ("[^"\n]+")', (ROOT / 'web/index.html').read_text())
    data = json.loads(gzip.decompress(base64.b64decode(json.loads(embedded.group(1))))) if embedded else json.loads((ROOT / 'web/data.json').read_text())
    upstream = data.get('source', {}).get('kind') == 'upstream_public_snapshot'
    records = [dict(zip(data['fields'], r)) for r in data['rows']]
    observed = records if upstream else [r for r in records if r['status'] == 'Open']
    assert observed, 'Build a fresh pilot dataset first'
    company = observed[0]['co']
    count = sum(r['co'] == company for r in observed)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT / 'web')))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
            page = browser.new_page(viewport={'width': 1440, 'height': 1000})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.wait_for_selector('#tbl tbody tr')
            assert page.locator('#tbl tbody tr').count() == min(25, len(observed))
            assert page.locator('#f-status').input_value() == ('' if upstream else 'Open')
            assert ('Source commit' if upstream else 'verified complete') in page.locator('#coverage-summary').inner_text()
            if upstream:
                assert page.locator('#kpis .v').first.inner_text() == f'{len(records):,}'
                page.select_option('#f-status', 'Open')
                assert page.locator('#kpis .v').first.inner_text() == f'{sum(r["status"] == "Open" for r in records):,}'
                page.select_option('#f-status', 'Closed')
                assert page.locator('#kpis .v').first.inner_text() == f'{sum(r["status"] == "Closed" for r in records):,}'
                page.click('#f-reset')
            assert 'Missing:' in page.locator('#quality-summary').inner_text()
            page.select_option('#f-co', company)
            assert page.locator('#tbl tbody tr').count() == min(25, count)
            with page.expect_download() as download:
                page.click('#download')
            with open(download.value.path()) as f:
                downloaded = list(csv.DictReader(f))
            assert len(downloaded) == count
            assert all(r['co'] == company for r in downloaded)
            page.reload()
            page.wait_for_selector('#tbl tbody tr')
            assert page.locator('#f-co').input_value() == company
            page.click('#f-reset')
            assert page.locator('#tbl tbody tr').count() == min(25, len(observed))
            page.fill('#f-q', 'nonexistent-role-for-empty-check')
            assert page.locator('#tbl tbody tr').count() == 0
            page.click('#f-reset')
            page.set_viewport_size({'width': 390, 'height': 844})
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            assert not errors, errors
            # Embedded dataset must also load when the page is opened directly from disk.
            page.goto((ROOT / 'web/index.html').as_uri())
            page.wait_for_selector('#tbl tbody tr')
            assert not errors, errors
            browser.close()
        print('Browser checks passed: desktop/mobile, filters, CSV, shared URL, reset, empty state, file opening.')
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
