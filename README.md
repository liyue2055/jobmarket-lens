# JobMarket Lens — independent local build

Explore global postings from covered S&P 500 employers using official career sites.
This development branch starts its **own local collection history**. It needs no access to
`yimizhao2015/jobmarket-lens-data`, GitHub token, or paid data provider.

V2 live: https://jobmarket.feedos.si

V1 baseline: https://liyue2055.github.io/jobmarket-lens/

Public code: https://github.com/liyue2055/jobmarket-lens

Private evidence: https://github.com/liyue2055/jobmarket-lens-data (owner access required)

Original project: https://github.com/yimizhao2015/jobmarket-lens

## V2 interactive workspace

A separate React/TypeScript application lives in [`frontend/`](frontend/README.md). It provides
Explore, Compare, Skills and Evidence over a pinned, sanitized 86,190-posting combined release.
The existing GitHub Pages site remains the V1 baseline. V2 is deployed separately on Vercel at
https://jobmarket.feedos.si. See the [deployment record](docs/V2_DEPLOYMENT.md) for live checks and release operations.

```sh
cd frontend
npm ci
npm run build
npm run preview -- --port 4173
```

Use Node 22.20.0. See the [V2 build report](docs/V2_BUILD_REPORT.md) for validation and outstanding
release gates, and the [data pipeline](docs/V2_DATA_PIPELINE.md) for reproducible source intake.
V3 employee/profile integration remains outside this implementation.

## V2.5 Node research canvas

A separate [Node.js application](node25/README.md) adds a linked research canvas, server-side DuckDB
queries, paged evidence, a protected owner console and a new logo/style system. It is live separately at
https://lens.feedos.si; V2 remains at https://jobmarket.feedos.si. Visitor reporting uses self-hosted,
open-source Umami; connecting persistent analytics hosting is separate from app deployment.
See the [build/deployment report](docs/V2_5_BUILD_REPORT.md),
[execution/admin design](docs/V2_5_EXECUTION_AND_ADMIN.md) and [brand guide](docs/V2_5_BRAND_GUIDE.md).

## Start a bounded pilot

Requires Python 3.10+, `requests`, and `beautifulsoup4`. The script creates a virtual environment
using system packages when available. If dependencies are missing, install them into that environment
with pip; some Linux installations also need their distribution's Python venv package.

```sh
./scripts/run_independent.sh
```

The default pilot collects **up to ten postings each from NVIDIA, Visa and Amazon**. These are
technical smoke-test samples, not representative labor-market coverage. The script backs up an
existing local database, collects, and builds `web/index.html` and the CSV exports. It never pulls,
commits, pushes, or publishes, and never downloads the author's private history.

Open `web/index.html` directly, or serve it locally:

```sh
python3 -m http.server 8000 --directory web
```

To request a complete inventory for selected companies:

```sh
./scripts/run_independent.sh --only NVDA,V,AMZN --max 0 --workers 3
```

`--max 0` removes the record cap. Completion still needs verification: APIs may impose their own
limits, repeat pages, or report inconsistent totals. Large employers can take considerable time.
Use `--max 20` for a bounded development run. `--date` must be an ISO date; snapshots are daily,
so rerunning a company on the same date replaces that day's snapshot rather than adding a second one.
Use a balanced employer panel before drawing conclusions across sectors.

## Incremental collection

Known postings discovered in supported active career-site listings can reuse stored details. The run
records a new listing observation and advances last-seen time while retaining the earlier text and
content versions. `collected` counts sightings; `fetched` counts full records received, including
refreshes, and does not count new jobs or HTTP requests. Sitemap-only discovery still checks the
job page/status, because a stale sitemap entry is not enough to reopen a posting.

Use `python -m collector.run --full` to refresh known postings' descriptions, pay and other content.
Incremental sightings do not establish that those fields are unchanged. The existing 24-worker default,
per-site pacing, record caps and conservative completeness/closure rules remain in place. Companies
are scheduled by estimated cost from earlier successful runs. See the
[October 17 upstream integration review](docs/UPSTREAM_INTEGRATION_2026_10_17.md) for compatibility
choices and posting-ID repair limits. No collection is scheduled by merging these changes.

## Data and evidence

- `data/lens.db`: local SQLite database with current records, collection metadata, observations,
  and content versions. Ignored by Git.
- `data/raw/YYYY-MM-DD/`: raw descriptions and run logs. Ignored by Git.
- `data/backups/`: automatic pre-run SQLite backups. Ignored by Git.
- `data/quality-report.json`: aggregate coverage, missingness, pay flags and limitations.
- `data/Job postings.csv` and `data/data source.csv`: generated public dashboard exports.
- `data/normalized/postings.csv`: richer local analyst export, including locations and pay evidence.
- `web/template.html`: editable dashboard source; `web/index.html`: generated standalone page.

The public Git history retains the original author's published normalized snapshot. That snapshot
has no full descriptions and is not imported into the local evidence history. Rebuilding the page
replaces its displayed data with this independent collection. Keep SQLite backups if moving machines;
cloning this repo alone does not restore locally collected descriptions.

## Collection and status rules

The collector honors robots.txt and refusal responses. Existing adapters cover Workday, Oracle,
Eightfold, Jibe, Amazon, SmartRecruiters, SuccessFactors and selected HTML/sitemap sites. The
upstream integration adds Greenhouse, Lever, Ashby, iCIMS, Taleo, Avature, TalentBrew and Jobvite
adapters. These additions have not been live-verified in this fork; configured adapter coverage is
not proof of successful or complete collection. See the
[upstream integration review](docs/UPSTREAM_INTEGRATION_2026_10_16.md).

- **Complete**: a supported paginated API reaches its reported total or an empty page, and the unique
  record count matches its reported total. This is an operational check, not a guarantee of every corporate vacancy.
- **Partial**: a cap is reached, counts disagree, or duplicate/invalid records appear.
- **Unknown**: available evidence cannot establish completeness. HTML/sitemap adapters remain
  unverified unless they provide the required completeness evidence.
- Repeated IDs stop collection to avoid pagination loops; already observed records remain available.
- **Open**: observed in the employer's latest collection attempt, even if that attempt was partial.
- **Unverified**: not observed in the latest attempt, without verified evidence of absence.
- **Possibly closed**: absent from one later complete collection.
- **Closed**: absent from at least two complete collections on different dates after last observation.
  A later observation reopens it. Closure does not mean someone was hired.

All observed inventory is retained, including old and undated postings. Original source dates remain
unchanged. Future dates and unknown dates are excluded from posting-date charts; first-seen dates
are not substituted. Description changes are versioned; collection timestamp changes alone do not
create a new content version. Old SQLite databases migrate automatically, but missing historical
versions cannot be reconstructed.

## Analysis and interpretation

The dashboard defaults to postings observed in the latest attempt. It displays collection coverage,
field missingness, pay review flags, sample sizes, all listed locations, and dictionary skill mentions.
Matched skill context and salary source text remain in the private evidence export. Mentions are not verified requirements. Filters are reflected in the URL when served
over HTTP; the filtered CSV can be downloaded from the page.

Salary extraction retains its matched source text. Unknown currency, inferred pay period and
suspicious ranges are flagged and excluded from aggregate pay charts. These checks are conservative
and do not constitute verified salary extraction. Annualization assumes 2,080 hours for hourly pay.
Occupation, degree, experience and skill extraction still use the original rule-based parsers;
required/preferred qualification separation and finer occupation coding need further evaluation.

Posting-date charts describe the observed inventory, **not hiring growth**. Initial discovery is not
a new vacancy, and a posting is not a headcount measure. Company counts from partial collections
are not comparable. Longitudinal demand analysis needs repeated, verified complete collections from
a stable employer panel. Broad US-market claims need broader sampling; these employers hire globally.

Next enrichment priorities: a manually reviewed extraction sample, O*NET occupation/skill references,
and BLS OEWS wage benchmarks. These external datasets have not yet been imported into this branch.

## Development checks

```sh
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python scripts/build_dataset.py
```

The regression tests cover legacy database migration, incomplete-run closure protection, reopening,
content history, same-day reruns, inventory completeness, salary suffix parsing and source-date preservation.

Optional browser smoke checks (requires Playwright and its Chromium download):

```sh
.venv/bin/python tests/browser_smoke.py
```

The browser check covers desktop/mobile rendering, filters, CSV downloads, URL restoration,
empty states, and directly opening the standalone HTML file.

## Private storage and public deployment

The public page embeds only an explicit allowlist of posting metadata and derived measures.
Full descriptions, pay/skill source snippets, raw responses, and SQLite history are excluded.
`python scripts/check_publication.py` validates the embedded payload and tracked paths before deployment.
A public static dashboard necessarily exposes the limited metadata it displays and exports.

Back up your local evidence to your own **private** data repository using your GitHub CLI login:

```sh
.venv/bin/python scripts/backup_private.py --repo liyue2055/jobmarket-lens-data
```

The script verifies repository visibility before uploading a consistent SQLite snapshot,
raw evidence archive, richer normalized export and SHA-256 manifest to release `data`.
It refuses public destinations. Keep additional local backups; this release contains the latest backup.

To restore the SQLite database on a new checkout (do not overwrite an existing database):

```sh
mkdir -p data
gh release download data -R liyue2055/jobmarket-lens-data -p lens.db.gz -D data
gunzip data/lens.db.gz
```

After a local refresh, back up the evidence, rebuild, run the tests and publication check,
then commit and push the public code and generated dashboard. GitHub Pages publishes `web/`
on pushes to this fork's `main` branch. The workflow checks the public data boundary first.
`scripts/run_local.sh` now invokes the independent local collector. The original workflow that
accessed the author's private repo has been removed. No recurring collection is configured;
the deployed site remains a limited preview until explicitly refreshed.

© 2026 Yimi Zhao. All rights reserved. Job postings remain the property of the companies that published them.

## V2.5.1 spatial analysis design

[Three.js / spatial-analysis proposal](docs/V2_5_1_3D_ANALYSIS_DESIGN.md) and its
[concept board](docs/v2-5-1-spatial-analysis.svg) explore demand shelves, evidence coverage and
focused skill relationships. This is design only; both deployed versions remain unchanged.

## V2.5.1 implementation and V2.6 design

The optional Node [Spatial Lab API contract](node25/shared/SPATIAL_CONTRACT.md) extends V2.5 with
aggregate demand shelves, evidence coverage and focused recorded-skill neighborhoods. It is built on a
separate feature branch for preview; the public V2/V2.5 baselines remain separate deployments.
[Renderer study](docs/V2_5_1_RENDERER_STUDY.json) and
[local API measurements](docs/V2_5_1_API_MEASUREMENTS.json) state their measurement limits.

[V2.6 linked spatial investigations](docs/V2_6_LINKED_3D_DESIGN.md) and its
[concept board](docs/v2-6-linked-investigations.svg) are design only: synchronized A/B views, coverage
intersections and source-pair evidence. Historical trajectories require genuine saved releases.
