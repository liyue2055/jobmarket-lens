# Posting release — 2026-10-17

This release activates the audited public upstream snapshot on GitHub Pages and `lens.feedos.si`.
React V2 at `jobmarket.feedos.si` retains its existing release.
The [release receipt](POSTING_RELEASE_2026_10_17.json) records hashes, identities and independent counts.

| Scope | Postings | Employers |
|---|---:|---:|
| Pages, upstream, all statuses (default) | 114,932 | 412 |
| Node, combined, all statuses | 114,968 | 413 |
| Node, combined, open (default) | 110,642 | 412 |
| Retained local observations | 92 | 7 |

Source commit: `2fc50364f3056b1dfa930e8dfeba576a5b28a3c8`, timestamp
`2026-10-16T22:26:25Z`. There are 56 shared IDs. Original local seed and collection history remain
byte-for-byte unchanged. Reported upstream status/date metadata does not establish local observation
or description coverage. No collector, private upstream database, employee source or paid API was used.

Node dataset: `2a8dae031624f082dbaff7540e2dd92ce3643562f6835e6151d386f018831960`.
All-status upstream and combined each have 37,153 eligible USD salary ranges; combined open has
35,507. Explicit CAD/EUR ranges retain their currency without inference or conversion. Ambiguous
currency and invalid ranges remain excluded from USD analysis.

Older spatial links block queries until an explicit fresh start clears old filters and cohorts.
The existing tour, music and transcript are preserved; a historical-recording notice explains the
recording's different counts. Existing Studio/study dataset compatibility checks remain.

## Reproduction

Using Node 22.20.0:

```sh
npm --prefix node25 run data:pull-candidate
npm --prefix node25 run data:pull-candidate -- --offline
npm --prefix node25 run data:refresh-release
.venv/bin/python scripts/export_upstream_page.py
```

The Node refresh stages output under ignored `.private/releases/`. Activation copies its audited
`postings.parquet` and `release.json` to `node25/store`, retaining the original seed/history, then
validates the complete store. Ordinary builds verify committed files without downloading data.
Pages uses our template and public-field allowlist; upstream JavaScript is never executed.
The CSV preserves source-title whitespace.

```sh
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python scripts/check_publication.py
.venv/bin/python tests/browser_smoke.py
npm --prefix node25 test
npm --prefix node25 run build
npm --prefix node25 run test:e2e
```

Rollback: revert the release commit and redeploy both targets, restoring the matching store,
metadata and UI together. Git retains previous public artifacts; a private pre-release backup also
exists locally. Earlier staging receipts remain historical evidence, not activation manifests.
