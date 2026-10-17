/** Stage an audited public snapshot; never changes production pins or release artifacts. */
import {
  readFile,
  writeFile,
  mkdir,
  realpath,
  lstat,
  rename,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { ROOT, sha, canonical, validateSeed } from "./common.mjs";
import { parseCsv } from "./import-upstream.mjs";

const registry = JSON.parse(
  await readFile(new URL("./source-candidates.json", import.meta.url), "utf8"),
);
export const DEFAULT_CANDIDATE = "2fc50364f3056b1dfa930e8dfeba576a5b28a3c8";
const privateRoot = resolve(ROOT, "../.private");
const seedPath = join(ROOT, "store/local-seed.json");
export function sourceCandidate(commit) {
  if (
    !/^[a-f0-9]{40}$/.test(commit) ||
    !Object.hasOwn(registry.candidates, commit)
  )
    throw Error(
      "Unknown candidate commit; audit its immutable artifacts before admission",
    );
  return registry.candidates[commit];
}
export function verifyCandidateFile(bytes, spec) {
  if (bytes.length !== spec.bytes || sha(bytes) !== spec.sha256)
    throw Error("Candidate artifact checksum or byte-length mismatch");
}
export function auditSnapshot(
  files,
  candidate,
  localIds = [],
  localCompanyIds = [],
) {
  for (const [name, spec] of Object.entries(candidate.files))
    verifyCandidateFile(files[name], spec);
  const postings = parseCsv(files["Job postings.csv"], "postings");
  const companies = parseCsv(files["data source.csv"], "companies");
  if (postings.rejects.length || companies.rejects.length)
    throw Error(
      `Candidate rejected rows: postings=${postings.rejects.length}, companies=${companies.rejects.length}`,
    );
  const p = postings.rows,
    c = companies.rows;
  const employerCounts = new Map();
  for (const row of p)
    employerCounts.set(row.Ticker, (employerCounts.get(row.Ticker) || 0) + 1);
  if (
    p.length !== candidate.expected.postings ||
    c.length !== candidate.expected.sourceCompanies ||
    employerCounts.size !== candidate.expected.postingCompanies
  )
    throw Error("Candidate population differs from its audited expectation");
  const companyIds = new Set(c.map((row) => row.Ticker));
  if ([...employerCounts.keys()].some((id) => !companyIds.has(id)))
    throw Error("Posting employer absent from source catalog");

  // Parse JSON data only. No HTML scripts are evaluated or copied into the app.
  const match = files["index.html"]
    .toString("utf8")
    .match(/const EMBEDDED = ("[^"\n]+")/);
  if (!match) throw Error("Candidate typed payload missing");
  const nativeBytes = gunzipSync(Buffer.from(JSON.parse(match[1]), "base64"), {
    maxOutputLength: candidate.typedDecodedBytes,
  });
  if (nativeBytes.length !== candidate.typedDecodedBytes)
    throw Error("Typed decoded byte-length mismatch");
  const native = JSON.parse(nativeBytes);
  if (
    canonical(native.fields) !== canonical(candidate.typedFields) ||
    !Array.isArray(native.rows) ||
    native.rows.length !== p.length
  )
    throw Error("Candidate typed schema/population mismatch");
  const typed = new Map();
  for (const values of native.rows) {
    if (!Array.isArray(values) || values.length !== native.fields.length)
      throw Error("Typed row width mismatch");
    const row = Object.fromEntries(
      native.fields.map((name, i) => [name, values[i]]),
    );
    if (!row.id || typed.has(row.id))
      throw Error("Typed ID missing or duplicated");
    typed.set(row.id, row);
  }
  const currencyCounts = {},
    statuses = {};
  for (const row of p) {
    const extra = typed.get(row["Posting ID"]);
    if (!extra) throw Error("Typed ID set differs from CSV");
    for (const [csv, field] of [
      ["Title", "title"],
      ["Ticker", "co"],
      ["URL", "url"],
      ["Posted", "posted"],
      ["Last seen", "last_seen"],
    ])
      if ((row[csv] || null) !== (extra[field] || null))
        throw Error("Typed/CSV shared field mismatch");
    if (
      typeof extra.open !== "boolean" ||
      (row.Status === "Open") !== extra.open
    )
      throw Error("Typed/CSV status mismatch");
    statuses[row.Status] = (statuses[row.Status] || 0) + 1;
    if (extra.pay_lo != null && extra.pay_hi != null) {
      const key = extra.pay_cur || "unknown";
      currencyCounts[key] = (currencyCounts[key] || 0) + 1;
    }
  }
  const local = new Set(localIds),
    upstream = new Set(p.map((row) => row["Posting ID"]));
  if (local.size !== localIds.length)
    throw Error("Local seed contains duplicate IDs");
  const overlap = [...local].filter((id) => upstream.has(id)).length;
  return {
    postings: p.length,
    postingCompanies: employerCounts.size,
    sourceCompanies: c.length,
    rejectedRows: 0,
    typedSharedFieldMismatches: 0,
    statuses,
    local: {
      postings: local.size,
      companies: new Set(localCompanyIds).size,
      overlap,
      prospectiveCombined: upstream.size + local.size - overlap,
      prospectiveCombinedCompanies: new Set([
        ...employerCounts.keys(),
        ...localCompanyIds,
      ]).size,
    },
    nativePayCurrencyCounts: currencyCounts,
    payMeaning:
      "Native reported currency with two bounds; these are not validated USD eligibility counts. CSV dollar signs alone do not establish USD.",
    sourceCountDiscrepancies: c.filter(
      (row) =>
        Number(row["Postings in dashboard"]) !==
        (employerCounts.get(row.Ticker) || 0),
    ).length,
  };
}
async function ensurePrivateDirectory(directory) {
  const dir = resolve(directory);
  if (!dir.startsWith(privateRoot + "/"))
    throw Error("Candidate intake must stay beneath ignored .private");
  // Reject symlink ancestors before creating/writing anything through them.
  const relative = dir.slice(privateRoot.length + 1).split("/");
  let current = privateRoot;
  for (const part of ["", ...relative]) {
    if (part) current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw Error("Candidate path cannot contain symlinks");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (!(await realpath(dir)).startsWith((await realpath(privateRoot)) + "/"))
    throw Error("Private intake path escaped");
  return dir;
}
async function regularFile(path) {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink())
    throw Error("Candidate artifacts must be regular files");
}
async function boundedFetch(url, spec, fetchImpl) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(90_000),
    redirect: "error",
  });
  if (!response.ok)
    throw Error("Public snapshot fetch HTTP " + response.status);
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > spec.bytes)
      throw Error("Candidate download exceeded audited length");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  verifyCandidateFile(bytes, spec);
  return bytes;
}
export async function pullSnapshot({
  commit = DEFAULT_CANDIDATE,
  offline = false,
  directory = join(privateRoot, "upstream-candidates", commit),
  fetchImpl = fetch,
} = {}) {
  const candidate = sourceCandidate(commit),
    dir = await ensurePrivateDirectory(directory),
    files = {};
  for (const [name, spec] of Object.entries(candidate.files)) {
    const target = join(dir, name);
    try {
      await regularFile(target);
      files[name] = await readFile(target);
      verifyCandidateFile(files[name], spec);
    } catch (error) {
      if (error.code !== "ENOENT" || offline) throw error;
      const url = `https://raw.githubusercontent.com/${registry.repository}/${commit}/${spec.path.split("/").map(encodeURIComponent).join("/")}`;
      files[name] = await boundedFetch(url, spec, fetchImpl);
      const pending = target + ".pending";
      try {
        await lstat(pending);
        throw Error(
          "Pending candidate artifact already exists; review it before retrying",
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await writeFile(pending, files[name], { mode: 0o600, flag: "wx" });
      await rename(pending, target);
    }
  }
  const seed = validateSeed(JSON.parse(await readFile(seedPath, "utf8")));
  const audit = auditSnapshot(
    files,
    candidate,
    seed.localPostings.map((row) => row.id),
    seed.localPostings.map((row) => row.companyId),
  );
  const report = {
    schemaVersion: 1,
    repository: registry.repository,
    commit,
    sourceAsOf: candidate.asOf,
    checkedAt: new Date().toISOString(),
    status: "staged-candidate",
    released: false,
    sourceAsOfMeaning:
      "Upstream commit time; not the observation time of every posting.",
    files: candidate.files,
    audit,
    limitations: [
      "No access to the author's private history is required or attempted.",
      "No collectors or paid APIs were run. Raw artifacts remain in ignored private intake.",
      "Published V2/Node releases, source pins and saved-cohort identities are unchanged.",
      "Missing IDs in a later upstream snapshot do not demonstrate closure.",
    ],
  };
  const reportPath = join(dir, "candidate-report.json");
  try {
    await regularFile(reportPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
  return report;
}
async function main() {
  const args = process.argv.slice(2);
  if (
    args.some(
      (arg, i) =>
        arg !== "--offline" && arg !== "--commit" && args[i - 1] !== "--commit",
    )
  )
    throw Error(
      "Usage: node scripts/pull-snapshot.mjs [--commit FULL_AUDITED_SHA] [--offline]",
    );
  const at = args.indexOf("--commit");
  if (at !== -1 && !args[at + 1])
    throw Error("--commit requires a full audited SHA");
  const report = await pullSnapshot({
    commit: at === -1 ? DEFAULT_CANDIDATE : args[at + 1],
    offline: args.includes("--offline"),
  });
  console.log(JSON.stringify(report, null, 2));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
