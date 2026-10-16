# V2.5.1 Spatial Lab implementation

V2.5.1 adds `/spatial` to the independent Node application. It uses the same verified sanitized release
as V2.5: `2d18d6d0d99a370a7ebc6a7d0d637cbca917682b504110427727ba76a339041b`.
No posting collection, private-description publication, employee API or paid service was introduced.
The approved self-hosted tour from PR #5 is inherited by rebasing onto `main` at `0774651`; this build
does not produce an additional video. V2.6 has a [separate design](V2_6_LINKED_3D_DESIGN.md), not runtime features.

## What is implemented

- Demand shelves: all 736 occupation/level/arrangement cells, including zero and unknown categories.
  Default-open population has 462 occupied cells and 82,851 distinct contributors. The complete 2D
  matrix and exact list use the same category identities. Matrix totals across arrangements inspect
  and select the full cell union.
- Employer coverage: all 311 represented employers, with explicit known-country and USD-pay eligibility
  numerators, plus log posting count in 3D. Valid non-USD pay remains distinct from invalid bounds.
  The 46 source-basis differences and zero normalized availability disagreements are separate diagnostics.
- Focused skills: recorded mentions versus explicitly local analyzed-text basis; anchor selection does
  not filter the population. Support, marginals, Jaccard, conditional shares, node/edge caps and omitted
  contributors are disclosed. Empty analysis bases do not fabricate zero-count graph nodes.
- Optional lazy Three.js/R3F rendering, instanced marks, shelf grids, skill links, orthographic camera
  presets, declared axes/category keys, on-demand frames and a complete 2D/keyboard alternative.
- Inspect versus draft versus Apply; stateless validated contributor selection; immutable A/B selectors
  and exact overlap; bounded record paging and the existing 37-column CSV. Isolated-shelf lasso operates
  in a disclosed orthographic 2D plane, including all centers inside the polygon; arbitrary hidden-depth
  3D lasso is not implemented.
- Scene links preserve source, release and scene controls, explicitly excluding frozen cohorts.
  Full-study JSON saves applied selectors and A/B; restoration validates server membership and recomputes
  counts rather than trusting cached client totals. Stale releases fail without retargeting pins.

The [spatial API contract](../node25/shared/SPATIAL_CONTRACT.md) documents strict bounded requests,
source/analysis population semantics, interactive deadlines and export identity. Existing 2.5 endpoints
remain supported. Main catalog protocol remains 2.5; spatial protocol and application health are 2.5.1.

## Renderer decision and measurements

[Renderer study](V2_5_1_RENDERER_STUDY.json): isolated Three.js and deck.gl prototypes used the same
462 actual aggregate cells. Both rendered without page errors in one sequential local headless Chromium
software-WebGL run. Three's core prototype entry compressed to about 130 KB versus deck's 210 KB,
excluding shared data and auxiliary chunks. CPU setup/submission and picking measurements favored this
Three prototype; camera/mark implementations differ and this is not a controlled human/GPU benchmark.
The [reproducible experiment](../research/spatial-renderer-study/README.md) is separate from the runtime.
R3F and the application shell were not included in those core-renderer figures.

[Local API measurements](V2_5_1_API_MEASUREMENTS.json) disclose warm-process/cache conditions and
offline gzip sizing. They are not production cold-start or p95 evidence. The actual application observed
no additional WebGL draw calls during a 1.2-second idle interval after its initial scene had settled;
this does not establish physical mobile frame rate or energy performance.

## Acceptance limits

Keep 2D as the default. No human task study, physical mobile/GPU benchmark, thermal test, whole-browser
memory profile or general proof that 3D improves analysis has been completed. The proposed 6–8 participant
study remains a product evaluation gate. No UMAP, embedding model, geographic reconstruction or 3DGS is
implemented. This posting snapshot cannot establish employee supply, hiring outcomes or market-wide trends.

Umami remains the optional open-source analytics adapter. No Vercel Analytics or additional tracking is
introduced by Spatial Lab. Its persistent analytics service remains unconfigured as documented for V2.5.
Private data stays outside public artifacts; spatial calls use only the existing public-field store.

## Release boundary

Implementation is isolated on `feat/v2.5.1-spatial-lab`. The existing V2 and V2.5 production deployments
are preserved; preview publication is the validation target. Do not promote the branch onto the V2.5
production project while calling it an independent preserved baseline. A later release decision must
choose a separate project/domain or explicitly authorize replacing that baseline.

Recovery for an isolated preview means reverting to the previously validated Git SHA; it does not alter
V2/V2.5 production aliases. Revert semantic handlers and UI together if selection identities change.

## Verified build and release evidence

Runtime commit `aa5c7ef525fda6b54e5b83365842cd1da234140e` is based on the deployed tour merge
`0774651134010cd3c3a1e825609c7f04c8747749`. The [CI run](https://github.com/liyue2055/jobmarket-lens/actions/runs/38951198614)
passed 42 Node tests, TypeScript/build and all 18 browser scenarios with no flaky retry. Preserved V2
and publication checks also passed. A context-loss startup race was fixed by capturing the native
non-bubbling event from the already-mounted parent; its focused test additionally passed three consecutive
local runs with retries disabled. An earlier pointer-event lifecycle bug in lasso was reproduced and
fixed; the end-to-end case now resolves the complete shelf and exact contributor count.

The [production-build measurement receipt](V2_5_1_BROWSER_MEASUREMENTS.json) records the measured
source revision and limits. Optional renderer gzip is 255,557 bytes (249.6 KiB); ordinary canvas and
2D Spatial Lab entry did not request it. No extra draws occurred during the measured idle interval,
390 px document width matched the viewport, and no page errors were observed. The native Node server
now streams video ranges with media/caption MIME types, matching the Vercel deployment behavior.

[Authenticated preview checks](V2_5_1_PREVIEW_CHECKS.json) verify native Node/DuckDB scene queries,
rendered Spatial Lab and the inherited tour. Preview access uses existing Vercel authentication;
production protections were not disabled. The feature remains separate from public V2/V2.5 aliases.

Actual captures: [desktop 3D](v251-spatial-desktop.png), [focused skills](v251-spatial-skills.png),
[mobile 2D](v251-spatial-mobile.png). They show public snapshot fields only.
