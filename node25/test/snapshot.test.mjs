import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdtemp, mkdir, symlink, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ROOT, sha } from "../scripts/common.mjs";
import {
  POSTING_HEADERS,
  COMPANY_HEADERS,
} from "../scripts/import-upstream.mjs";
import {
  auditSnapshot,
  verifyCandidateFile,
  sourceCandidate,
  pullSnapshot,
  DEFAULT_CANDIDATE,
} from "../scripts/pull-snapshot.mjs";

// Synthetic records only; the actual upstream artifacts stay outside Git.
const csv = (headers, rows) =>
  Buffer.from(
    [headers, ...rows.map((row) => headers.map((key) => row[key] || ""))]
      .map((values) =>
        values
          .map((value) => '"' + String(value).replaceAll('"', '""') + '"')
          .join(","),
      )
      .join("\n"),
  );
function fixture(transform = (rows) => rows) {
  const rows = [1, 2].map((i) => ({
    "Posting ID": `TEST:${i}`,
    Title: `Synthetic role ${i}`,
    Ticker: "TEST",
    Company: "Synthetic employer",
    Status: "Open",
    URL: `https://example.test/jobs/${i}`,
    Posted: "2026-10-16",
    "Last seen": "2026-10-16",
  }));
  const fields = ["id", "title", "co", "url", "posted", "last_seen", "open"];
  const typed = transform(
    rows.map((row) => [
      row["Posting ID"],
      row.Title,
      row.Ticker,
      row.URL,
      row.Posted,
      row["Last seen"],
      true,
    ]),
  );
  const native = Buffer.from(JSON.stringify({ fields, rows: typed }));
  const files = {
    "Job postings.csv": csv(POSTING_HEADERS, rows),
    "data source.csv": csv(COMPANY_HEADERS, [
      {
        Ticker: "TEST",
        Company: "Synthetic employer",
        "Postings in dashboard": "2",
      },
    ]),
    "index.html": Buffer.from(
      "const EMBEDDED = " +
        JSON.stringify(gzipSync(native).toString("base64")) +
        ";",
    ),
  };
  const candidate = {
    expected: { postings: 2, postingCompanies: 1, sourceCompanies: 1 },
    typedFields: fields,
    typedDecodedBytes: native.length,
    files: Object.fromEntries(
      Object.entries(files).map(([key, bytes]) => [
        key,
        { bytes: bytes.length, sha256: sha(bytes) },
      ]),
    ),
  };
  return { files, candidate };
}

test("candidate audit reconciles exact inventory, typed fields and local contributor union", () => {
  const { files, candidate } = fixture();
  const report = auditSnapshot(
    files,
    candidate,
    ["TEST:1", "OTHER:3"],
    ["TEST", "OTHER"],
  );
  assert.equal(report.postings, 2);
  assert.equal(report.postingCompanies, 1);
  assert.equal(report.rejectedRows, 0);
  assert.equal(report.sourceCountDiscrepancies, 0);
  assert.deepEqual(report.local, {
    postings: 2,
    companies: 2,
    overlap: 1,
    prospectiveCombined: 3,
    prospectiveCombinedCompanies: 2,
  });
  assert.equal(JSON.stringify(report).includes("Synthetic role"), false);
});
test("immutable file digests reject changed bytes even when length is unchanged", () => {
  const { files, candidate } = fixture();
  const bytes = Buffer.from(files["Job postings.csv"]);
  bytes[0] ^= 1;
  assert.throws(
    () => verifyCandidateFile(bytes, candidate.files["Job postings.csv"]),
    /checksum/,
  );
  assert.throws(
    () =>
      verifyCandidateFile(
        bytes.subarray(1),
        candidate.files["Job postings.csv"],
      ),
    /byte-length/,
  );
});
test("individually checksummed CSV and HTML must still describe the same records", () => {
  const changed = fixture((rows) => {
    rows[0][1] = "Different synthetic title";
    return rows;
  });
  assert.throws(
    () => auditSnapshot(changed.files, changed.candidate),
    /shared field/,
  );
  const duplicate = fixture((rows) => {
    rows[1] = rows[0];
    return rows;
  });
  assert.throws(
    () => auditSnapshot(duplicate.files, duplicate.candidate),
    /duplicated/,
  );
  const width = fixture((rows) => {
    rows[0].pop();
    return rows;
  });
  assert.throws(() => auditSnapshot(width.files, width.candidate), /row width/);
});
test("population claims and local IDs cannot override verified populations", () => {
  const { files, candidate } = fixture();
  candidate.expected.postings++;
  assert.throws(() => auditSnapshot(files, candidate), /population/);
  candidate.expected.postings--;
  assert.throws(
    () => auditSnapshot(files, candidate, ["TEST:1", "TEST:1"]),
    /duplicate IDs/,
  );
});
test("unregistered commits and public output paths fail before network or writes", async () => {
  assert.throws(() => sourceCandidate("main"), /Unknown candidate/);
  assert.throws(() => sourceCandidate("0".repeat(40)), /Unknown candidate/);
  const directory = resolve(ROOT, "public", "candidate-should-not-exist");
  let calls = 0;
  await assert.rejects(
    pullSnapshot({
      directory,
      fetchImpl: () => {
        calls++;
        throw Error("Network forbidden");
      },
    }),
    /ignored .private/,
  );
  assert.equal(calls, 0);
  await assert.rejects(access(directory), { code: "ENOENT" });
});
test("private-path symlinks cannot redirect intake to a public or external directory", async () => {
  const privateRoot = resolve(ROOT, "../.private");
  await mkdir(privateRoot, { recursive: true });
  const root = await mkdtemp(join(privateRoot, "snapshot-test-"));
  const external = await mkdtemp(join(tmpdir(), "lens-snapshot-external-"));
  try {
    await symlink(external, join(root, "link"));
    await assert.rejects(
      pullSnapshot({
        directory: join(root, "link", "candidate"),
        offline: true,
      }),
      /symlinks/,
    );
    await assert.rejects(access(join(external, "candidate")), {
      code: "ENOENT",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});
