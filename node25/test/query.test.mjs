import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { query, detail, load, Request } from "../server/query.mjs";
const req = (extra = {}) => ({
  protocolVersion: "2.5",
  requestId: "test",
  sourceMode: "combined",
  view: "overview",
  filter: { availability: "all" },
  ...extra,
});
const reference = JSON.parse(
  await readFile(new URL("../store/release.json", import.meta.url)),
);
const metrics = JSON.parse(
  await readFile(new URL("./fixtures/release-metrics.json", import.meta.url), "utf8"),
);
test("actual three-mode distinct populations, pay eligibility and complete matrix reconciliation", async () => {
  assert.equal(reference.datasetVersion, metrics.datasetVersion);
  for (const [mode, population] of Object.entries(metrics.populations)) {
    const r = await query(req({ sourceMode: mode }));
    assert.equal(r.matchedCount, population.postings);
    assert.equal(r.data.eligiblePayCount, population.eligibleUsd);
    assert.equal(
      r.data.matrix.cells.reduce((a, b) => a + b.count, 0) +
        r.data.matrix.otherCount,
      population.postings,
    );
    assert.equal(r.datasetVersion, reference.datasetVersion);
  }
});
test("default availability excludes reported closed without asserting closure from absence", async () => {
  const r = await query(req({ filter: {} }));
  assert.equal(r.matchedCount, metrics.populations.combined.open);
});
test("record pages are bounded, stable and do not duplicate contributors", async () => {
  const a = await query(
    req({
      sourceMode: "local",
      view: "records",
      page: { offset: 0, limit: 50 },
    }),
  );
  const b = await query(
    req({
      sourceMode: "local",
      view: "records",
      page: { offset: 50, limit: 50 },
    }),
  );
  assert.equal(a.data.rows.length, 50);
  assert.equal(b.data.rows.length, 42);
  assert.equal(
    new Set([...a.data.rows, ...b.data.rows].map((r) => r.id)).size,
    92,
  );
  assert.equal(a.contributorHash, b.contributorHash);
  const d = await detail({ sourceMode: "local", id: a.data.rows[0].id });
  assert.deepEqual(d.data.row, a.data.rows[0]);
});
test("pinned overlap and skill numerators match independently enumerated local contributor sets", async () => {
  const all = await query(
    req({
      sourceMode: "local",
      view: "records",
      page: { offset: 0, limit: 100 },
    }),
  );
  const a = { availability: "all", companyIds: ["AMZN"] },
    b = { availability: "all" };
  const r = await query(
    req({ sourceMode: "local", view: "compare", cohortA: a, cohortB: b }),
  );
  const idsA = new Set(
    all.data.rows.filter((v) => v.companyId === "AMZN").map((v) => v.id),
  );
  assert.equal(r.data.a.count, idsA.size);
  assert.equal(r.data.b.count, 92);
  assert.equal(r.data.overlap, idsA.size);
  assert.equal(r.data.onlyA, 0);
  assert.equal(r.data.onlyB, 92 - idsA.size);
  for (const d of r.data.differences) {
    assert.equal(
      d.aCount,
      all.data.rows.filter((v) => idsA.has(v.id) && v.skillIds.includes(d.id))
        .length,
    );
    assert.equal(
      d.bCount,
      all.data.rows.filter((v) => v.skillIds.includes(d.id)).length,
    );
  }
});
test("country membership counts each posting once and unknown stays explicit", async () => {
  const rr = await query(
    req({
      sourceMode: "local",
      view: "records",
      page: { offset: 0, limit: 100 },
    }),
  );
  const countries = ["Australia", "United States"];
  const expected = rr.data.rows.filter((r) =>
    r.locations.some((l) => countries.includes(l.country)),
  ).length;
  const r = await query(
    req({ sourceMode: "local", filter: { availability: "all", countries } }),
  );
  assert.equal(r.matchedCount, expected);
});
test("skill co-mentions count distinct supporting postings with exact AND selection", async () => {
  const rr = await query(
    req({
      sourceMode: "local",
      view: "records",
      page: { offset: 0, limit: 100 },
    }),
  );
  const r = await query(req({ sourceMode: "local", view: "skills" }));
  for (const c of r.data.coMentions) {
    const expected = rr.data.rows.filter(
      (p) => p.skillIds.includes(c.a) && p.skillIds.includes(c.b),
    ).length;
    assert.equal(c.count, expected);
  }
  const c = r.data.coMentions[0];
  assert(c);
  const selection = await query(
    req({
      sourceMode: "local",
      filter: { availability: "all", skillIds: [c.a, c.b] },
    }),
  );
  assert.equal(selection.matchedCount, c.count);
});
test("arbitrary SQL, paths, excess arrays, paging and unknown keys rejected", async () => {
  for (const bad of [
    req({ sql: "select * from read_csv_auto('/etc/passwd')" }),
    req({ filter: { file: "/etc/passwd" } }),
    req({ filter: { companyIds: Array(33).fill("AMZN") } }),
    req({ page: { offset: 0, limit: 101 } }),
  ])
    assert.equal(Request.safeParse(bad).success, false);
  const r = await query(
    req({ filter: { search: "'); DROP TABLE postings;--" } }),
  );
  assert.equal(r.matchedCount, 0);
  assert.equal((await query(req({ sourceMode: "local" }))).matchedCount, 92);
});
test("dataset mismatch fails and deterministic cache restores request identity", async () => {
  await assert.rejects(
    query(req({ datasetVersion: "0".repeat(64) })),
    (e) => e.status === 409,
  );
  const a = await query(req({ sourceMode: "local", requestId: "one" })),
    b = await query(req({ sourceMode: "local", requestId: "two" }));
  assert.equal(a.contributorHash, b.contributorHash);
  assert.equal(b.requestId, "two");
});
test("public detail does not expose raw descriptions, snippets or SQLite history", async () => {
  const r = await query(req({ sourceMode: "local", view: "records" }));
  for (const row of r.data.rows) {
    for (const forbidden of [
      "description",
      "raw",
      "descriptionText",
      "matchedSnippets",
      "history",
      "password",
    ])
      assert.equal(forbidden in row, false);
  }
  const { instance } = await load();
  const c = await instance.connect();
  try {
    await assert.rejects(c.run("SELECT * FROM read_csv_auto('/etc/passwd')"));
  } finally {
    c.closeSync();
  }
});

test("CSV cells neutralize spreadsheet formulas including whitespace prefixes and preserve quoting", async () => {
  const { csvCell } = await import("../server/query.mjs");
  for (const text of [
    "=1+1",
    " +SUM(A1)",
    "@formula",
    "-12",
    "\tformula",
    "\nformula",
  ])
    assert.equal(csvCell(text).startsWith("\"'"), true);
  assert.equal(csvCell('Senior "Analyst", II'), '"Senior ""Analyst"", II"');
  assert.equal(csvCell("Normal title"), '"Normal title"');
});
