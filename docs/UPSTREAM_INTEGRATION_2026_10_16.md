# Upstream integration review — 2026-10-16

Review branch: `integration/upstream-2026-10-16`, starting from our production rollback
`9a9827a458ae01712a40b5d07a5461951a89e950`. Integrates upstream
`2fc50364f3056b1dfa930e8dfeba576a5b28a3c8` with a two-parent merge. Main and production are
not promoted from this review branch.

## Relevance

The two incoming commits are `56b9df9` (career-site collectors/configuration) and `2fc5036`
(generated data refresh). Collector improvements remain useful despite the product diverging:
Greenhouse, Lever, Ashby, iCIMS, Taleo/Business Edition, Avature, TalentBrew, Jobvite and
SmartRecruiters career pages extend potential intake. Existing Workday, Eightfold, SuccessFactors
and shared JSON-LD helpers also receive fixes. The upstream change assigns adapters to 93 more
companies; 63 of the same 499 configured companies still have no adapter. Configured support is
not verified live collection coverage.

Keep the upstream remote and review future synchronization on a separate branch. Our fork owns its
interfaces, release/provenance contracts and private evidence. Ahead/behind counts describe Git
ancestry, not whether upstream code is useful or compatible. This merge records both upstream commits
in ancestry while deliberately retaining our generated publication artifacts.

## Conflict decisions and compatibility

- Retain our README structure, private-history documentation and product/version instructions; add
  the new collector list and this review link. Do not restore the original private-repository workflow.
- Retain `data/Job postings.csv`, `data/data source.csv` and `web/index.html` byte-for-byte from our
  branch. The V1 limited publication remains 92 postings. The upstream generated page cannot replace
  our page or establish a new audited release by an ordinary Git merge.
- Merge collector code and company adapter configuration. Preserve the fork's earlier source-total,
  exhaustion, refusal handling and observation/status rules from automatically merged adapters.
- Retain undated Avature records in inventory; record missing dates instead of dropping the posting.
  Our date charts can exclude them without reducing inventory.
- Detect repeated/missing listing IDs in Lever and Taleo before detail collection. These adapters
  gather list pages before yielding, so the runner's existing duplicate-record check alone cannot
  prevent repeated listing-page loops. Fail visibly with quality counters; do not infer completeness.
- Preserve the PR #7 rollback and PR #8 tour/music asset. No Node or V2 application/store files change
  relative to the production rollback. No collector is run, no API is purchased and no private data
  or descriptions are published by this integration.

## Candidate snapshot audit — not imported

| Metric | Frozen source `7e415fe` | Candidate source `2fc5036` |
|---|---:|---:|
| Unique upstream postings | 86,144 | 114,932 |
| Employers with postings | 310 | 412 |
| Source/config employers | 499 | 499 |
| Overlap with our local 92 | 46 | 56 |
| Union with our local 92 | 86,190 | 114,968 (hypothetical) |

There are 28,846 added IDs and 58 old IDs absent from the candidate. Absence does not establish
closure. The 23 posting CSV headers, 11 source CSV headers and embedded 31-field schema are unchanged.
Embedded posting IDs and shared fields reconcile with the candidate CSV; no new categorical vocabulary
was found. This compatibility audit does not validate collection completeness or automatically approve
all analytical interpretations.

Candidate SHA-256 receipts:

| Artifact | SHA-256 |
|---|---|
| `Job postings.csv` | `cd4255a464421319914d0964b24b932bf448097ec43d089c730db0a2f486a8e5` |
| `data source.csv` | `40fe0bb49e4ceacdff8ebf6e8ab77fe2b4526bf09360f05fa29df3af130d0ea7` |
| `index.html` | `a7c459ff7a1fcfae2bb55252cdadbd5868d792af38a5f444da67ce20c894ba75` |

A future data-refresh change must pin the full candidate commit, audit source dates/provenance and
normalization/pay semantics, regenerate source catalog/seed lineage and sanitized releases, then update
count/hash/export/unknown-value regressions. Changing only input checksums is insufficient. Existing
Node/V2 inputs remain pinned to `7e415fe62d0597e9c6c806bf813b30f8e8c88c98`; the Node dataset remains
`2d18d6d0d99a370a7ebc6a7d0d637cbca917682b504110427727ba76a339041b`.

## Observed validation and limits

- Python unit suite: 33 passed, including five new offline synthetic-fixture checks for configured
  adapters, valid Lever pagination/caps, repeated Lever/Taleo pages and retained undated Avature records.
- Publication check: 92 postings; private fields and paths excluded.
- Published CSV/HTML and Node/V2 runtime/store bytes match production rollback `9a9827a`.
- No live adapter smoke tests or fresh collection were performed. New collector completeness remains
  unknown/partial under the existing conservative quality rules until supporting evidence is obtained.
- Production rollback `9a9827a` separately passed 42 Node tests/build and live API/tour verification.
  The updated tour file matched the merged asset, played beyond one second without errors, and served
  byte ranges with the expected 4,666,919-byte total. These release checks do not validate new collectors.
