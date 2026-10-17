# Pulling the 114,932-posting upstream snapshot

Status: the staging audit below is historical. The 2026-10-17 activation for Pages and Node
is described in [the release note](POSTING_RELEASE_2026_10_17.md). React V2 stays frozen.

## Verified source and counts

The author's public [posting CSV](https://github.com/yimizhao2015/jobmarket-lens/blob/2fc50364f3056b1dfa930e8dfeba576a5b28a3c8/data/Job%20postings.csv),
[source CSV](https://github.com/yimizhao2015/jobmarket-lens/blob/2fc50364f3056b1dfa930e8dfeba576a5b28a3c8/data/data%20source.csv)
and [embedded dashboard data](https://github.com/yimizhao2015/jobmarket-lens/blob/2fc50364f3056b1dfa930e8dfeba576a5b28a3c8/web/index.html)
provide the normalized public inventory. The author's private SQLite/history repository is not required
and was not accessed. No employer collection, subscription, paid API or employee-profile intake was run.

| Scope | Postings | Employers |
|---|---:|---:|
| Upstream, all reported statuses | 114,932 | 412 |
| Upstream, reported open | 110,606 | Not recomputed for this staging audit |
| Upstream, reported closed | 4,326 | Not recomputed for this staging audit |
| Retained local observations | 92 | 7 |
| Prospective deduplicated combined inventory | 114,968 | 413 |

There are 56 identities shared with our local observations. Thus `114,932 + 92 − 56 = 114,968`.
The original's 114,932/412 can be reproduced by choosing **upstream + all statuses** after a later
release activation. Our default open/combined scope will have different totals and must remain labeled.

Commit `2fc50364f3056b1dfa930e8dfeba576a5b28a3c8` has source-release timestamp
`2026-10-16T22:26:25Z`; this is not the collection time of every posting. Retain each source's recorded
dates and local observation times. Relative to the frozen upstream release: 28,846 added IDs and 58
absent IDs; absence alone does not establish closure or a hire.

The [aggregate pull receipt](UPSTREAM_CANDIDATE_PULL_2026_10_16.json) contains hashes, byte lengths,
counts and reconciliation results, without posting rows or private descriptions. All 114,932 CSV IDs,
shared fields and open-status flags reconcile with the typed payload; 499 source rows reconcile with
the employer posting totals. There were zero rejected rows and zero source-count discrepancies.

## Reproducible Node pull

From this repository, using Node 22.20.0:

```sh
npm --prefix node25 run data:pull-candidate
```

It stages approximately 58 MB of source artifacts beneath ignored
`.private/upstream-candidates/2fc50364f3056b1dfa930e8dfeba576a5b28a3c8/` and writes
`candidate-report.json` there. Cached files are rehashed on every run. To verify existing staging
without any network fallback:

```sh
npm --prefix node25 run data:pull-candidate -- --offline
```

An explicit audited candidate can be selected with `--commit FULL_SHA`. The checked-in
[source-candidate registry](../node25/scripts/source-candidates.json) admits only reviewed full commit
SHAs with fixed artifact hashes/sizes, expected populations and native schema. It never fetches moving
`main` and silently trusts its contents. Future snapshots require another audit/registry entry.
Unknown candidates, changed bytes, rejected rows, incompatible schemas, inconsistent CSV/native records,
public output paths and symlink redirects fail closed. HTML scripts are never executed. Intake is
bounded to the audited artifact lengths and decoded payload size. Staging does not create a consumable
published-release manifest or update an application's source pin.

The private receipt cannot authorize itself. Any later consumer must select an audited source entry and
rehash the actual bytes. The existing `data:import` command still targets the old production pin; it
must not be mistaken for the new candidate pull or bypassed by simply editing one checksum.

## Activation work for a follow-up release

1. Make the V2 and Node importers accept an explicitly selected audited source entry while retaining
   the old entry. Verify commit, hashes, sizes, schema, source timestamp and cross-file correspondence
   from trusted configuration; do not trust mutable intake-report claims alone.
2. Preserve the sanitized local seed's 92 observations and their dates/provenance. The V2 exporter
   currently uses private SQLite or no local data; add an explicit sanitized-seed route so a build does
   not require private descriptions or drop local observations. Rebuild source catalogs/lineage for
   the new upstream commit rather than relabeling the existing seed as a new release.
3. Normalize the new inventory with the existing strict public-field schema. Keep unknown upstream
   description coverage explicit. Reconcile typed native pay bounds/period before recovering currency;
   CSV dollar signs and geographic location cannot prove USD. The receipt's native currency counts
   are not validated USD eligibility counts.
4. Generate new versioned V2 shards and Node Parquet/release metadata with new semantic dataset IDs.
   Keep historical release evidence, local provenance and recovery artifacts intact. Independently
   recompute pay eligibility, unknown coverage, overlap and source-pair diagnostics; do not blindly
   replace the old overlap count in existing assertions.
5. Close the spatial scene-link compatibility gap before activation: its current mismatch handler
   notices an old release but can query the current release using restored filters. Require an explicit
   fresh-start action. Existing Studio/study restoration already rejects mismatched releases; retain
   those protections. Never silently retarget saved cohorts or compare across dataset versions.
6. Validate strict projections, exact populations, default/open source scopes, exports/contributor
   hashes, all-page evidence, stale links and full studies. Measure the larger release's request and
   deployment sizes, then produce an isolated preview for review.
7. Promote the reviewed release together with its source metadata and restore the prior full release
   on rollback. A subsequent deployment request can activate it. The current tour remains a clearly
   labeled recording of the earlier dataset; its transcript must not acquire unrecorded new figures.

A later automation can discover newer upstream commits and open candidate-refresh PRs. Keep source
review and release validation before activation; do not let an unattended pull change production data.

## Validation observed this turn

The public artifacts were fetched successfully and then independently revalidated from cached files in
offline mode. All 48 Node tests passed. Six new offline tests cover exact unions, integrity failures, cross-artifact mismatches,
invalid populations/duplicate IDs, unknown commits/public paths, and symlink escapes. Existing published
V1/V2/Node artifacts, source constants, application code, tour and production deployment remain unchanged.
