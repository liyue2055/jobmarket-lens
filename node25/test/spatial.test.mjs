import test from "node:test";
import assert from "node:assert/strict";
import { parse as parseCsv } from "csv-parse/sync";
import {
  spatialScene,
  spatialSelection,
  spatialCompare,
  exportSpatialCsv,
} from "../server/spatial.mjs";
import { load, query, Request } from "../server/query.mjs";
import { readFile } from "node:fs/promises";
const ctx = await load();
const metrics = JSON.parse(
  await readFile(new URL("./fixtures/release-metrics.json", import.meta.url), "utf8"),
);
assert.equal(ctx.release.datasetVersion, metrics.datasetVersion);
const req = (extra = {}) => ({
  protocolVersion: "2.5.1",
  datasetVersion: ctx.release.datasetVersion,
  requestId: "spatial-test",
  sourceMode: "combined",
  filter: { availability: "all" },
  lens: "demand_shelves",
  basis: "posting_inventory",
  ...extra,
});
const envelope = (scene, selection, page) => ({
  sceneRequest: scene.sceneRequest,
  sceneQueryHash: scene.queryHash,
  selection,
  ...(page ? { page } : {}),
});
const legacy = (extra = {}) => ({
  protocolVersion: "2.5",
  requestId: "legacy-reference",
  sourceMode: "combined",
  view: "overview",
  filter: { availability: "all" },
  ...extra,
});

test("full-size shelves preserve all modes and a complete unknown-inclusive partition", async () => {
  for (const [mode, population] of Object.entries(metrics.populations)) {
    const scene = await spatialScene(req({ sourceMode: mode }));
    assert.equal(scene.matchedCount, population.postings);
    assert.equal(
      scene.data.cells.reduce((n, c) => n + c.count, 0),
      population.postings,
    );
    assert.equal(scene.data.coverage.omittedContributors, 0);
    assert.equal(
      new Set(scene.data.cells.map((c) => c.id)).size,
      scene.data.cells.length,
    );
    assert.ok(scene.data.axes.levels.includes("Unknown"));
    assert.ok(scene.data.axes.arrangements.includes("Unknown"));
    if (mode === "combined") assert.equal(scene.data.cells.length, 736);
    const old = await query(legacy({ sourceMode: mode }));
    assert.equal(scene.contributorHash, old.contributorHash);
  }
  assert.equal(
    (await spatialScene(req({ filter: {} }))).matchedCount,
    metrics.populations.combined.open,
  );
});
test("complete multi-cell selection, duplicate cell IDs and pages preserve exact contributor identity", async () => {
  const scene = await spatialScene(req());
  const all = await spatialSelection(
    envelope(scene, {
      kind: "cell_union",
      cellIds: scene.data.cells.map((c) => c.id),
    }),
  );
  assert.equal(all.matchedCount, metrics.populations.combined.postings);
  assert.equal(all.contributorHash, scene.contributorHash);
  assert.equal(all.data.rows.length, 100);
  const cells = scene.data.cells.filter((c) => c.count).slice(0, 2);
  const selected = await spatialSelection(
    envelope(scene, {
      kind: "cell_union",
      cellIds: [...cells.map((c) => c.id), cells[0].id],
    }),
  );
  assert.equal(
    selected.matchedCount,
    cells.reduce((n, c) => n + c.count, 0),
  );
  assert.ok(
    selected.data.rows.every((r) =>
      cells.some(
        (c) =>
          c.occupationId === (r.occupationId ?? "Unknown") &&
          c.level === (r.level ?? "Unknown") &&
          c.arrangement === (r.arrangement ?? "Unknown"),
      ),
    ),
  );
  const empty = await spatialSelection(
    envelope(scene, { kind: "cell_union", cellIds: [] }),
  );
  assert.equal(empty.matchedCount, 0);
});
test("semantic hashes normalize filter order and exclude transport request IDs", async () => {
  const a = await spatialScene(
    req({
      filter: { companyIds: ["NVDA", "AMZN", "NVDA"], availability: "all" },
    }),
  );
  const b = await spatialScene(
    req({
      requestId: "other",
      filter: { availability: "all", companyIds: ["AMZN", "NVDA"] },
    }),
  );
  assert.equal(a.queryHash, b.queryHash);
  assert.equal(a.contributorHash, b.contributorHash);
  assert.equal(b.sceneRequest.requestId, "other");
});
test("strict schemas reject injection, stale versions, forged cells and oversized state", async () => {
  await assert.rejects(spatialScene(undefined), (e) => e.status === 400);
  await assert.rejects(
    spatialScene({ ...req(), sql: "SELECT * FROM private" }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    spatialScene(req({ datasetVersion: "0".repeat(64) })),
    (e) => e.status === 409,
  );
  const scene = await spatialScene(req());
  await assert.rejects(
    spatialSelection({
      ...envelope(scene, { kind: "cell_union", cellIds: [] }),
      sceneQueryHash: "0".repeat(64),
    }),
    (e) => e.status === 409,
  );
  await assert.rejects(
    spatialSelection(
      envelope(scene, { kind: "cell_union", cellIds: ["forged-cell"] }),
    ),
    (e) => e.status === 409,
  );
  await assert.rejects(
    spatialSelection(
      envelope(scene, { kind: "cell_union", cellIds: Array(1025).fill("a") }),
    ),
    (e) => e.status === 400,
  );
  await assert.rejects(
    spatialSelection({
      ...envelope(scene, { kind: "cell_union", cellIds: [] }),
      extra: "x".repeat(131073),
    }),
    (e) => e.status === 413,
  );
  assert.equal(
    Request.safeParse({ ...legacy(), view: "demand_shelves" }).success,
    false,
  );
});
test("coverage cube is complete and separates evidence basis from actual availability disagreement", async () => {
  const scene = await spatialScene(req({ lens: "coverage_cube" }));
  const rows = scene.data.companies;
  const combined = metrics.populations.combined;
  assert.equal(rows.length, combined.employers);
  assert.equal(
    rows.reduce((n, r) => n + r.count, 0),
    combined.postings,
  );
  assert.equal(
    rows.reduce((n, r) => n + r.knownCountryCount, 0),
    combined.postings - combined.unknownCountry,
  );
  assert.equal(
    rows.reduce((n, r) => n + r.eligiblePayCount, 0),
    combined.eligibleUsd,
  );
  assert.equal(
    scene.data.diagnostics.rawStatusDifferences,
    metrics.diagnostics.rawStatusDifferences,
  );
  assert.equal(
    scene.data.diagnostics.basisDifferences,
    metrics.diagnostics.basisDifferences,
  );
  assert.equal(
    scene.data.diagnostics.semanticStateDisagreements,
    metrics.diagnostics.semanticStateDisagreements,
  );
  assert.equal(scene.data.diagnostics.dateDifferences, metrics.diagnostics.dateDifferences);
  assert.equal(scene.data.diagnostics.locationDifferences, metrics.diagnostics.locationDifferences);
  const company = rows[0];
  const selected = await spatialSelection(
    envelope(scene, { kind: "cell_union", cellIds: [company.id] }),
  );
  assert.equal(selected.matchedCount, company.count);
  assert.ok(selected.data.rows.every((r) => r.companyId === company.companyId));
});
const focus = ctx.release.catalog.skills.find(
  (s) => s.name === "Communication",
).id;
test("graph focus does not filter inventory; caps and omitted contributor union are explicit", async () => {
  const graph = await spatialScene(
    req({
      lens: "skill_neighborhood",
      basis: "recorded_mentions",
      focusSkillId: focus,
    }),
  );
  assert.equal(graph.matchedCount, metrics.populations.combined.postings);
  assert.equal(graph.analysisCount, metrics.populations.combined.postings);
  assert.equal(graph.data.nodes[0].count, metrics.communicationCount);
  assert.equal(graph.data.nodes.length, 40);
  assert.equal(graph.data.edges.length, 120);
  assert.equal(
    graph.data.support.effectiveMinimumCount,
    Math.max(20, Math.ceil(0.002 * graph.analysisCount)),
  );
  assert.ok(graph.data.coverage.qualifyingEdges > 120);
  assert.equal(
    graph.data.coverage.representedPostings +
      graph.data.coverage.omittedContributors,
    metrics.populations.combined.postings,
  );
});
test("local graph marginals, intersections, Jaccard and ANY/ALL use independently enumerated posting IDs", async () => {
  const reference = (
    await query(
      legacy({
        sourceMode: "local",
        view: "records",
        page: { offset: 0, limit: 100 },
      }),
    )
  ).data.rows;
  const scene = await spatialScene(
    req({
      sourceMode: "local",
      lens: "skill_neighborhood",
      basis: "recorded_mentions",
      focusSkillId: focus,
      support: { minimumCount: 5, minimumShare: 0.002 },
    }),
  );
  for (const node of scene.data.nodes)
    assert.equal(
      node.count,
      reference.filter((r) => r.skillIds.includes(node.id)).length,
    );
  for (const edge of scene.data.edges) {
    const a = reference.filter((r) => r.skillIds.includes(edge.a)).length,
      b = reference.filter((r) => r.skillIds.includes(edge.b)).length,
      m = reference.filter(
        (r) => r.skillIds.includes(edge.a) && r.skillIds.includes(edge.b),
      ).length;
    assert.equal(edge.count, m);
    assert.equal(edge.jaccard, m / (a + b - m));
    assert.equal(edge.aShare, m / a);
    assert.equal(edge.bShare, m / b);
  }
  const edge = scene.data.edges[0];
  assert.ok(edge);
  for (const operator of ["any", "all"]) {
    const selected = await spatialSelection(
      envelope(scene, {
        kind: "skill_set",
        operator,
        skillIds: [edge.a, edge.b],
      }),
    );
    const expected = reference.filter((r) =>
      operator === "any"
        ? r.skillIds.includes(edge.a) || r.skillIds.includes(edge.b)
        : r.skillIds.includes(edge.a) && r.skillIds.includes(edge.b),
    );
    assert.deepEqual(
      selected.data.rows.map((r) => r.id).sort(),
      expected.map((r) => r.id).sort(),
    );
  }
  const pair = await spatialSelection(
    envelope(scene, { kind: "skill_pair", skillIds: [edge.a, edge.b] }),
  );
  assert.equal(pair.matchedCount, edge.count);
});
test("analyzed-text basis retains original count/hash and reports exclusions instead of zero upstream skills", async () => {
  const upstream = await spatialScene(
    req({
      sourceMode: "upstream",
      lens: "skill_neighborhood",
      basis: "analyzed_text",
      focusSkillId: focus,
    }),
  );
  assert.equal(upstream.matchedCount, metrics.populations.upstream.postings);
  assert.equal(upstream.analysisCount, 0);
  assert.equal(upstream.basisExcludedCount, metrics.populations.upstream.postings);
  assert.equal(upstream.data.nodes.length, 0);
  assert.equal(upstream.data.availability, "empty_analysis_population");
  const combined = await spatialScene(
    req({
      lens: "skill_neighborhood",
      basis: "analyzed_text",
      focusSkillId: focus,
    }),
  );
  assert.equal(combined.analysisCount, metrics.populations.local.postings);
  assert.equal(
    combined.basisExcludedCount,
    metrics.populations.combined.postings - metrics.populations.local.postings,
  );
  const selected = await spatialSelection(
    envelope(combined, {
      kind: "skill_set",
      operator: "any",
      skillIds: [focus],
    }),
  );
  assert.ok(
    selected.data.rows.every(
      (r) =>
        r.hasDescription === true && r.provenance.skills.startsWith("local:"),
    ),
  );
  await assert.rejects(
    spatialScene(
      req({
        lens: "skill_neighborhood",
        basis: "recorded_mentions",
        focusSkillId: focus,
        support: { minimumCount: 5, minimumShare: 0 },
      }),
    ),
    (e) => e.status === 400,
  );
});
test("immutable selector comparison computes overlapping unions exactly and rejects source-mode drift", async () => {
  const scene = await spatialScene(req({ sourceMode: "local" }));
  const cells = scene.data.cells.filter((c) => c.count).slice(0, 3);
  const a = envelope(scene, {
      kind: "cell_union",
      cellIds: [cells[0].id, cells[1].id],
    }),
    b = envelope(scene, {
      kind: "cell_union",
      cellIds: [cells[1].id, cells[2].id],
    });
  const compared = (await spatialCompare({ a, b })).data;
  assert.equal(compared.a.count, cells[0].count + cells[1].count);
  assert.equal(compared.b.count, cells[1].count + cells[2].count);
  assert.equal(compared.overlap, cells[1].count);
  assert.equal(compared.onlyA, cells[0].count);
  assert.equal(compared.onlyB, cells[2].count);
  const other = await spatialScene(req());
  await assert.rejects(
    spatialCompare({
      a,
      b: envelope(other, { kind: "cell_union", cellIds: [] }),
    }),
    (e) => e.status === 409,
  );
});
test("selected CSV streams the existing 37-column schema and reconciles contributor hash/count", async () => {
  const scene = await spatialScene(req({ sourceMode: "local" }));
  const input = envelope(scene, {
    kind: "cell_union",
    cellIds: scene.data.cells
      .filter((c) => c.count)
      .slice(0, 3)
      .map((c) => c.id),
  });
  const selected = await spatialSelection(input);
  const headers = {};
  let text = "";
  const res = {
    destroyed: false,
    setHeader(k, v) {
      headers[k] = v;
    },
    write(v) {
      text += v;
      return true;
    },
    end() {},
  };
  await exportSpatialCsv(input, res);
  const csv = parseCsv(text, { columns: true, bom: true });
  assert.equal(csv.length, selected.matchedCount);
  assert.equal(Object.keys(csv[0]).length, 37);
  assert.equal(headers["X-Contributor-Hash"], selected.contributorHash);
  assert.deepEqual(
    csv.map((r) => r.id).sort(),
    selected.data.rows.map((r) => r.id).sort(),
  );
});
