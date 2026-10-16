import { createHash } from "node:crypto";
import { z } from "zod";
import {
  Filter,
  load,
  normalizeFilter,
  predicate,
  rows,
  stats,
  slot,
  free,
  runtime,
  METRIC_VERSION,
  exportResolvedCsv,
} from "./query.mjs";

export const SPATIAL_VERSION = "spatial-distinct-v1";
export const QUALITY_VERSION = "paired-state-basis-v1";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const canonical = (v) =>
  Array.isArray(v)
    ? "[" + v.map(canonical).join(",") + "]"
    : v && typeof v === "object"
      ? "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
          .join(",") +
        "}"
      : JSON.stringify(v);
const error = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const base = z.object({
  protocolVersion: z.literal("2.5.1"),
  datasetVersion: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: z.string().min(1).max(100),
  sourceMode: z.enum(["combined", "upstream", "local"]),
  filter: Filter,
  layoutScope: z.string().min(1).max(100).default("baseline"),
});
const support = z
  .object({
    minimumCount: z.number().int().min(5).max(1000000).default(20),
    minimumShare: z.number().min(0).max(1).default(0.002),
  })
  .strict();
export const SpatialRequest = z.discriminatedUnion("lens", [
  base
    .extend({
      lens: z.literal("demand_shelves"),
      basis: z.literal("posting_inventory"),
    })
    .strict(),
  base
    .extend({
      lens: z.literal("coverage_cube"),
      basis: z.literal("posting_inventory"),
    })
    .strict(),
  base
    .extend({
      lens: z.literal("skill_neighborhood"),
      basis: z.enum(["recorded_mentions", "analyzed_text"]),
      focusSkillId: z.string().min(1).max(160),
      support: support.default({ minimumCount: 20, minimumShare: 0.002 }),
    })
    .strict(),
]);
const ISSUES = [
  "basis_difference",
  "state_disagreement",
  "date_difference",
  "location_difference",
  "invalid_bounds",
  "unknown_country",
  "unknown_arrangement",
];
const INVALID_PAY_SQL = `coalesce(list_has_any(from_json(json_extract("detailJSON",'$.pay.flags'),'["VARCHAR"]'),['inverted_range','inverted_annual_range','invalid_numeric_pay']),false)`;
const selection = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("diagnostic"), issue: z.enum(ISSUES) }).strict(),
  z
    .object({
      kind: z.literal("cell_union"),
      cellIds: z.array(z.string().min(1).max(200)).max(1024),
      sceneQueryHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("skill_pair"),
      skillIds: z.tuple([
        z.string().min(1).max(160),
        z.string().min(1).max(160),
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("skill_set"),
      operator: z.enum(["any", "all"]),
      skillIds: z.array(z.string().min(1).max(160)).max(40),
    })
    .strict(),
]);
export const SelectionRequest = z
  .object({
    sceneRequest: SpatialRequest,
    sceneQueryHash: z.string().regex(/^[a-f0-9]{64}$/),
    selection,
    page: z
      .object({
        offset: z.number().int().min(0).max(1000000),
        limit: z.number().int().min(1).max(100),
      })
      .strict()
      .optional(),
  })
  .strict();
const CompareRequest = z
  .object({ a: SelectionRequest, b: SelectionRequest })
  .strict();
const LEVELS = [
  "Intern",
  "Entry",
  "Mid",
  "Senior",
  "Lead / Principal",
  "Manager",
  "Director & Executive",
  "Unknown",
];
const ARRANGEMENTS = ["Remote", "Hybrid", "On-site", "Unknown"];
const sceneCache = new Map();
function parse(schema, input) {
  let encoded;
  try {
    encoded = JSON.stringify(input);
  } catch {
    throw error("Spatial request must be JSON");
  }
  if (typeof encoded !== "string") throw error("Spatial request must be JSON");
  if (Buffer.byteLength(encoded) > 131072)
    throw error("Spatial envelope exceeds 128 KiB", 413);
  const r = schema.safeParse(input);
  if (!r.success)
    throw error(
      "Invalid spatial request: " +
        r.error.issues
          .map((i) => i.path.join(".") + ": " + i.message)
          .join("; ")
          .slice(0, 500),
    );
  return r.data;
}
function normalize(req) {
  return { ...req, filter: normalizeFilter(req.filter) };
}
function queryHash(req) {
  const { requestId, ...semantic } = req;
  return hash(
    canonical({
      ...semantic,
      spatialMethod: SPATIAL_VERSION,
      qualityMethod: QUALITY_VERSION,
    }),
  );
}
function demandId(occupationId, level, arrangement) {
  return (
    "cell-" + hash(canonical([occupationId, level, arrangement])).slice(0, 32)
  );
}
function companyId(id) {
  return "company-" + id;
}
function bind(p, value) {
  p.values.push(value);
  return "$" + p.values.length;
}
function analysisPredicate(req, values = []) {
  const p = predicate(req.sourceMode, req.filter, values);
  if (req.lens === "skill_neighborhood" && req.basis === "analyzed_text")
    p.sql +=
      " AND \"hasDescription\"=true AND starts_with(json_extract_string(\"detailJSON\",'$.provenance.skills'),'local:')";
  return p;
}
function ensure(req, ctx) {
  if (req.datasetVersion !== ctx.release.datasetVersion)
    throw error("Dataset changed; reload spatial selection", 409);
  if (req.lens === "skill_neighborhood") {
    if (!ctx.labels.skills.has(req.focusSkillId))
      throw error("Unknown focus skill");
    if (req.support.minimumCount < 20 && req.sourceMode !== "local")
      throw error("Low-support threshold is available only in local mode");
  }
}
async function withConnection(fn) {
  const ctx = await load();
  await slot();
  let conn, timer;
  try {
    runtime.queries++;
    conn = await ctx.instance.connect();
    conn.lensDeadline = performance.now() + 5000;
    timer = setTimeout(() => conn.interrupt(), 5000);
    return await fn(conn, ctx);
  } catch (e) {
    runtime.errors++;
    throw e;
  } finally {
    clearTimeout(timer);
    conn?.closeSync();
    free();
  }
}
function pairRelation() {
  const nativeState = (alias) =>
    `CASE json_extract_string(${alias}."detailJSON",'$.availability') WHEN 'local_observed' THEN 'open' WHEN 'upstream_reported_open' THEN 'open' WHEN 'closed' THEN 'closed' WHEN 'possibly_closed' THEN 'possibly_closed' ELSE 'unverified' END`;
  const locations = (alias) =>
    `from_json(json_extract(${alias}."detailJSON",'$.locations'),'[{"country":"VARCHAR","region":"VARCHAR","city":"VARCHAR"}]')`;
  return `WITH facts AS (SELECT u.id,u."companyId",
    json_extract_string(u."detailJSON",'$.availability') AS ua,json_extract_string(l."detailJSON",'$.availability') AS la,
    ${nativeState("u")} AS us,${nativeState("l")} AS ls,
    json_extract_string(u."detailJSON",'$.availabilityAsOf') AS ud,json_extract_string(l."detailJSON",'$.availabilityAsOf') AS ld,
    json_extract_string(u."detailJSON",'$.sourcePostedDate') AS up,json_extract_string(l."detailJSON",'$.sourcePostedDate') AS lp,
    ${locations("u")} AS ul,${locations("l")} AS ll
    FROM postings u JOIN postings l USING(id) WHERE u.mode='upstream' AND l.mode='local'),
  eligible AS (SELECT *,coalesce(ud IS NOT NULL AND ld IS NOT NULL AND left(ud,10)=left(ld,10) AND us<>'unverified' AND ls<>'unverified',false) AS comparable,
    up IS NOT NULL AND lp IS NOT NULL AS dateComparable,
    coalesce(len(list_filter(ul,x -> x.country IS NOT NULL OR x.region IS NOT NULL OR x.city IS NOT NULL))>0 AND len(list_filter(ll,x -> x.country IS NOT NULL OR x.region IS NOT NULL OR x.city IS NOT NULL))>0,false) AS locationComparable FROM facts)
  SELECT id,"companyId",comparable,coalesce(ua<>la,false) AS rawStatusDifference,
    comparable AND us=ls AND ua<>la AS basisDifference,comparable AND us<>ls AS stateDisagreement,
    dateComparable,dateComparable AND up<>lp AS dateDifference,
    locationComparable,locationComparable AND ul<>ll AS locationDifference FROM eligible`;
}
function summarizePairs(pairs) {
  const n = (key) => pairs.filter((p) => p[key] === true).length;
  return {
    totalPairs: pairs.length,
    comparablePairs: n("comparable"),
    rawStatusDifferences: n("rawStatusDifference"),
    basisDifferences: n("basisDifference"),
    semanticStateDisagreements: n("stateDisagreement"),
    uncomparablePairs: pairs.length - n("comparable"),
    dateComparablePairs: n("dateComparable"),
    dateExcludedPairs: pairs.length - n("dateComparable"),
    dateDifferences: n("dateDifference"),
    locationComparablePairs: n("locationComparable"),
    locationExcludedPairs: pairs.length - n("locationComparable"),
    locationDifferences: n("locationDifference"),
    comparability:
      "Same source as-of calendar day and both normalized states known; not exact timestamp equivalence.",
    differenceMeaning:
      "Dates/locations are raw recorded-value comparisons among pairs with known fields, not semantic adjudication. Differences require review; basis differences are not contradictory availability.",
  };
}
async function diagnosticPairs(conn, p) {
  return rows(
    conn,
    `SELECT pairs.* EXCLUDE("companyId"),active."companyId" FROM (${pairRelation()}) pairs JOIN (SELECT id,"companyId" FROM postings WHERE ${p.sql}) active USING(id)`,
    p.values,
  );
}
function issueGroups(r, d) {
  const entry = (
    issue,
    label,
    cls,
    numerator,
    denominator,
    denominatorLabel,
    unavailableCount,
    meaning,
  ) => ({
    issue,
    label,
    class: cls,
    numerator,
    denominator,
    denominatorLabel,
    unavailableCount,
    meaning,
  });
  return [
    entry(
      "basis_difference",
      "Observation/reporting basis differences",
      "evidence_basis_difference",
      d.basisDifferences,
      d.comparablePairs,
      "same-day comparable source pairs",
      d.uncomparablePairs,
      "Same normalized availability state; differing evidence basis.",
    ),
    entry(
      "state_disagreement",
      "Normalized state disagreements",
      "semantic_state_disagreement",
      d.semanticStateDisagreements,
      d.comparablePairs,
      "same-day comparable source pairs",
      d.uncomparablePairs,
      "Different normalized availability states under the declared same-day rule; needs review.",
    ),
    entry(
      "date_difference",
      "Recorded date differences",
      "recorded_value_difference",
      d.dateDifferences,
      d.dateComparablePairs,
      "source pairs with both posted-date fields known",
      d.dateExcludedPairs,
      "Raw date values differ; precision and date meaning are not adjudicated.",
    ),
    entry(
      "location_difference",
      "Recorded location differences",
      "recorded_value_difference",
      d.locationDifferences,
      d.locationComparablePairs,
      "source pairs with known location fields on both sides",
      d.locationExcludedPairs,
      "Raw recorded location lists differ; precision and order are not adjudicated.",
    ),
    entry(
      "invalid_bounds",
      "Invalid supported pay values",
      "invalid_supported_value",
      r.invalidBoundCount,
      r.payAssessableCount,
      "postings with native pay fields or concrete validation failures",
      r.count - r.payAssessableCount,
      "Concrete numeric/range validation flags; suspicious valid values and valid non-USD ranges are separate.",
    ),
    entry(
      "unknown_country",
      "Country not established",
      "unknown_coverage",
      r.count - r.knownCountryCount,
      r.count,
      "matched postings",
      0,
      "Missing country coverage is not evidence of a market problem.",
    ),
    entry(
      "unknown_arrangement",
      "Arrangement not established",
      "unknown_coverage",
      r.unknownArrangementCount,
      r.count,
      "matched postings",
      0,
      "Missing arrangement coverage is not an on-site or remote classification.",
    ),
  ];
}
function coverage(
  total,
  shownGroups,
  qualifyingGroups,
  representedPostings,
  extra = {},
) {
  return {
    total,
    shownGroups,
    qualifyingGroups,
    omittedGroups: Math.max(0, qualifyingGroups - shownGroups),
    representedPostings,
    omittedContributors: total - representedPostings,
    completionStatus: "complete",
    ...extra,
  };
}
async function demand(conn, p, s, ctx, req) {
  const grouped = await rows(
    conn,
    `SELECT coalesce("occupationId",'Unknown') AS "occupationId",coalesce("level",'Unknown') AS level,coalesce(arrangement,'Unknown') AS arrangement,count(*)::INTEGER AS count,count(*)FILTER(WHERE "eligiblePay")::INTEGER AS "eligiblePayCount",count(*)FILTER(WHERE "hasDescription"=true)::INTEGER AS "analyzedTextCount" FROM postings WHERE ${p.sql} GROUP BY 1,2,3`,
    p.values,
  );
  const observed = await rows(
    conn,
    `SELECT DISTINCT coalesce("occupationId",'Unknown') AS id FROM postings WHERE mode=$1 ORDER BY id`,
    [req.sourceMode],
  );
  const occupations = [
    ...new Set([
      ...observed.map((r) => r.id),
      ...grouped.map((r) => r.occupationId),
    ]),
  ].sort();
  const levels = [...new Set([...LEVELS, ...grouped.map((r) => r.level)])];
  const arrangements = [
    ...new Set([...ARRANGEMENTS, ...grouped.map((r) => r.arrangement)]),
  ];
  if (occupations.length * levels.length * arrangements.length > 1024)
    throw error("Category cells exceed spatial budget; use 2D", 413);
  const lookup = new Map(
    grouped.map((r) => [demandId(r.occupationId, r.level, r.arrangement), r]),
  );
  const cells = [];
  for (const occ of occupations)
    for (const level of levels)
      for (const arrangement of arrangements) {
        const id = demandId(occ, level, arrangement),
          row = lookup.get(id);
        cells.push({
          id,
          occupationId: occ,
          occupationLabel: ctx.labels.occupations.get(occ) ?? occ,
          level,
          arrangement,
          count: row?.count ?? 0,
          eligiblePayCount: row?.eligiblePayCount ?? 0,
          analyzedTextCount: row?.analyzedTextCount ?? 0,
        });
      }
  if (cells.reduce((sum, c) => sum + c.count, 0) !== s.count)
    throw error("Demand cell partition failed", 500);
  return {
    cells,
    axes: {
      occupations: occupations.map((id) => ({
        id,
        label: ctx.labels.occupations.get(id) ?? id,
      })),
      levels,
      arrangements,
    },
    coverage: coverage(s.count, grouped.length, grouped.length, s.count, {
      possibleCells: cells.length,
    }),
    coordinateMetadata: {
      kind: "categorical",
      method: "occupation-level-arrangement-v1",
      categoryDistanceMeaning: "none",
      areaMeasure: "distinct posting count",
      radiusTransform: "sqrt-count",
    },
  };
}
async function companies(conn, p, s, ctx) {
  const result = await rows(
    conn,
    `SELECT "companyId",count(*)::INTEGER AS count,count(*)FILTER(WHERE len(countries)>0)::INTEGER AS "knownCountryCount",count(*)FILTER(WHERE "eligiblePay")::INTEGER AS "eligiblePayCount",count(*)FILTER(WHERE arrangement IS NULL)::INTEGER AS "unknownArrangementCount",count(*)FILTER(WHERE "hasDescription"=true)::INTEGER AS "analyzedTextCount",count(*)FILTER(WHERE json_extract_string("detailJSON",'$.pay.low') IS NOT NULL AND json_extract_string("detailJSON",'$.pay.high') IS NOT NULL)::INTEGER AS "rawRangeCount",count(*)FILTER(WHERE (json_extract_string("detailJSON",'$.pay.low') IS NOT NULL AND json_extract_string("detailJSON",'$.pay.high') IS NOT NULL) OR coalesce(list_has_any(from_json(json_extract("detailJSON",'$.pay.flags'),'["VARCHAR"]'),['inverted_range','inverted_annual_range','invalid_numeric_pay']),false))::INTEGER AS "payAssessableCount",count(*)FILTER(WHERE json_extract_string("detailJSON",'$.pay.currency') IS NOT NULL)::INTEGER AS "knownCurrencyCount",count(*)FILTER(WHERE json_extract_string("detailJSON",'$.pay.valid')='true' AND json_extract_string("detailJSON",'$.pay.currency')<>'USD')::INTEGER AS "validNonUsdCount",count(*)FILTER(WHERE coalesce(list_has_any(from_json(json_extract("detailJSON",'$.pay.flags'),'["VARCHAR"]'),['inverted_range','inverted_annual_range','invalid_numeric_pay']),false))::INTEGER AS "invalidBoundCount",count(*)FILTER(WHERE coalesce(list_has_any(from_json(json_extract("detailJSON",'$.pay.flags'),'["VARCHAR"]'),['suspicious_annual_max','suspicious_range']),false))::INTEGER AS "suspiciousPayCount" FROM postings WHERE ${p.sql} GROUP BY 1 ORDER BY 1`,
    p.values,
  );
  if (result.length > 1024)
    throw error("Employer scene exceeds budget; use 2D", 413);
  const pairs = await diagnosticPairs(conn, p),
    diagnostics = summarizePairs(pairs);
  const totals = Object.fromEntries(
    [
      "count",
      "knownCountryCount",
      "unknownArrangementCount",
      "invalidBoundCount",
      "payAssessableCount",
    ].map((k) => [k, result.reduce((n, r) => n + r[k], 0)]),
  );
  return {
    companies: result.map((r) => ({
      diagnostics: summarizePairs(
        pairs.filter((pair) => pair.companyId === r.companyId),
      ),
      issueGroups: issueGroups(
        r,
        summarizePairs(pairs.filter((pair) => pair.companyId === r.companyId)),
      ),
      ...r,
      id: companyId(r.companyId),
      label: ctx.labels.companies.get(r.companyId) ?? r.companyId,
      countryCoverage: r.knownCountryCount / r.count,
      usdPayCoverage: r.eligiblePayCount / r.count,
      logCount: Math.log1p(r.count),
    })),
    emptyCompanies: [...ctx.labels.companies]
      .filter(([id]) => !result.some((r) => r.companyId === id))
      .map(([id, label]) => ({ id, label })),
    diagnostics,
    issueGroups: issueGroups(totals, diagnostics),
    coverage: coverage(s.count, result.length, result.length, s.count),
    coordinateMetadata: {
      kind: "quantitative",
      axes: {
        x: {
          measure: "knownCountryCount/count",
          unit: "share",
          transform: "linear",
        },
        y: {
          measure: "eligiblePayCount/count",
          unit: "share",
          transform: "linear",
        },
        z: { measure: "count", unit: "distinct postings", transform: "log1p" },
      },
      caution:
        "USD eligibility is comparison coverage; valid non-USD pay is not an error.",
    },
  };
}
async function skillGraph(conn, p, s, req, ctx) {
  const threshold = Math.max(
    req.support.minimumCount,
    Math.ceil(req.support.minimumShare * s.count),
  );
  const marginals = await rows(
    conn,
    `SELECT skill,count(*)::INTEGER AS count FROM (SELECT unnest("skillIds") AS skill FROM postings WHERE ${p.sql}) GROUP BY 1 ORDER BY count DESC,skill`,
    p.values,
  );
  const counts = new Map(marginals.map((r) => [r.skill, r.count]));
  const focusValues = [...p.values, req.focusSkillId];
  const related = await rows(
    conn,
    `SELECT skill,count(*)::INTEGER AS count FROM (SELECT unnest("skillIds") AS skill FROM postings WHERE ${p.sql} AND list_contains("skillIds",$${focusValues.length})) GROUP BY 1 ORDER BY count DESC,skill`,
    focusValues,
  );
  const neighbors = related.filter(
    (r) => r.skill !== req.focusSkillId && r.count >= threshold,
  );
  const allIds =
      (counts.get(req.focusSkillId) ?? 0) > 0
        ? [req.focusSkillId, ...neighbors.map((r) => r.skill)]
        : [],
    shownIds = allIds.slice(0, 40);
  let pairs = [];
  if (allIds.length > 1) {
    const vals = [...p.values],
      placeholders = allIds
        .map((id) => {
          vals.push(id);
          return "$" + vals.length;
        })
        .join(",");
    pairs = await rows(
      conn,
      `WITH raw AS (SELECT id,unnest("skillIds") AS skill FROM postings WHERE ${p.sql}), selected AS(SELECT * FROM raw WHERE skill IN (${placeholders})) SELECT a.skill AS a,b.skill AS b,count(*)::INTEGER AS count FROM selected a JOIN selected b USING(id) WHERE a.skill<b.skill GROUP BY 1,2`,
      vals,
    );
  }
  const qualifying = pairs
    .filter((r) => r.count >= threshold)
    .map((r) => {
      const a = counts.get(r.a) ?? 0,
        b = counts.get(r.b) ?? 0;
      return {
        ...r,
        id: "edge-" + hash(canonical([r.a, r.b])).slice(0, 32),
        aCount: a,
        bCount: b,
        jaccard: r.count / (a + b - r.count),
        aShare: a ? r.count / a : 0,
        bShare: b ? r.count / b : 0,
      };
    });
  qualifying.sort(
    (a, b) =>
      Number(b.a === req.focusSkillId || b.b === req.focusSkillId) -
        Number(a.a === req.focusSkillId || a.b === req.focusSkillId) ||
      b.jaccard - a.jaccard ||
      b.count - a.count ||
      a.id.localeCompare(b.id),
  );
  const shownSet = new Set(shownIds);
  const edges = qualifying
    .filter((e) => shownSet.has(e.a) && shownSet.has(e.b))
    .slice(0, 120);
  const observedPairs = new Map(
    pairs.map((r) => [canonical([r.a, r.b]), r.count]),
  );
  const shownEdgeIds = new Set(edges.map((e) => e.id));
  const matrixPairs = [];
  for (let i = 0; i < shownIds.length; i++)
    for (let j = i + 1; j < shownIds.length; j++) {
      const [a, b] = [shownIds[i], shownIds[j]].sort(),
        count = observedPairs.get(canonical([a, b])) ?? 0;
      const aCount = counts.get(a) ?? 0,
        bCount = counts.get(b) ?? 0,
        id = "edge-" + hash(canonical([a, b])).slice(0, 32);
      matrixPairs.push({
        id,
        a,
        b,
        count,
        aCount,
        bCount,
        jaccard:
          aCount + bCount - count ? count / (aCount + bCount - count) : 0,
        aShare: aCount ? count / aCount : 0,
        bShare: bCount ? count / bCount : 0,
        qualifies: count >= threshold,
        shownEdge: shownEdgeIds.has(id),
      });
    }
  const vals = [...p.values];
  const clauses = shownIds.map((id) => {
    vals.push(id);
    return `list_contains("skillIds",$${vals.length})`;
  });
  const [represented] = await rows(
    conn,
    `SELECT count(*)::INTEGER AS count FROM postings WHERE ${p.sql} AND (${clauses.join(" OR ") || "FALSE"})`,
    vals,
  );
  return {
    focusSkillId: req.focusSkillId,
    nodes: shownIds.map((id) => ({
      id,
      label: ctx.labels.skills.get(id) ?? id,
      count: counts.get(id) ?? 0,
      share: s.count ? (counts.get(id) ?? 0) / s.count : 0,
    })),
    edges,
    matrix: {
      methodVersion: "exact-shown-node-pairs-v1",
      nodeIds: shownIds,
      pairs: matrixPairs,
      possiblePairs: matrixPairs.length,
      qualifyingPairs: matrixPairs.filter((p) => p.qualifies).length,
      shownEdges: edges.length,
      scope:
        "All unordered pairs among returned nodes; zero counts are observed query results, not missing rendered edges.",
    },
    support: {
      ...req.support,
      effectiveMinimumCount: threshold,
      lowSupport: req.support.minimumCount < 20,
    },
    coverage: coverage(
      s.count,
      shownIds.length,
      allIds.length,
      represented.count,
      {
        shownEdges: edges.length,
        qualifyingEdges: qualifying.length,
        omittedEdges: qualifying.length - edges.length,
        contributorCoverageBasis: "union of shown node mentions",
        edgeScope:
          "anchor plus all threshold-qualified neighbors before node/edge caps",
      },
    ),
    availability:
      s.count === 0
        ? "empty_analysis_population"
        : (counts.get(req.focusSkillId) ?? 0) === 0
          ? "anchor_not_recorded"
          : "available",
    basis:
      req.basis === "analyzed_text"
        ? "Recorded mentions / locally analyzed-description population"
        : "Recorded mentions / all matched postings; upstream description coverage remains unknown",
    coordinateMetadata: {
      kind: "layout",
      method: "stable-id-layout-v1",
      seed: 42,
      layoutScopeHash: hash(
        canonical({
          version: req.datasetVersion,
          mode: req.sourceMode,
          basis: req.basis,
          scope: req.layoutScope,
        }),
      ),
      distanceMeaning: "none; edge statistics define recorded relationships",
    },
  };
}
async function buildScene(conn, ctx, req) {
  ensure(req, ctx);
  const key = queryHash(req),
    cached = sceneCache.get(key);
  if (cached) return { ...cached, requestId: req.requestId, sceneRequest: req };
  const p0 = predicate(req.sourceMode, req.filter),
    p = analysisPredicate(req);
  const s0 = await stats(
    conn,
    p0.sql,
    p0.values,
    req.datasetVersion,
    req.sourceMode,
  );
  const s =
    req.basis === "analyzed_text"
      ? await stats(conn, p.sql, p.values, req.datasetVersion, req.sourceMode)
      : s0;
  let data =
    req.lens === "demand_shelves"
      ? await demand(conn, p, s, ctx, req)
      : req.lens === "coverage_cube"
        ? await companies(conn, p, s, ctx)
        : await skillGraph(conn, p, s, req, ctx);
  data = {
    ...data,
    evidence: {
      analyzedTextCount: s.analyzedTextCount,
      unknownCountryCount: s.unknownCountryCount,
      unknownArrangementCount: s.unknownArrangementCount,
      eligiblePayCount: s.eligiblePayCount,
    },
  };
  const response = {
    protocolVersion: "2.5.1",
    datasetVersion: req.datasetVersion,
    requestId: req.requestId,
    sourceMode: req.sourceMode,
    lens: req.lens,
    basis: req.basis,
    metricVersion: METRIC_VERSION,
    spatialMethodVersion: SPATIAL_VERSION,
    qualityMethodVersion: QUALITY_VERSION,
    matchedCount: s0.count,
    contributorHash: s0.hash,
    analysisCount: s.count,
    analysisContributorHash: s.hash,
    basisExcludedCount: s0.count - s.count,
    queryHash: key,
    sceneRequest: req,
    data,
  };
  if (Buffer.byteLength(JSON.stringify(response)) > 2_000_000)
    throw error("Spatial response budget exceeded", 413);
  sceneCache.set(key, response);
  while (sceneCache.size > 16)
    sceneCache.delete(sceneCache.keys().next().value);
  return response;
}
export async function spatialScene(input) {
  const started = performance.now(),
    req = normalize(parse(SpatialRequest, input));
  return withConnection(async (conn, ctx) => ({
    ...(await buildScene(conn, ctx, req)),
    elapsedMs: Math.round(performance.now() - started),
  }));
}
function normalizedEnvelope(input) {
  const envelope = parse(SelectionRequest, input);
  envelope.sceneRequest = normalize(envelope.sceneRequest);
  if (
    queryHash(envelope.sceneRequest) !== envelope.sceneQueryHash ||
    (envelope.selection.sceneQueryHash &&
      envelope.selection.sceneQueryHash !== envelope.sceneQueryHash)
  )
    throw error("Scene hash mismatch; reload selection", 409);
  return envelope;
}
async function selectionPredicate(conn, ctx, envelope, values = []) {
  const req = envelope.sceneRequest;
  ensure(req, ctx);
  const scene = await buildScene(conn, ctx, req),
    p = analysisPredicate(req, values),
    sel = envelope.selection;
  const add = (value) => bind(p, value);
  if (sel.kind === "diagnostic") {
    if (req.lens !== "coverage_cube")
      throw error("Diagnostic selectors require coverage cube");
    const pairField = {
      basis_difference: "basisDifference",
      state_disagreement: "stateDisagreement",
      date_difference: "dateDifference",
      location_difference: "locationDifference",
    }[sel.issue];
    if (pairField)
      p.sql += ` AND id IN (SELECT id FROM (${pairRelation()}) diagnosticPairs WHERE "${pairField}")`;
    else if (sel.issue === "invalid_bounds") p.sql += ` AND ${INVALID_PAY_SQL}`;
    else if (sel.issue === "unknown_country") p.sql += " AND len(countries)=0";
    else if (sel.issue === "unknown_arrangement")
      p.sql += " AND arrangement IS NULL";
  } else if (sel.kind === "cell_union") {
    if (req.lens === "skill_neighborhood")
      throw error("Cell selection is not valid for a skill scene");
    const dictionary = new Map(
      (scene.data.cells ?? scene.data.companies).map((c) => [c.id, c]),
    );
    const selected = [...new Set(sel.cellIds)].map((id) => {
      if (!dictionary.has(id))
        throw error("Cell does not belong to this scene", 409);
      return dictionary.get(id);
    });
    if (!selected.length) {
      p.sql += " AND FALSE";
      return p;
    }
    if (req.lens === "coverage_cube")
      p.sql += ` AND "companyId" IN (${selected.map((c) => add(c.companyId)).join(",")})`;
    else {
      const arrangements = new Map();
      for (const cell of selected) {
        if (!arrangements.has(cell.arrangement))
          arrangements.set(cell.arrangement, new Map());
        const levels = arrangements.get(cell.arrangement);
        if (!levels.has(cell.level)) levels.set(cell.level, new Set());
        levels.get(cell.level).add(cell.occupationId);
      }
      const ors = [];
      for (const [arr, levels] of arrangements) {
        const arrArg = add(arr);
        const levelOr = [];
        for (const [level, occs] of levels)
          levelOr.push(
            `(coalesce("level",'Unknown')=${add(level)} AND coalesce("occupationId",'Unknown') IN (${[...occs].map(add).join(",")}))`,
          );
        ors.push(
          `(coalesce(arrangement,'Unknown')=${arrArg} AND (${levelOr.join(" OR ")}))`,
        );
      }
      p.sql += ` AND (${ors.join(" OR ")})`;
    }
  } else {
    if (req.lens !== "skill_neighborhood")
      throw error("Skill selector requires skill neighborhood");
    const ids = [...new Set(sel.skillIds)];
    if (ids.some((id) => !ctx.labels.skills.has(id)))
      throw error("Unknown selection skill");
    if (sel.kind === "skill_pair" && ids.length !== 2)
      throw error("A skill pair requires two distinct skills");
    p.sql += ids.length
      ? " AND (" +
        ids
          .map((id) => `list_contains("skillIds",${add(id)})`)
          .join(
            sel.kind === "skill_pair" || sel.operator === "all"
              ? " AND "
              : " OR ",
          ) +
        ")"
      : " AND FALSE";
  }
  return p;
}
export async function spatialSelection(input) {
  const envelope = normalizedEnvelope(input),
    started = performance.now();
  return withConnection(async (conn, ctx) => {
    const p = await selectionPredicate(conn, ctx, envelope),
      req = envelope.sceneRequest,
      s = await stats(
        conn,
        p.sql,
        p.values,
        req.datasetVersion,
        req.sourceMode,
      ),
      page = envelope.page ?? { offset: 0, limit: 100 };
    const rr = await rows(
      conn,
      `SELECT "detailJSON" FROM postings WHERE ${p.sql} ORDER BY id LIMIT ${page.limit} OFFSET ${page.offset}`,
      p.values,
    );
    return {
      protocolVersion: "2.5.1",
      datasetVersion: req.datasetVersion,
      requestId: req.requestId,
      sourceMode: req.sourceMode,
      matchedCount: s.count,
      contributorHash: s.hash,
      sceneQueryHash: envelope.sceneQueryHash,
      selection: envelope.selection,
      elapsedMs: Math.round(performance.now() - started),
      data: {
        rows: rr.map((r) => JSON.parse(r.detailJSON)),
        total: s.count,
        ...page,
        hasMore: page.offset + page.limit < s.count,
        records: {
          rows: rr.map((r) => JSON.parse(r.detailJSON)),
          total: s.count,
          ...page,
          hasMore: page.offset + page.limit < s.count,
        },
      },
    };
  });
}
export async function spatialCompare(input) {
  const parsed = parse(CompareRequest, input),
    a = normalizedEnvelope(parsed.a),
    b = normalizedEnvelope(parsed.b);
  if (
    a.sceneRequest.datasetVersion !== b.sceneRequest.datasetVersion ||
    a.sceneRequest.sourceMode !== b.sceneRequest.sourceMode
  )
    throw error("Compare requires the same dataset and source mode", 409);
  return withConnection(async (conn, ctx) => {
    const pa = await selectionPredicate(conn, ctx, a),
      pb = await selectionPredicate(conn, ctx, b);
    const sa = await stats(
        conn,
        pa.sql,
        pa.values,
        a.sceneRequest.datasetVersion,
        a.sceneRequest.sourceMode,
      ),
      sb = await stats(
        conn,
        pb.sql,
        pb.values,
        b.sceneRequest.datasetVersion,
        b.sceneRequest.sourceMode,
      );
    const vals = [],
      bothA = await selectionPredicate(conn, ctx, a, vals),
      bothB = await selectionPredicate(conn, ctx, b, vals);
    const [rr] = await rows(
      conn,
      `SELECT count(*)::INTEGER AS count FROM postings WHERE (${bothA.sql}) AND (${bothB.sql})`,
      vals,
    );
    return {
      protocolVersion: "2.5.1",
      datasetVersion: a.sceneRequest.datasetVersion,
      sourceMode: a.sceneRequest.sourceMode,
      metricVersion: METRIC_VERSION,
      data: {
        a: { count: sa.count, hash: sa.hash, basis: a.sceneRequest.basis },
        b: { count: sb.count, hash: sb.hash, basis: b.sceneRequest.basis },
        overlap: rr.count,
        onlyA: sa.count - rr.count,
        onlyB: sb.count - rr.count,
      },
    };
  });
}
export async function exportSpatialCsv(input, res) {
  const envelope = normalizedEnvelope(input),
    req = envelope.sceneRequest;
  return exportResolvedCsv(
    {
      protocolVersion: "2.5",
      datasetVersion: req.datasetVersion,
      requestId: req.requestId,
      sourceMode: req.sourceMode,
      view: "records",
      filter: req.filter,
    },
    res,
    (conn, ctx) => selectionPredicate(conn, ctx, envelope),
  );
}
