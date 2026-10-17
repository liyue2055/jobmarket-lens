# Upstream integration review — 2026-10-17

Branch: `integration/upstream-2026-10-17`, based on our `main` at
`859d36e727f490bcce212ba788a83254cf363ecf` after PR #10 merged. Integrates two incoming commits:

- `53abc88c897513fc586000ae5987f3043c0b0b4c`: incremental listing collection, cached detail reuse,
  full-refresh override, run counters and cost-based scheduling.
- `1d140fe19f0d5c45f9a43c43f171811a8b453bca`: TalentBrew sitemap posting-ID extraction and Workday
  paging termination fixes.

This is a review merge on a separate branch. It does not promote the branch to main or production.
There are no new upstream CSV/dashboard artifacts in these two commits. PR #10's 114,932-posting
candidate remains staged; its activation work and the current public dataset pins are unchanged.

## Conflict decisions

The merge conflicted in README, `collector/run.py` and `collector/store.py`. Preserve the fork's
private local-history workflow, seven-column snapshot metadata, observations, content versions,
monotonic dates, duplicate guards and conservative complete-inventory closure rules. Importing the
upstream store implementation wholesale would lose these guarantees.

Cached sightings now insert a real listing observation and advance posting last-seen time, without
replacing raw text, first-seen dates or content-version rows. They require an existing stored record;
an unknown cached ID fails and rolls back ingestion rather than creating an orphan observation or
claiming successful complete coverage. Same-day reruns still replace that day's observations.

The known-posting lookup opens SQLite read-only, creates no database and performs no schema migration.
Active ATS/search listing adapters can skip known details. Ambiguous cached URL mappings do not establish
identity. The runner still rejects repeated IDs and separates collected sightings from full records
received (`fetched`). Fetched records include refreshes; that counter is neither new jobs nor request count.

Sitemap URLs may outlive jobs. Keep job-page/status requests for JSON-LD sitemaps, iCIMS, Avature,
TalentBrew, Walmart and the SuccessFactors sitemap fallback. A stale sitemap reference alone must not
reopen a known posting or bypass a 404/closed-page check. Incremental support remains available for
active listing sources. Existing HTML/sitemap completeness stays conservative.

`--full` ignores the previous detail cache and can discover changed pay, text and other fields. Cached
listing observations do not prove those fields are unchanged or freshly analyzed. Raw content retains
its original collection timestamp until refreshed. There is no new automatic collection schedule.

Retain our 24-worker default instead of the upstream increase to 48. Existing per-site pacing, caps,
`--max 0`, date validation and refusal handling remain intact. Adopt longest-estimated-cost-first
company scheduling without claiming measured throughput improvement.

## Posting identity and pagination

Ten company configurations now extract the terminal TalentBrew posting number, rather than an earlier
organization number in the URL: BLK, CARR, CVX, F, JKHY, KDP, MCO, NTAP, SYF and SNPS. Regression
fixtures demonstrate that two jobs under one organization retain distinct identities.

Historical IDs may already be conflated by the earlier pattern. This merge does not delete, alias or
rewrite historical records. Before future live collection for affected historical companies, audit their
stored IDs and URLs and plan explicit identity repair. Newly corrected IDs must not be interpreted as
organic hiring growth or proof that old identities closed.

Workday stops at the reported total before requesting another repeated page, including runs consisting
entirely of cached records. Cached and fully fetched records both count toward the cap. A missing or
invalid posting cannot turn a count mismatch into a complete inventory.

## Observed validation

- All 48 Python unit tests passed, including 15 new synthetic/offline regressions.
- Cached observation/raw/version preservation, backdated runs, dangling IDs/transaction rollback,
  same-day replacement, full content refresh, duplicate sightings and read-only legacy DB access passed.
- Cached/mixed Workday total/cap behavior, stale sitemap handling across six discovery paths,
  unambiguous identity matching and TalentBrew posting-ID extraction passed.
- Publication check passed for the existing limited 92-posting page.
- Node/V2 application code, source pins, public dataset/store files, tour, web artifacts and workflows
  match the PR #10 base byte-for-byte. No browser/runtime tests were repeated for unchanged applications.
- No live collectors, actual private-history reads, migrations, paid calls or dataset activation were run.
  Database/network behavior was tested only with isolated synthetic fixtures and mocked HTTP.
