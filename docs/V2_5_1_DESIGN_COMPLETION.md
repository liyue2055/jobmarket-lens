# V2.5.1 design completion

Implementation branch: `feat/v2.5.1-design-completion`, based on `main` at `6bb8f91`
after the original Spatial Lab PR #6 was merged. This completes concrete D2–D4 gaps in the
[approved design](V2_5_1_3D_ANALYSIS_DESIGN.md); the initial
[build report](V2_5_1_BUILD_REPORT.md) remains a historical receipt.

## Reviewable behavior

| Design requirement | Implementation and analytical meaning |
|---|---|
| Demand small multiples | Four arrangement panels retain every occupation/level slot, Unknown and actual zero cells. Shared square-root glyph scale and exact counts allow comparison without camera occlusion. Combined matrix remains available. |
| Sortable exact groups | Source order, count and label sorting retain stable group IDs and existing drafts. Sorting does not filter the population. |
| Linked coverage projections | Country-known share × USD eligibility, country-known share × log1p count, and USD eligibility × log1p count show all represented employers with common mark area. Raw counts and transforms are labeled. |
| Coverage evidence | Full employer table distinguishes raw ranges, known currency, valid non-USD, USD eligibility, assessable/invalid bounds, suspicious values and source-pair diagnostics. Local table search does not filter the projections or cohort. Empty employers remain explicit. |
| Exact co-mention baseline | Complete matrix for the displayed skill nodes, including real zeros, below-threshold pairs and graph-omitted pairs. Ranked list pages all pairs, sorted by support, Jaccard or label. The graph remains capped and its omissions stay disclosed. |
| Inspection before filtering | Explicit inspection retrieves up to five public contributing records without changing an applied cohort or pins. Draft and Apply remain separate actions. Hover previews do not query posting records. |
| Diagnostic contributors | Seven fixed diagnostic selectors reuse exact paging, contributor hashes, comparison and 37-column CSV export. Denominators and unavailable counts remain visible. No arbitrary posting-ID lists or SQL enter the API. |
| Hidden marks and camera | Billboard discs encode count by area. Native raycasting exposes all intersected instances in an exact overlap list. Camera presets show active state, manual interaction reports custom state, and Reset restores target, position and zoom. |
| Keyboard/mobile/fallback | Semantic panels, matrix, lists and tables support the same contributor tasks in 2D. Escape cancels drafts and returns focus. Optional 3D, context-loss recovery, release validation and frozen cohorts remain supported. |

The skill matrix is exact **within its displayed-node scope** (at most 40 nodes, 780 pairs), not a
claim that every skill in the catalog is shown. It uses the selected analysis basis and its denominator.
A pair omitted by the graph can still have positive support. Graph distance remains non-metric.

## Diagnostic interpretation

On the all-status combined population there are 46 overlapping source pairs: 46 evidence-basis
differences, zero normalized availability disagreements, seven recorded date differences among 46
comparable pairs, and six recorded location differences among 38 comparable pairs (eight unavailable).
Recorded differences are not adjudicated errors. Classes overlap and must not be added into a score.

There are zero invalid-bound flags among 29,350 assessable records; 56,840 records cannot be assessed
for that rule. Unknown country (23,711/86,190) and arrangement (46,916/86,190) remain missingness,
not evidence of invalid values. Employer attribution follows the active source-mode record.

The original dataset, scene identities and contributor-hash method remain unchanged. Matrix metadata
is additive with method `exact-shown-node-pairs-v1`. The
[API contract](../node25/shared/SPATIAL_CONTRACT.md) documents the new payloads and strict selectors.

## Validation and release gate

See [completion measurements](V2_5_1_COMPLETION_MEASUREMENTS.json) for observed local payload and
production-bundle sizes, lazy-loading and idle-render checks. These are local observations, not CDN,
production p95 or physical-device measurements. The renderer is close to its proposed 250 KiB gzip
limit; future dependencies require a new measurement. Vite still warns about the large raw renderer
chunk, which remains lazy and opt-in.

The pinned sanitized store remains
`2d18d6d0d99a370a7ebc6a7d0d637cbca917682b504110427727ba76a339041b`:
86,190 combined postings, 86,144 upstream, 92 local and 46 overlapping identities. No new data intake,
profiles, paid API calls, private descriptions or tracking were added. Umami remains unconfigured;
visitor counts are unavailable until its service is provisioned.

D5 remains an evaluation gate: no human task study or physical-device fps, thermal or whole-browser
memory study has been completed. Keep 2D as default. The
[user-study protocol](V2_5_1_USER_STUDY_PROTOCOL.md) defines the remaining work without inventing
participant results. V2.6 and V3 remain separate designs.

This branch targets an isolated preview and PR. Current production versions are preserved during this
completion work. Merging onto `main` can update the Node production application through Vercel; review
and promotion must account for that integration.
