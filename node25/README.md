# JobMarket Lens V2.5 — Research Canvas

A separate Node.js/TypeScript application for the same posting research task. V2 remains at
https://jobmarket.feedos.si; V2.5 is live at https://lens.feedos.si. V3 and the independent video work
remain separate. The new lens/data mark, typography, palette and share assets are documented in the
[brand guide](../docs/V2_5_BRAND_GUIDE.md).

## Run

Use Node 22.20.0 with supported prebuilt DuckDB bindings. No Python build or runtime is required.

```sh
cd node25
npm ci --ignore-scripts
npm test
npm run build
npm start
```

The compiled app and API run together at http://localhost:4175. `npm run dev` runs Vite middleware and
the same API. `npm run test:e2e` runs browser checks. Ordinary builds verify the committed immutable
Parquet release, not private databases or live job sites. Native package source-build fallback is not
needed; dependencies are installed without lifecycle scripts.

## Data and interactions

The Node pipeline reads checksum-pinned original CSVs and the audited typed-currency supplement,
normalizes/merges with the sanitized local migration snapshot and produces Parquet. The current modes
match V2 exactly: 86,190 combined, 86,144 upstream and 92 local, with 46 overlaps. See the
[data pipeline](../docs/V2_5_DATA_PIPELINE.md) for reproduction, strict projection and parity evidence.

A bounded semantic API serves aggregate matrix/category results, exact comparison contributors, skills,
evidence and stable 100-row record pages. The browser never needs a full posting-table download to
operate. Safe CSV exports stream from the server. Nulls, source dates, eligibility and limited coverage
remain explicit; these are observed postings rather than a census of vacancies, hires or available workers.

## Pull a newer source snapshot

`npm run data:pull-candidate` fetches and validates the audited public 114,932-posting snapshot into
ignored private staging. `npm run data:pull-candidate -- --offline` revalidates cached files without
network fallback. Neither command changes the published release. See the
[refresh guide](../docs/UPSTREAM_POSTING_REFRESH.md) for exact scopes, receipts and activation gates.

## Owner console

Generate local access without printing the password:

```sh
node server/setup-admin.mjs
npm run dev
```

The command writes ignored `.env.local` settings and the private access file at
`../.private/node25/admin-access.txt`. It refuses to overwrite existing settings unless `--rotate` is
specified. Sessions last three hours. Production needs `ADMIN_PASSWORD_HASH` and
`ADMIN_SESSION_SECRET` in server-only encrypted project environment variables; never put them in
`VITE_*` variables or Git. Rotating either invalidates sessions. `/api/admin` requires authentication.

The console reports release/runtime diagnostics and seven historical collection summaries with explicit
legacy origin. Automatic collection is disabled. A query never launches employer polling.

Visitor statistics use **self-hosted Umami**, an MIT-licensed open-source solution. Vercel Analytics is
not installed. The tracker/report adapter and [Docker/PostgreSQL setup](analytics/README.md) are ready;
live visitor history requires a persistent Umami host/database and restricted server reporting token.
Until connected, the console shows unavailable statistics. API-shape fixture tests are not live provider
verification. No analytics service or paid provider was purchased.

[Architecture/admin decisions](../docs/V2_5_EXECUTION_AND_ADMIN.md) explain current limits, including
serverless cold starts, per-instance throttling and remaining collection-adapter migration work.

## Optional V2.5.1 Spatial Lab

`/spatial` adds demand shelves, employer evidence coverage and focused recorded-skill co-mentions.
It starts in a complete 2D view; the Three.js/R3F renderer loads only after explicit 3D opt-in. Exact
selection, comparison and CSV are resolved by Node through the [spatial contract](shared/SPATIAL_CONTRACT.md).
The existing 2.5 API and public dataset remain unchanged. No Vercel Analytics is used.
V2.6 remains a [separate design](../docs/V2_6_LINKED_3D_DESIGN.md).
