import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  ROOT,
  sha,
  canonical,
  validate,
  validateSeed,
} from "../scripts/common.mjs";
import {
  parseCsv,
  POSTING_HEADERS,
  decodeSupplement,
} from "../scripts/import-upstream.mjs";
import {
  upstreamRecord,
  mergeRecords,
  parsePay,
  validatedPay,
} from "../scripts/original-source.mjs";
import { verifyStore, assertPopulations } from "../scripts/materialize.mjs";
import { migrateHistory } from "../scripts/migrate-history.mjs";
const seed = JSON.parse(
  await readFile(new URL("../store/local-seed.json", import.meta.url), "utf8"),
);
const metrics = JSON.parse(
  await readFile(new URL("./fixtures/release-metrics.json", import.meta.url), "utf8"),
);
function row(overrides = {}) {
  return {
    ...Object.fromEntries(POSTING_HEADERS.map((k) => [k, ""])),
    "Posting ID": "NVDA:synthetic-test",
    Ticker: "NVDA",
    Title: "Synthetic test role",
    Status: "Open",
    URL: "https://example.com/job",
    "Accepts equivalent experience": "No",
    ...overrides,
  };
}
function csv(rows) {
  return Buffer.from(
    [POSTING_HEADERS, ...rows.map((r) => POSTING_HEADERS.map((k) => r[k]))]
      .map((values) =>
        values
          .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
          .join(","),
      )
      .join("\n"),
  );
}

test("pinned CSV parser rejects incompatible headers and unsafe/duplicate identities", () => {
  assert.throws(
    () => parseCsv(Buffer.from("id,title\n1,Job"), "postings"),
    /headers/,
  );
  const r = row();
  const result = parseCsv(
    csv([r, r, row({ "Posting ID": "NVDA:2", URL: "javascript:alert(1)" })]),
    "postings",
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rejects.length, 2);
});
test("CSV dollar symbol never establishes USD without audited typed native agreement", () => {
  const r = row({ Pay: "$100,000–$200,000 per year" });
  const unknown = upstreamRecord(r);
  assert.equal(unknown.pay.currency, null);
  assert.equal(unknown.pay.valid, false);
  assert.equal(unknown.pay.annualHigh, null);
  const typed = {
    pay_lo: 100000,
    pay_hi: 200000,
    pay_period: "year",
    pay_cur: "USD",
    pay_max: 999999999,
  };
  const recovered = upstreamRecord(r, typed);
  assert.equal(recovered.pay.valid, true);
  assert.equal(recovered.pay.annualHigh, 200000);
  typed.pay_hi = 300000;
  assert.equal(upstreamRecord(r, typed).pay.valid, false);
});
test("suspicious and nonfinite salary endpoints remain ineligible", () => {
  assert.equal(
    validatedPay({
      low: 100000,
      high: 2000000,
      annualLow: 100000,
      annualHigh: 2000000,
      currency: "USD",
      period: "year",
    }).valid,
    false,
  );
  assert.equal(
    validatedPay({
      low: NaN,
      high: 100000,
      annualLow: 1,
      annualHigh: 100000,
      currency: "USD",
      period: "year",
    }).valid,
    false,
  );
  assert.equal(parsePay("$39.47–$69.08 per hour").annualHigh, 143686);
});
test("typed supplement rejects wrong pinned bytes", () => {
  assert.throws(
    () => decodeSupplement(Buffer.from("not audited HTML"), []),
    /checksum/,
  );
});
test("strict nested publication schemas reject private fields and unexpected evidence", () => {
  const r = upstreamRecord(row());
  validate(r, "posting");
  r.quality.description = "PRIVATE_SENTINEL";
  assert.throws(() => validate(r, "posting"), /rejected/);
  delete r.quality.description;
  r.raw = "PRIVATE_SENTINEL";
  assert.throws(() => validate(r, "posting"), /rejected/);
});
test("merge retains field fallback/provenance, does not manufacture local observations", () => {
  const up = upstreamRecord(
    row({ "Minimum degree": "Bachelor's", City: "SF", Country: "US" }),
  );
  const local = structuredClone(up);
  local.sourceIds = ["local:NVDA"];
  local.availabilitySourceId = "local:NVDA";
  local.provenance = Object.fromEntries(
    Object.keys(local.provenance).map((k) => [k, "local:NVDA"]),
  );
  local.availabilityAsOf = "2026-10-16";
  local.availability = "local_observed";
  local.degree = null;
  local.level = "Senior";
  local.locations = [
    {
      country: null,
      region: null,
      city: null,
      precision: "unknown",
      primary: true,
    },
  ];
  local.firstObservedAt = "2026-10-14";
  local.lastObservedAt = "2026-10-16";
  local.hasDescription = true;
  const combined = mergeRecords(up, local);
  assert.equal(combined.degree, "Bachelor's");
  assert.equal(combined.fieldProvenance.degree, up.availabilitySourceId);
  assert.equal(combined.locations[0].city, "SF");
  assert.equal(combined.firstObservedAt, "2026-10-14");
  assert.equal(up.firstObservedAt, null);
  assert.equal(up.availability, "upstream_reported_open");
  assert.throws(
    () => mergeRecords(up, { ...local, id: "OTHER:1" }),
    /Identity/,
  );
});
test("canonical semantic identity ignores object key ordering", () => {
  assert.equal(sha(canonical({ a: 1, b: 2 })), sha(canonical({ b: 2, a: 1 })));
  assert.throws(() => canonical({ a: Infinity }), /Nonfinite/);
});
test("missing local population does not close upstream postings; duplicate IDs fail", () => {
  const r = upstreamRecord(row());
  const data = {
    modes: { combined: [r], upstream: [r], local: [] },
    catalog: seed.catalog,
  };
  assert.equal(assertPopulations(data).counts.local, 0);
  assert.equal(r.availability, "upstream_reported_open");
  data.modes.upstream.push(r);
  assert.throws(() => assertPopulations(data), /Duplicate/);
});
test("private history migration refuses public/deployment output paths", async () => {
  await assert.rejects(
    migrateHistory({ output: resolve(ROOT, "store/history") }),
    /private Node storage/,
  );
});
test("committed store hashes/counts and native SQL match release populations and pay", async () => {
  const release = await verifyStore();
  assert.equal(release.datasetVersion, metrics.datasetVersion);
  assert.deepEqual(release.counts, metrics.counts);
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  try {
    const path = join(ROOT, "store/postings.parquet").replaceAll("'", "''");
    const rows = (
      await c.runAndReadAll(
        `SELECT mode,count(*)::INTEGER n,count(DISTINCT id)::INTEGER ids,count(*)FILTER(WHERE "eligiblePay")::INTEGER pay FROM read_parquet('${path}') GROUP BY mode`,
      )
    ).getRowObjects();
    for (const r of rows) {
      assert.equal(r.n, release.counts[r.mode]);
      assert.equal(r.ids, r.n);
      assert.equal(r.pay, metrics.populations[r.mode].eligibleUsd);
    }
    assert.deepEqual(
      release.eligiblePayByMode,
      Object.fromEntries(
        Object.entries(metrics.populations).map(([mode, population]) => [
          mode,
          population.eligibleUsd,
        ]),
      ),
    );
  } finally {
    c.closeSync();
    db.closeSync();
  }
});
test("altered published Parquet fails validation before querying", async () => {
  const temp = await mkdtemp(join(tmpdir(), "node25-tamper-"));
  try {
    const release = JSON.parse(
      await readFile(join(ROOT, "store/release.json")),
    );
    await writeFile(join(temp, "release.json"), JSON.stringify(release));
    await writeFile(join(temp, "postings.parquet"), "PRIVATE_SENTINEL");
    await assert.rejects(verifyStore(temp), /Checksum mismatch/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("public seed rejects unknown/private top-level fields", () => {
  assert.throws(
    () => validateSeed({ ...seed, raw: "PRIVATE_SENTINEL" }),
    /seed fields/,
  );
});

test("deep publication check rejects private fields even when a modified Parquet has matching hashes", async () => {
  const temp = await mkdtemp(join(tmpdir(), "node25-private-field-"));
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  try {
    const detail = upstreamRecord(row());
    detail.description = "PRIVATE_SENTINEL";
    const entry = {
      mode: "combined",
      id: detail.id,
      companyId: detail.companyId,
      title: detail.title,
      occupationId: null,
      level: null,
      arrangement: null,
      availability: detail.availability,
      hasDescription: null,
      eligiblePay: false,
      annualLow: null,
      annualHigh: null,
      countries: [],
      skillIds: [],
      detailJSON: JSON.stringify(detail),
    };
    const input = join(temp, "input.json");
    await writeFile(input, JSON.stringify(entry));
    const parquet = join(temp, "postings.parquet");
    await c.run(
      `COPY (SELECT * FROM read_json_auto('${input}')) TO '${parquet}' (FORMAT PARQUET)`,
    );
    const bytes = await readFile(parquet);
    const release = JSON.parse(
      await readFile(join(ROOT, "store/release.json")),
    );
    release.files = [
      { path: "postings.parquet", bytes: bytes.length, sha256: sha(bytes) },
    ];
    release.collection.runs = [];
    await writeFile(join(temp, "release.json"), JSON.stringify(release));
    await writeFile(join(temp, "local-seed.json"), JSON.stringify(seed));
    await assert.rejects(verifyStore(temp), /Public posting rejected/);
  } finally {
    c.closeSync();
    db.closeSync();
    await rm(temp, { recursive: true, force: true });
  }
});

test("historical admin projection allows statuses/counts but rejects raw detail fields", async () => {
  const { HistorySchema } = await import("../scripts/history-contract.mjs");
  const history = JSON.parse(
    await readFile(join(ROOT, "store/collection-history.json")),
  );
  assert.equal(history.runs.length, 7);
  assert.equal(history.scheduled, false);
  assert.ok(
    history.runs.every(
      (r) => r.kind === "historical-import" && r.engine === "legacy-python",
    ),
  );
  history.runs[0].detail = "PRIVATE_SENTINEL";
  assert.throws(() => HistorySchema.parse(history));
});
