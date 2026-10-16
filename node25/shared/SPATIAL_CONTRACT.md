# V2.5.1 spatial semantic API

The existing V2.5 API and its 64 KiB request boundary remain supported. Spatial POST routes accept
at most 128 KiB, strict schemas and the exact current dataset version. No browser SQL, file paths,
raw descriptions or full posting-table downloads are accepted. All responses are no-store.

## Scene

`POST /api/spatial` accepts `protocolVersion: "2.5.1"`, `datasetVersion`, `requestId`, `sourceMode`,
existing bounded `filter`, optional `layoutScope` (default `baseline`), and one lens-specific branch:

| lens | basis | extra fields |
|---|---|---|
| `demand_shelves` | `posting_inventory` | none |
| `coverage_cube` | `posting_inventory` | none |
| `skill_neighborhood` | `recorded_mentions` or `analyzed_text` | `focusSkillId`, optional `support: {minimumCount, minimumShare}` |

The focus anchor chooses graph neighbors; it never adds a skill filter to the matched population.
Default support is max(20, ceil(0.002 × analysis count)). Counts below 20 are restricted to explicitly
selected local source mode, with a minimum of five and a low-support disclosure. Analyzed-text basis
requires known locally analyzed descriptions and local skill provenance; it is not inferred for upstream
records. Return original matched count/hash, analysis count/hash and basis-excluded count separately.

Scene responses carry dataset/source/request identity, metric/spatial/quality method versions,
canonical `queryHash`, normalized `sceneRequest`, exact population counts/hashes, and `data`:

- Demand: complete `cells`, including zero/Unknown/Unclassified category tuples, plus ordered `axes`.
  Each positive cell has a stable ID, occupation label/ID, level, arrangement and distinct count.
- Coverage: all matched `companies`, labeled counts, coverage numerators, pay comparability/diagnostic
  counts and explicit coordinate transforms. A valid non-USD range is not a pay error.
- Skills: at most 40 `nodes` and 120 `edges`. Each edge has both marginals, co-mention count,
  Jaccard and conditional shares. Qualifying node/edge counts before caps remain visible.
- Every lens includes `coverage`, contributor omissions computed as distinct set differences, and
  coordinate metadata distinguishing categorical slots, quantitative axes and non-metric layout.

The scene query hash excludes transport request IDs and includes normalized semantic scope and method
versions. A hash is not authorization; the server validates and reconstructs all predicates. Scene caches
are bounded accelerators, never the sole record of a saved selection.

## Exact selection, paging and export

`POST /api/spatial/selection` accepts `{sceneRequest, sceneQueryHash, selection, page?}`. `page` is
`{offset, limit}`, with at most 100 rows. Selection is one strict branch:

```ts
{kind: 'cell_union', cellIds: string[]} // up to 1,024 registered demand/employer cell IDs
{kind: 'skill_pair', skillIds: [string, string]} // both distinct skills required
{kind: 'skill_set', operator: 'any' | 'all', skillIds: string[]} // up to 40 skills
```

The envelope carries the canonical scene request, so another function instance can reconstruct its
scope. Stale releases, forged IDs and mismatched hashes fail closed. Duplicate IDs never duplicate
contributors. Empty selectors resolve to an empty population. Skill selectors apply only to skill scenes.

Return `matchedCount`, `contributorHash`, dataset/source identity, `sceneQueryHash`, selection and a
bounded public record page. The page is available under `data.records` (with the equivalent flat page
fields retained). Counts and hashes cover every contributor, including records beyond the current page.

`POST /api/spatial/export` accepts the same envelope and streams the existing 37-column allowlisted
CSV. `X-Contributor-Hash`, `X-Dataset-Version` and `X-Export-Rows` reconcile with the selection response.
Spreadsheet formula escaping and backpressure remain in the common export implementation. Interactive
selector resolution has a five-second deadline; the subsequent export streams bounded 1,000-row chunks.

`POST /api/spatial/compare` accepts `{a: selectionEnvelope, b: selectionEnvelope}` for frozen
selections sharing dataset and source mode. Return A/B exact counts/hashes, `overlap`, `onlyA`, `onlyB`.
Independent filters and analysis bases remain part of each envelope. Camera changes cannot alter them.

## Diagnostic meaning and operational bounds

Source pairs count canonical posting identities. Same-calendar-day source availability and known
normalized states permit a declared comparison; this is not exact timestamp equivalence. Raw enums,
observation/reporting basis differences, comparable normalized state disagreements, uncomparable pairs,
recorded date differences and recorded location differences remain separate fields.

The service uses the existing two-active-query / bounded-queue mechanism, five-second interactive
interrupts, a 16-scene cache and a 2 MB scene-response limit. Demand is capped at 1,024 possible cells;
employer scenes reject more than 1,024 groups rather than silently omitting companies. GPU picking only
previews registered marks; authoritative union selection, evidence paging, comparison and export are
server operations. Dataset content and contributor-hash metric remain unchanged from V2.5.
