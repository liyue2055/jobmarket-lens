import type { Filter, Mode } from "../types";
import type { Basis, Lens, Pin, SelectionRequest } from "./types";
export interface SpatialStudy {
  version: "2.5.1";
  datasetVersion: string;
  mode: Mode;
  filter: Filter;
  lens: Lens;
  basis: Basis;
  focusSkillId: string;
  support: number;
  shelf: string;
  committed: SelectionRequest | null;
  a: Pin | null;
  b: Pin | null;
}
const obj = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown, max = 160): value is string =>
  typeof value === "string" && value.length <= max;
const strings = (value: unknown, max = 32) =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every((v) => str(v)) &&
  new Set(value).size === value.length;
export function validFilter(value: unknown): value is Filter {
  return (
    obj(value) &&
    Object.entries(value).every(([k, x]) =>
      k === "search"
        ? str(x)
        : k === "availability"
          ? ["open", "closed", "all"].includes(String(x))
          : [
              "companyIds",
              "occupationIds",
              "skillIds",
              "countries",
              "arrangements",
            ].includes(k) && strings(x),
    )
  );
}
export function validSelection(
  value: unknown,
  mode: Mode,
  version: string,
): value is SelectionRequest {
  if (
    !obj(value) ||
    !obj(value.sceneRequest) ||
    !obj(value.selection) ||
    !str(value.sceneQueryHash, 64) ||
    !/^\w{64}$/.test(value.sceneQueryHash)
  )
    return false;
  if (
    Object.keys(value).some(
      (k) => !["sceneRequest", "sceneQueryHash", "selection"].includes(k),
    )
  )
    return false;
  const r = value.sceneRequest,
    s = value.selection;
  if (
    Object.keys(r).some(
      (k) =>
        ![
          "protocolVersion",
          "datasetVersion",
          "requestId",
          "sourceMode",
          "filter",
          "lens",
          "basis",
          "focusSkillId",
          "support",
          "layoutScope",
        ].includes(k),
    )
  )
    return false;
  if (
    r.protocolVersion !== "2.5.1" ||
    r.datasetVersion !== version ||
    r.sourceMode !== mode ||
    !str(r.requestId) ||
    !validFilter(r.filter) ||
    !["demand_shelves", "coverage_cube", "skill_neighborhood"].includes(
      String(r.lens),
    ) ||
    !["posting_inventory", "recorded_mentions", "analyzed_text"].includes(
      String(r.basis),
    )
  )
    return false;
  if (r.focusSkillId !== undefined && !str(r.focusSkillId)) return false;
  if (r.layoutScope !== undefined && !str(r.layoutScope, 100)) return false;
  if (
    r.support !== undefined &&
    (!obj(r.support) ||
      Object.keys(r.support).some(
        (k) => !["minimumCount", "minimumShare"].includes(k),
      ) ||
      !Number.isSafeInteger(r.support.minimumCount) ||
      Number(r.support.minimumCount) < 1 ||
      Number(r.support.minimumCount) > 100000 ||
      typeof r.support.minimumShare !== "number" ||
      r.support.minimumShare < 0 ||
      r.support.minimumShare > 1)
  )
    return false;
  return s.kind === "cell_union"
    ? Object.keys(s).every((k) => ["kind", "cellIds"].includes(k)) &&
        strings(s.cellIds, 1024)
    : s.kind === "skill_pair"
      ? Object.keys(s).every((k) => ["kind", "skillIds"].includes(k)) &&
        strings(s.skillIds, 2) &&
        (s.skillIds as string[]).length === 2
      : s.kind === "skill_set"
        ? Object.keys(s).every((k) =>
            ["kind", "skillIds", "operator"].includes(k),
          ) &&
          ["any", "all"].includes(String(s.operator)) &&
          strings(s.skillIds, 40)
        : false;
}
export function parseStudy(text: string, version: string): SpatialStudy {
  if (new TextEncoder().encode(text).byteLength > 131072)
    throw Error("Study exceeds the 128 KiB state limit.");
  const state = JSON.parse(text);
  if (
    !obj(state) ||
    Object.keys(state).some(
      (k) =>
        ![
          "version",
          "datasetVersion",
          "mode",
          "filter",
          "lens",
          "basis",
          "focusSkillId",
          "support",
          "shelf",
          "committed",
          "a",
          "b",
        ].includes(k),
    ) ||
    state.version !== "2.5.1" ||
    state.datasetVersion !== version ||
    !["combined", "upstream", "local"].includes(String(state.mode)) ||
    !validFilter(state.filter) ||
    !["demand_shelves", "coverage_cube", "skill_neighborhood"].includes(
      String(state.lens),
    ) ||
    !["recorded_mentions", "analyzed_text"].includes(String(state.basis)) ||
    !str(state.focusSkillId) ||
    !Number.isSafeInteger(state.support) ||
    Number(state.support) < 1 ||
    Number(state.support) > 100000 ||
    !["All arrangements", "Remote", "Hybrid", "On-site", "Unknown"].includes(
      String(state.shelf),
    )
  )
    throw Error(
      "Study is invalid or uses an unavailable release. No cohorts were changed.",
    );
  for (const key of ["committed", "a", "b"]) {
    const item = state[key];
    if (item === null) continue;
    const request =
      key === "committed" ? item : obj(item) ? item.request : null;
    if (!validSelection(request, state.mode as Mode, version))
      throw Error("Study contains an invalid or mismatched cohort.");
  }
  if (state.committed) {
    const r = (state.committed as SelectionRequest).sceneRequest;
    const normalize = (filter: Filter) => {
      const normalized: Record<string, unknown> = {
        availability: filter.availability || "open",
      };
      for (const key of [
        "companyIds",
        "occupationIds",
        "skillIds",
        "countries",
        "arrangements",
      ] as const)
        if (filter[key]?.length)
          normalized[key] = [...new Set(filter[key])].sort();
      if (filter.search?.trim()) normalized.search = filter.search.trim();
      return JSON.stringify(normalized);
    };
    if (
      r.lens !== state.lens ||
      normalize(r.filter) !== normalize(state.filter as Filter) ||
      (r.layoutScope || "baseline") !== "baseline" ||
      r.basis !==
        (state.lens === "skill_neighborhood"
          ? state.basis
          : "posting_inventory") ||
      (state.lens === "skill_neighborhood" &&
        (r.focusSkillId !== state.focusSkillId ||
          (r.support?.minimumCount ?? 20) !== state.support ||
          (r.support?.minimumShare ?? 0.002) !== 0.002))
    )
      throw Error(
        "Applied cohort does not match the visible scene. Frozen A/B may differ, but the applied selection must share the scene context.",
      );
  }
  if (state.mode !== "local" && Number(state.support) < 20)
    throw Error("Support below 20 requires the local source mode.");
  return state as unknown as SpatialStudy;
}
