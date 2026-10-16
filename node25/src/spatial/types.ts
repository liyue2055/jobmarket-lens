import type { Filter, Mode, Posting } from "../types";
export type Lens = "demand_shelves" | "coverage_cube" | "skill_neighborhood";
export type Basis = "posting_inventory" | "recorded_mentions" | "analyzed_text";
export interface SceneRequest {
  protocolVersion: "2.5.1";
  datasetVersion: string;
  requestId: string;
  sourceMode: Mode;
  filter: Filter;
  lens: Lens;
  basis: Basis;
  focusSkillId?: string;
  support?: { minimumCount: number; minimumShare: number };
  layoutScope?: string;
}
export type Selection =
  | { kind: "cell_union"; cellIds: string[] }
  | { kind: "skill_pair"; skillIds: [string, string] }
  | { kind: "skill_set"; operator: "any" | "all"; skillIds: string[] };
export interface SelectionRequest {
  sceneRequest: SceneRequest;
  sceneQueryHash: string;
  selection: Selection;
}
export interface Cell {
  id: string;
  occupationId: string;
  occupationLabel: string;
  level: string;
  arrangement: string;
  count: number;
  eligiblePayCount: number;
  analyzedTextCount: number;
}
export interface Employer {
  id: string;
  companyId: string;
  label: string;
  count: number;
  knownCountryCount: number;
  eligiblePayCount: number;
  unknownArrangementCount: number;
}
export interface SkillNode {
  id: string;
  label: string;
  count: number;
  share: number;
}
export interface Edge {
  id: string;
  a: string;
  b: string;
  count: number;
  jaccard: number;
  aShare: number;
  bShare: number;
}
export interface Scene {
  protocolVersion: string;
  datasetVersion: string;
  requestId: string;
  sourceMode: Mode;
  matchedCount: number;
  analysisCount: number;
  basisExcludedCount: number;
  queryHash: string;
  contributorHash: string;
  analysisContributorHash: string;
  sceneRequest: SceneRequest;
  data: {
    cells?: Cell[];
    companies?: Employer[];
    nodes?: SkillNode[];
    edges?: Edge[];
    axes?: {
      occupations: { id: string; label: string }[];
      levels: string[];
      arrangements: string[];
    };
    coverage: {
      total: number;
      shownGroups: number;
      qualifyingGroups: number;
      omittedGroups: number;
      representedPostings: number;
      omittedContributors: number;
      shownEdges?: number;
      qualifyingEdges?: number;
      omittedEdges?: number;
    };
    diagnostics?: Record<string, number>;
  };
}
export interface RecordPage {
  rows: Posting[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
export interface SelectedResponse {
  datasetVersion: string;
  sourceMode: Mode;
  matchedCount: number;
  contributorHash: string;
  data: { records: RecordPage };
}
export interface Pin {
  label: string;
  request: SelectionRequest;
  count: number;
  hash: string;
}
export interface Comparison {
  a: { count: number; hash: string };
  b: { count: number; hash: string };
  overlap: number;
  onlyA: number;
  onlyB: number;
}
export interface Mark {
  id: string;
  label: string;
  position: [number, number, number];
  count: number;
  color?: string;
}
