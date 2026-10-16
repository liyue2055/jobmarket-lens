# V2.5.1 — spatial analysis and evidence design

Design for review, 2026-10-16. The user's “3d.js” is interpreted as **Three.js or a comparable browser
visualization library**. This document authorizes no implementation, dependency installation, paid
service or production replacement. V2 remains at `jobmarket.feedos.si`; the completed Node V2.5 remains
at `lens.feedos.si`. V3 profiles/APIs and the video team's future PR remain separate.

[Concept board](v2-5-1-spatial-analysis.svg) · [read-only data audit](V2_5_1_DATA_AUDIT.json) ·
[V2.5 implementation evidence](V2_5_BUILD_REPORT.md).

## Product decision

Add an optional **Spatial Lab**, sharing the Node semantic API and cohort/evidence model. Prototype
**Three.js with React Three Fiber** for bounded aggregate scenes. Compare it with **deck.gl OrbitView**
before selecting the renderer. Keep the existing 2D research canvas and an equally capable table/matrix
for every new lens. A renderer does not establish better analysis; task accuracy and completion must.

The intended improvement is seeing conditional structure across several recorded dimensions, checking
where evidence is missing, and tracing any apparent pattern to exact posting contributors. This is a
visualization extension over V2.5's data virtualization. It does not move the full posting table back
into the browser, create new market coverage, or infer employee supply.

| Question | Planned lens | Equal-data 2D comparison |
|---|---|---|
| How do occupation, reported level and arrangement intersect? | Demand shelves | Four arrangement matrices / sortable cell list |
| Where is volume high while location/pay evidence is limited? | Coverage cube | Three linked scatterplots and an issue table |
| Which recorded skills co-occur in this selected population? | Focused skill neighborhood | Exact co-mention matrix and ranked pair list |

These are hypotheses to test, not findings that 3D is superior. Camera motion, hidden marks and
perspective can make comparison harder. Initial release defaults remain 2D until evaluation supports
changing them. No animated 86,190-posting galaxy, decorative globe or 3D Gaussian Splatting is proposed;
this dataset is structured posting metadata, without the image/camera inputs of a reconstruction task.

## Existing evidence and constraints

Node dataset: `2d18d6d0d99a370a7ebc6a7d0d637cbca917682b504110427727ba76a339041b`.
The coordinator independently queried its verified sanitized store; no collection or embedding was run.

| Population | All reported statuses | Default reported/observed open |
|---|---:|---:|
| Distinct postings | 86,190 | 82,851 |
| Employers represented | 311 | 311 |
| Locally analyzed description basis | 92 | 92 |
| Eligible validated USD pay | 28,246 | 27,284 |
| Unknown country | 23,711 | 23,145 |
| Unknown arrangement | 46,916 | 44,903 |

All-status data has 23 occupation IDs, eight level buckets, four arrangement buckets and 1,324 postings
with no recorded skills. Unknown level contains 24,192 records; keep it visible. SOC `00` remains
Unclassified. Empty skill arrays and unknown description coverage do not demonstrate absence of skills.
The source is a snapshot with uneven employer coverage, not a probability sample of the labor market.

**A required interpretation fix:** all 46 overlapping source pairs differ in raw availability enum:
`local_observed` versus `upstream_reported_open`. Both normalize to open, giving **zero normalized
availability disagreements** in those pairs. There are also seven recorded date-group differences and
six location-group differences, which are not automatically errors. Preserve raw V2 parity fields;
derive a separately versioned diagnostic classification rather than silently rewriting the snapshot.

## Renderer assessment

| Option | Verified capability | Fit and decision |
|---|---|---|
| Three.js | Instanced geometry, cameras and raycasting with instance identities | Preferred custom-scene prototype; analytical axes, selection and accessibility remain our responsibility |
| React Three Fiber | React integration, on-demand frames, reusable scene resources | Thin integration layer for the existing React app; no separate metric engine |
| deck.gl | Data layers, non-geographic OrbitView, orthographic camera and picking | Benchmark alternative if declarative data layers reduce implementation/interaction cost |
| 3d-force-graph | Three.js graph rendering and force-layout controls | Focused skill experiment only; simulation geometry is not a measured skill distance |
| Existing HTML/SVG/2D charts | Exact labels, semantic controls and readable matrices | Authoritative inspection/export baseline and complete fallback |

Three.js `InstancedMesh` reduces repeated-geometry draw calls. R3F can render only when the scene or
camera changes; neither documentation is proof of our frame rate or memory use.
[Three instancing](https://threejs.org/docs/pages/InstancedMesh.html),
[R3F performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance).

`OrbitView` supports non-geospatial inspection and orthographic projection. Use one renderer for a
lens, not two simultaneous WebGL stacks. GPU filtering/picking may help preview already-returned marks;
server contributor resolution remains authoritative. In particular, deck.gl's categorical GPU filter
has finite category limits, so it cannot silently represent arbitrary employer selections.
[OrbitView](https://deck.gl/docs/api-reference/core/orbit-view),
[DataFilterExtension limits](https://deck.gl/docs/api-reference/extensions/data-filter-extension).

The TensorFlow Embedding Projector is an adjacent high-dimensional visualization reference; its
standalone repository is archived, so it is not proposed as a new production dependency.
[Projector](https://projector.tensorflow.org/),
[archived standalone repository](https://github.com/tensorflow/embedding-projector-standalone).

Pin compatible Three/R3F/React versions only during an approved prototype. Current Three WebGLRenderer
requires WebGL2. WebGPU is a later compatibility experiment, not a launch requirement.
[WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html).

## Lens A: demand shelves

**Default analytical grain:** one distinct-posting aggregate per occupation × level × arrangement,
over all selected employers. Current maximum is `23 × 8 × 4 = 736` category cells. Include Unknown
level/arrangement and Unclassified occupation; empty cells are zero only after the server completes a
full query. The union of cells must cover every matched posting exactly once.

- X slots: occupation categories, with visible labels and stable order.
- Y slots: source-reported level categories; their positions are categories, not inferred numeric seniority.
- Z shelves: Remote, Hybrid, On-site, Unknown. Shelf spacing has no quantitative meaning.
- Glyph **screen area**: posting count, using a square-root radius mapping, common scale and exact labels.
  Prefer flat billboard discs to ambiguous sphere volume. Any size cap is disclosed.
- Outline/annotation: current selection and A/B state; do not encode evidence confidence as point size.
- Evidence rail: arrangement/level unknowns, pay eligibility and source/text basis for the selected cells.

Start with all 736 possible cells and only occupied glyphs; do not default to a top-employer slice that
hides most of the inventory. Employer focus is an explicit filter. Any future mark cap returns shown,
qualifying, omitted and represented-posting totals; a zero-looking gap must not mean “not rendered.”

Use orthographic projection, shelf isolation and front/top/side presets. The default overview lets
people see the three categorical relationships; exact comparison uses one shelf, a cell list or 2D
small multiples. Selecting a shelf does not itself change cohort membership until Apply.

Example task: isolate Remote, compare two occupation/level cells, pin A and B, and inspect differences
with exact counts, denominators and overlap. This is a snapshot comparison, never movement over time.

## Lens B: coverage and issue investigation

**Grain:** one employer aggregate in the active population, at most 311 for this snapshot. All employers
with contributors appear; catalog employers with no matched posting remain in an explicit empty list.
Use clearly quantitative axes:

- X: postings with at least one known country / employer matched postings.
- Y: validated USD-pay-eligible postings / employer matched postings.
- Z: employer posting count, on a labelled `log1p` scale with raw counts in focus/table.

A country-known numerator counts a multi-location posting once. USD eligibility is comparison coverage,
not a universal pay-quality score: a valid EUR range is not an error. Provide raw range presence,
known currency, valid non-USD and actual invalid-bound flags separately in the evidence rail.
Use one documented issue-class color at a time, with text/pattern equivalents; no unexplained combined
“trust score.” Zero denominator is unavailable, never zero coverage or an invented coordinate.

Issue classes must stay distinct:

| Class | Meaning / denominator |
|---|---|
| Unknown coverage | Field not established; matched postings as denominator |
| Evidence-basis difference | Same normalized state, different observation/reporting basis; comparable source pairs |
| Semantic state disagreement | Different normalized states after checking as-of comparability; comparable pairs, with exclusions stated |
| Recorded value difference | Dates/locations differ before semantic adjudication; paired records with comparable fields |
| Invalid supported value | A concrete validation failure; records with sufficient native fields to evaluate the rule, including failures |

Date-only versus timestamp precision, first-observed versus posted date, and city versus country
precision can explain differences. Different observation dates may represent a change rather than a
contradiction. Do not classify a source as wrong merely because values differ. Unverified cases remain
“needs review,” linked to public metadata; raw/private descriptions stay private.

Required regression: the current 46 raw status differences yield 46 basis differences and zero
normalized availability disagreements. None become 46 hiring problems or missing employees.

## Lens C: focused recorded-skill neighborhood

Choose the neighborhood anchor using a separate `focusSkillId`, which does not change the analytical
population. Applying a skill filter is a separate explicit action. Show a bounded neighborhood, initially at most 40 nodes
and 120 edges. Keep broad skills visible unless the user explicitly filters them; Communication and
Collaboration are common recorded categories, not automatically technical specializations.

Let `Q0` be the existing posting filter result. Demand/coverage use `posting_inventory` and keep Q=Q0.
For skills, `recorded_mentions` also keeps Q=Q0; `analyzed_text` explicitly restricts Q to Q0 records
with `hasDescription=true`. Return both matched Q0 count/hash and analysis-population Q count/hash, plus
basis-excluded counts. An upstream analyzed-text request is an unavailable/empty observed basis, not
evidence that upstream postings have no skills. For skill population `Q`, let `a`, `b` be distinct postings recording each skill and `m` record both.
Return support `m`, marginal counts, `Jaccard=m/(a+b−m)` and both conditional shares `m/a`, `m/b`.
All use the same source mode, release and chosen observation basis. Recorded-mention share uses
`a/|Q|`; an analyzed-description-only analysis must explicitly restrict Q to the known analyzed basis
and report exclusions. Neither supports treating unknown upstream coverage as negative skill evidence.

Proposed default support: `max(20, ceil(0.002 × |Q|))`, explicitly displayed. Local-only users may opt
into minimum five with a low-support label; never automatically lower a threshold to populate a chart.
As a global top-40/all-status benchmark, 681 pairs qualify at support 173; showing 120 in that
specific scope requires “120 of 681 qualifying edges.” This is not the count for an arbitrary focused
neighborhood: compute qualifying/shown totals afresh for each anchor and request. Omitted edges are
not absent relationships. Omitted posting contributors are `Q minus union(shown-mark contributors)`,
counted distinctly; report them separately from omitted-edge totals, never by summing overlapping supports.

Node count and edge support are data; force-layout distance is a display arrangement. Freeze a seeded
layout within the dataset/mode/layout scope and show exact metrics on focus. A/B comparisons share the
same coordinate frame. Do not infer career transitions, hiring competition or causal relationships.
Force-graph simulation should settle without disabling interaction; its animation and simulation controls
need separate handling. [3d-force-graph API](https://github.com/vasturiano/3d-force-graph).

UMAP/employer similarity is deferred behind a separate validity gate. If later tested, use aggregated
recorded-skill profiles with feature definitions, coverage exclusions, fit scope, seed and preprocessing
versions. Compare a simple PCA and 2D baseline; report feature-space neighbor preservation, seed
sensitivity and loadings where applicable. A spatial cluster is not a labor shortage. UMAP documentation
warns about density distortion and artificial splits, and the JS implementation documents differences
from the reference implementation.
[UMAP cautions](https://umap-learn.readthedocs.io/en/latest/clustering.html),
[UMAP-JS](https://github.com/PAIR-code/umap-js).

## Interaction and contributor semantics

The layout keeps existing filters/source/release context at the top, a spatial scene in the center and
a persistent evidence/selection rail. Controls: 2D/3D, lens, isolate shelf, inspect/select, camera presets,
reset, A/B and exact export. Hover previews only; Apply commits a selection. No automatic camera spin.

1. **Inspect:** click/tap or keyboard-select a glyph; show its count, numerator/denominator, source basis
   and exact public contributor page. An occlusion list exposes overlapping glyphs.
2. **Select:** camera movement is disabled. Initial lasso works only on a named isolated orthographic
   shelf. It selects glyph centers on that plane, including hidden centers only if the disclosed mode
   explicitly includes them. Use complete aggregate buffers, not whatever a GPU picker happens to return.
3. **Commit:** the server resolves the union of selected cell contributor predicates, counts distinct
   IDs and returns its contributor hash. Skills-edge selection requires both skills; multi-node selection
   offers explicit ANY/ALL semantics. Overlapping groups never sum into a false posting total.
4. **Compare/export:** pins preserve dataset, mode, metric and selection definitions. The analysis basis is part of a pin/selector, including the analyzed-text restriction. Camera/layout
   changes never alter membership. The record page and 37-column CSV resolve the same contributor set.

Current V2.5's 32-item flat filters cannot express arbitrary unions of hundreds of three-way cells.
Introduce a new validated selector contract; do not squeeze that selection into an existing skill-ALL
filter or raise every limit blindly. Client SQL, file paths and arbitrary expressions remain prohibited.

Three raycasting returns instance IDs that can map to stable aggregate identities. deck.gl rectangle
picking is neither polygon lasso nor a guarantee of every hidden object's membership.
[Raycaster](https://threejs.org/docs/pages/Raycaster.html),
[Deck picking](https://deck.gl/docs/api-reference/core/deck).

## Node semantic extension: proposed contract

The following is a proposal, not an existing endpoint:

```ts
type SpatialScope = {
  protocolVersion: '2.5.1'; datasetVersion: string; requestId: string;
  sourceMode: 'combined' | 'upstream' | 'local';
  filter: ExistingBoundedFilter; layoutScope: string;
};
type SpatialRequest = SpatialScope & (
  | { lens: 'demand_shelves' | 'coverage_cube'; basis: 'posting_inventory' }
  | { lens: 'skill_neighborhood'; basis: 'recorded_mentions' | 'analyzed_text';
      focusSkillId: string; support: { minimumCount: number; minimumShare: number } }
);
type Selection =
  | { kind: 'cell_union'; cellIds: string[]; sceneQueryHash: string }
  | { kind: 'skill_pair'; skillIds: [string, string] }
  | { kind: 'skill_set'; operator: 'any' | 'all'; skillIds: string[] };
```

Strict schemas bound aggregate cells to 1,024, nodes to 40 and edges to 120 initially. A bounded new
selection resolver verifies every cell ID against its release/mode/query and translates registered
category tuples into fixed bound SQL templates. It returns normalized selectors/contributor identity
suitable for share state; no browser-local opaque reference is the sole persistent selection definition.
A crafted stale/mismatched cell ID fails closed. Proposed caps are 1,024 cell IDs or 40 skill IDs,
with a 128 KiB selection-envelope byte limit. Existing V2.5 request limits remain unchanged. The
envelope carries the canonical scene request as well as its hash, so another function instance can
reconstruct and verify cell predicates without relying on a process-local cache. Exact schemas freeze
before implementation, including explicit oversized/expired selection errors.

Return release/metric/quality-method versions, query hash, matched/eligible/unknown counts, full versus
shown group counts, omitted contributors, completion status and cells/nodes/edges. Coordinate metadata
includes kind (`categorical`, `quantitative`, `layout`), category order, axis transforms/units, fitting
scope, algorithm/version and seed. Stable cell identity includes its category tuple and semantic basis;
render instance indices are temporary lookup indices, never source identities.

Precompute small validated aggregate/diagnostic relations in Node, or query the existing sanitized
Parquet tables through the bounded service. Diagnostic pair joins count canonical IDs and require
comparable source variants. Activate derived method/cache versions together; no user gesture polls job
sites. JSON remains the initial transport. New endpoints and renderer chunks are lazy and cannot add
payload to ordinary V2.5 canvas loads.

## Rendering, accessibility and brand

Use the V2.5 navy/teal/mint/amber identity. Reserve amber for disclosed caution/comparison and always add
labels/patterns; a red-looking mark must not manufacture a claim of an invalid employer or posting.
Prefer outlines and shelf isolation over stacked transparency, which has documented sorting problems.
[Three transparency](https://threejs.org/manual/pages/transparency.html).

Use shared buffers/instancing, bounded labels, fixed pixel-density caps and on-demand rendering. Dispose
scene resources on route changes. No continuous force simulation, shadows, bloom or particle effects
are required. Preserve scene/query state on WebGL context loss and offer the same 2D evidence view.
No renderer error should discard pins or prevent export.

Every analytical action must be available through semantic controls and a keyboard-operable cell/pair
list. Camera buttons expose names/state; Escape cancels selection and restores focus. Mobile starts
in 2D, with optional 3D and large touch controls. Honor reduced motion. Accessibility checks must include
focus order and task completion, not only a canvas description. Detailed hover text has a focus/tap path.

Umami remains optional open-source product telemetry. If configured later, permit only a fixed public
Spatial Lab route event. Never record camera traces, lasso geometry, filters, selected employer IDs,
search terms or admin activity. Product visits are not evidence of job demand. No new analytics host,
employee profile collection, paid API or video embed is part of this design.

## Delivery and acceptance

| Phase | Work package | Gate |
|---|---|---|
| D0 | Freeze questions, definitions, 46-pair diagnostic regression and full-population aggregates | Counts/unknowns and diagnostic meanings reviewed |
| D1 | Three/R3F and deck.gl bounded prototypes using identical cells | Choose one with measured interaction, bundle and maintenance evidence |
| D2 | Demand shelves + equal-data 2D/list + exact selection resolver | All cells partition the population; selection/page/export hashes reconcile |
| D3 | Coverage cube and focused skills + disclosure of omissions | Unknown/valid-non-USD/basis differences never mislabeled as errors |
| D4 | Keyboard/touch, WebGL failure, sharing, mobile and resource cleanup | Same tasks possible without WebGL; no lost pins or hidden contributors |
| D5 | Counterbalanced user tasks and staged release | Keep optional 3D only where it adds task value; preserve V2/V2.5 baselines |

Proposed budgets, not measurements: no extra 3D bytes before opt-in; at most 250 KiB compressed
incremental renderer code and 150 KiB compressed scene data for the initial aggregate lens; 30 fps during
interaction on declared test devices; no continuous frames at idle; at most 50 ms picking response and
500 ms warm committed-selection response on a stated desktop/network profile. Measure GPU/context,
whole-browser memory, cold service and thermal/mobile behavior separately. If a budget fails, simplify
marks or use 2D; do not silently remove analytical contributors.

Use all three source modes, empty selections, Unknown categories, multi-location/skill overlap and
sparse local populations. Verify counts, pair marginals, ANY/ALL, contributor hashes, all-page exports,
stale requests, release mismatch, viewport changes and keyboard focus. Test model stability separately
if an optional embedding is later introduced. None of these V2.5.1 tests have been run yet.

User study: propose 6–8 participants spanning novice and experienced analysts, counterbalance view order,
and compare 3D with the same 2D/list data. Tasks: find an arrangement difference, identify unknown
coverage, correctly interpret the 46 basis differences, recover contributors and compare overlapping
cohorts. Record errors, unsupported conclusions, completion time, selection mistakes and confidence.
Proceed only with no accuracy/accessibility regression and clear task benefit; otherwise retain the
2D version and record the experiment. Small studies do not establish population-wide significance.

Implementation would use a new feature branch and preview, leaving both current public versions intact.
Release app, derived aggregate/method versions and scene metadata together; recovery restores the whole
known-good deployment. Design review is the current deliverable. No 3D application code or dependency
has been added by this work.
