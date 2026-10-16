import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Layers3,
  List,
  MousePointer2,
  RotateCcw,
  Share2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { api } from "../api";
import { Detail } from "../Detail";
import type { Catalog, Filter, Mode } from "../types";
import type {
  Basis,
  Cell,
  Comparison,
  Edge,
  Lens,
  Mark,
  Pin,
  Scene,
  SceneRequest,
  SelectedResponse,
  Selection,
  SelectionRequest,
} from "./types";
import "./spatial.css";
import LassoShelf from "./LassoShelf";
import { parseStudy } from "./study";
import { skillAngle } from "./layout";
import type { SpatialStudy } from "./study";
const SpatialScene = lazy(() => import("./SpatialScene"));
const count = (n: number | undefined) =>
  new Intl.NumberFormat("en").format(n || 0);
const pct = (n: number, d: number) =>
  d ? `${((100 * n) / d).toFixed(1)}%` : "Unavailable";
const lensNames: Record<Lens, string> = {
  demand_shelves: "Demand shelves",
  coverage_cube: "Coverage cube",
  skill_neighborhood: "Skill neighborhood",
};
const arrangements = ["Remote", "Hybrid", "On-site", "Unknown"];
class SceneBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? (
      <p>3D is unavailable. Continue with the complete 2D view.</p>
    ) : (
      this.props.children
    );
  }
}
function useSpatial<T>(url: string, body: unknown, enabled = true) {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const key = JSON.stringify(body),
    sequence = useRef(0),
    resolvedKey = useRef("");
  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController(),
      id = ++sequence.current;
    setData(null);
    setLoading(true);
    setError("");
    api<T>(url, { method: "POST", body: key, signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted && id === sequence.current) {
          resolvedKey.current = key;
          setData(value);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted && id === sequence.current) {
          setError(
            e.status === 409
              ? "This release or selection is no longer available. Reload; frozen cohorts will not be retargeted."
              : e.message,
          );
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [url, key, enabled]);
  return { data: resolvedKey.current === key ? data : null, loading, error };
}
function validFilter(value: unknown): value is Filter {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.entries(v).every(([k, x]) =>
    k === "search"
      ? typeof x === "string" && x.length <= 160
      : k === "availability"
        ? ["open", "closed", "all"].includes(String(x))
        : [
            "companyIds",
            "occupationIds",
            "skillIds",
            "countries",
            "arrangements",
          ].includes(k) &&
          Array.isArray(x) &&
          x.length <= 32 &&
          x.every((id) => typeof id === "string" && id.length <= 160),
  );
}
function readShared() {
  try {
    const token = new URLSearchParams(location.search).get("study");
    if (!token) return null;
    if (token.length > 18000) throw Error("Shared study is too large.");
    const state = JSON.parse(decodeURIComponent(escape(atob(token))));
    if (
      state.version !== "2.5.1" ||
      !["combined", "upstream", "local"].includes(state.mode) ||
      !Object.keys(lensNames).includes(state.lens) ||
      !validFilter(state.filter) ||
      typeof state.datasetVersion !== "string" ||
      (state.basis !== undefined &&
        !["recorded_mentions", "analyzed_text"].includes(state.basis)) ||
      (state.focusSkillId !== undefined &&
        (typeof state.focusSkillId !== "string" ||
          state.focusSkillId.length > 160)) ||
      (state.support !== undefined &&
        (!Number.isSafeInteger(state.support) ||
          state.support < 1 ||
          state.support > 100000))
    )
      throw Error("This shared study has an unsupported state.");
    return state;
  } catch {
    return {
      error:
        "This shared study is invalid. Start a new study using the controls below.",
    };
  }
}
const initial = readShared();
export default function SpatialLab() {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [catalogError, setCatalogError] = useState(""),
    [mode, setMode] = useState<Mode>(initial?.mode || "combined"),
    [filter, setFilter] = useState<Filter>(
      initial?.filter || { availability: "open" },
    ),
    [lens, setLens] = useState<Lens>(initial?.lens || "demand_shelves"),
    [basis, setBasis] = useState<Basis>(initial?.basis || "recorded_mentions"),
    [focusSkill, setFocusSkill] = useState<string>(initial?.focusSkillId || ""),
    [support, setSupport] = useState<number>(initial?.support || 20),
    [view, setView] = useState<"2d" | "3d">("2d"),
    [shelf, setShelf] = useState("All arrangements"),
    [interaction, setInteraction] = useState<"inspect" | "select">("inspect"),
    [draft, setDraft] = useState<string[]>([]),
    [skillDraft, setSkillDraft] = useState<string[]>([]),
    [operator, setOperator] = useState<"any" | "all">("any"),
    [pair, setPair] = useState<[string, string] | null>(null),
    [committed, setCommitted] = useState<SelectionRequest | null>(null),
    [offset, setOffset] = useState(0),
    [a, setA] = useState<Pin | null>(null),
    [b, setB] = useState<Pin | null>(null),
    [detail, setDetail] = useState<string | null>(null),
    [notice, setNotice] = useState(initial?.error || ""),
    [preset, setPreset] = useState("overview:0"),
    [search, setSearch] = useState(filter.search || ""),
    [inspected, setInspected] = useState(""),
    [inspectedIds, setInspectedIds] = useState<string[]>([]),
    [exporting, setExporting] = useState(false),
    [listing, setListing] = useState(false),
    [lasso, setLasso] = useState(false);
  const restoring = useRef(false),
    requestCounter = useRef(0),
    importSequence = useRef(0),
    root = useRef<HTMLDivElement>(null),
    [renderFailed, setRenderFailed] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    api<Catalog>("/api/catalog", { signal: c.signal })
      .then((value) => {
        setCatalog(value);
        setFocusSkill((old) =>
          value.skills.some((s) => s.id === old)
            ? old
            : value.skills[0]?.id || "",
        );
        if (
          initial?.datasetVersion &&
          initial.datasetVersion !== value.datasetVersion
        )
          setNotice(
            "The shared study release has changed. Its cohorts were not restored; the current release is shown.",
          );
      })
      .catch((e) => {
        if (!c.signal.aborted) setCatalogError(e.message);
      });
    return () => c.abort();
  }, []);
  const request = useMemo<SceneRequest>(
    () => ({
      protocolVersion: "2.5.1",
      datasetVersion: catalog?.datasetVersion || "",
      requestId: `spatial-${++requestCounter.current}`,
      sourceMode: mode,
      filter,
      lens,
      basis: lens === "skill_neighborhood" ? basis : "posting_inventory",
      ...(lens === "skill_neighborhood"
        ? {
            focusSkillId: focusSkill,
            support: { minimumCount: support, minimumShare: 0.002 },
          }
        : {}),
      layoutScope: "baseline",
    }),
    [catalog?.datasetVersion, mode, filter, lens, basis, focusSkill, support],
  );
  const sceneQuery = useSpatial<Scene>(
    "/api/spatial",
    request,
    !!catalog && (lens !== "skill_neighborhood" || !!focusSkill),
  );
  const scene =
    sceneQuery.data &&
    sceneQuery.data.datasetVersion === catalog?.datasetVersion &&
    sceneQuery.data.sourceMode === mode &&
    sceneQuery.data.requestId === request.requestId
      ? sceneQuery.data
      : null;
  const selected = useSpatial<SelectedResponse>(
    "/api/spatial/selection",
    { ...committed, page: { offset, limit: 100 } },
    !!committed,
  );
  const selectedData =
    selected.data &&
    selected.data.datasetVersion === catalog?.datasetVersion &&
    selected.data.sourceMode === mode
      ? selected.data
      : null;
  const comparison = useSpatial<{ data: Comparison }>(
    "/api/spatial/compare",
    { a: a?.request, b: b?.request },
    !!a && !!b,
  );
  useEffect(() => {
    setDraft([]);
    setSkillDraft([]);
    setPair(null);
    if (!restoring.current) setCommitted(null);
    restoring.current = false;
    setOffset(0);
    setInspected("");
    setInspectedIds([]);
  }, [request]);
  useEffect(() => {
    const target = root.current;
    const failed = (event: Event) => {
      event.preventDefault();
      setView("2d");
      setRenderFailed(true);
      setNotice(
        "The graphics context was lost. Your study and frozen cohorts are preserved in the 2D view.",
      );
    };
    target?.addEventListener("spatial-context-lost", failed);
    // Context loss does not bubble. Capture it from the already mounted app
    // before a lazy canvas's renderer/effects have finished initializing.
    target?.addEventListener("webglcontextlost", failed, true);
    return () => {
      target?.removeEventListener("spatial-context-lost", failed);
      target?.removeEventListener("webglcontextlost", failed, true);
    };
  }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraft([]);
        setSkillDraft([]);
        setPair(null);
        setInteraction("inspect");
        setLasso(false);
        setNotice("Draft selection cancelled. Applied cohort is unchanged.");
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);
  const labels = useMemo(
    () =>
      Object.fromEntries(
        [
          ...(catalog?.companies || []),
          ...(catalog?.occupations || []),
          ...(catalog?.skills || []),
        ].map((x) => [x.id, x.name]),
      ),
    [catalog],
  );
  const label = (id: string) => labels[id] || id;
  const cells = scene?.data.cells || [],
    companies = scene?.data.companies || [],
    nodes = scene?.data.nodes || [],
    edges = scene?.data.edges || [];
  const activeCells = cells.filter(
    (c) => shelf === "All arrangements" || c.arrangement === shelf,
  );
  const axes = scene?.data.axes;
  const shownItems =
    lens === "demand_shelves"
      ? activeCells.map((c) => ({
          id: c.id,
          label: `${c.occupationLabel} · ${c.level} · ${c.arrangement}`,
          count: c.count,
        }))
      : lens === "coverage_cube"
        ? companies
            .filter((c) => c.count > 0)
            .map((c) => ({ id: c.id, label: c.label, count: c.count }))
        : nodes;
  const allDraft = lens === "skill_neighborhood" ? skillDraft : draft;
  function changeMode(next: Mode) {
    if (next !== mode) {
      setA(null);
      setB(null);
      setCommitted(null);
      if (next !== "local" && support < 20) setSupport(20);
      setMode(next);
      setNotice(
        "Source mode changed. Applied selection and frozen cohorts were cleared; sources are never mixed.",
      );
    }
  }
  function choose(id: string) {
    setInspected(id);
    setInspectedIds([id]);
    if (interaction === "select") {
      if (lens === "skill_neighborhood") {
        setPair(null);
        setSkillDraft((old) =>
          old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
        );
      } else
        setDraft((old) =>
          old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
        );
    }
  }
  function selection(): Selection | null {
    return lens === "skill_neighborhood"
      ? pair
        ? { kind: "skill_pair", skillIds: pair }
        : skillDraft.length
          ? { kind: "skill_set", operator, skillIds: skillDraft }
          : null
      : draft.length
        ? { kind: "cell_union", cellIds: draft }
        : null;
  }
  function apply() {
    const value = selection();
    if (scene && value) {
      setCommitted({
        sceneRequest: scene.sceneRequest,
        sceneQueryHash: scene.queryHash,
        selection: value,
      });
      setOffset(0);
      setNotice(
        "Selection applied. Records and export use the exact server-resolved contributor set.",
      );
    }
  }
  function pin(which: "a" | "b") {
    if (!committed || !selectedData) return;
    const value: Pin = {
      label: `${which.toUpperCase()} · ${lensNames[committed.sceneRequest.lens]}`,
      request: structuredClone(committed),
      count: selectedData.matchedCount,
      hash: selectedData.contributorHash,
    };
    (which === "a" ? setA : setB)(value);
    setNotice(
      `Cohort ${which.toUpperCase()} frozen. Later scene changes do not retarget it.`,
    );
  }
  async function exportCsv() {
    if (!committed || !selectedData) return;
    const exportRequest = structuredClone(committed),
      expectedHash = selectedData.contributorHash,
      expectedCount = selectedData.matchedCount;
    setExporting(true);
    try {
      const response = await fetch("/api/spatial/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportRequest),
      });
      if (!response.ok) {
        const body = await response.json();
        throw Error(body.error || "Export failed");
      }
      if (
        response.headers.get("X-Dataset-Version") !==
          exportRequest.sceneRequest.datasetVersion ||
        response.headers.get("X-Contributor-Hash") !== expectedHash ||
        response.headers.get("X-Export-Rows") !== String(expectedCount)
      )
        throw Error(
          "Export identity does not match the applied cohort. Nothing was downloaded.",
        );
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "jobmarket-spatial-contributors.csv";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  async function share() {
    if (!catalog) return;
    const value = {
      version: "2.5.1",
      datasetVersion: catalog.datasetVersion,
      mode,
      filter,
      lens,
      basis,
      focusSkillId: focusSkill,
      support,
    };
    const token = btoa(unescape(encodeURIComponent(JSON.stringify(value))));
    if (token.length > 18000) {
      setNotice(
        "This scene is too large for a share link. Use Save full study to preserve its filters and cohorts.",
      );
      return;
    }
    const url = new URL("/spatial", location.origin);
    url.searchParams.set("study", token);
    try {
      await navigator.clipboard.writeText(url.toString());
      history.replaceState(null, "", url);
      setNotice(
        "Scene link copied. It includes the release and filters; private text, draft selections and frozen cohorts are excluded.",
      );
    } catch {
      history.replaceState(null, "", url);
      setNotice(
        "Scene link is ready in the address bar. It includes filters and release, without frozen cohorts.",
      );
    }
  }
  function downloadStudy() {
    if (!catalog) return;
    const study: SpatialStudy = {
      version: "2.5.1",
      datasetVersion: catalog.datasetVersion,
      mode,
      filter,
      lens,
      basis,
      focusSkillId: focusSkill,
      support,
      shelf,
      committed,
      a,
      b,
    };
    const blob = new Blob([JSON.stringify(study, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "jobmarket-spatial-study.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(
      "Full study saved: source, filters, basis, focus, support, applied selection and frozen A/B. No private text or record data is included.",
    );
  }
  async function importStudy(file: File) {
    if (!catalog) return;
    const importTicket = ++importSequence.current,
      context = requestCounter.current;
    try {
      if (file.size > 131072)
        throw Error("Study exceeds the 128 KiB state limit.");
      const state = parseStudy(await file.text(), catalog.datasetVersion);
      const verify = async (pin: Pin | null): Promise<Pin | null> => {
        if (!pin) return null;
        const result = await api<SelectedResponse>("/api/spatial/selection", {
          method: "POST",
          body: JSON.stringify({
            ...pin.request,
            page: { offset: 0, limit: 1 },
          }),
        });
        return {
          label: "Restored · " + lensNames[pin.request.sceneRequest.lens],
          request: pin.request,
          count: result.matchedCount,
          hash: result.contributorHash,
        };
      };
      const [newA, newB] = await Promise.all([
        verify(state.a),
        verify(state.b),
      ]);
      if (state.committed)
        await api("/api/spatial/selection", {
          method: "POST",
          body: JSON.stringify({
            ...state.committed,
            page: { offset: 0, limit: 1 },
          }),
        });
      if (
        importTicket !== importSequence.current ||
        context !== requestCounter.current
      ) {
        setNotice(
          "Study restore cancelled because the scene changed or another restore started.",
        );
        return;
      }
      restoring.current = true;
      setMode(state.mode);
      setFilter(state.filter);
      setSearch(state.filter.search || "");
      setLens(state.lens);
      setBasis(state.basis);
      setFocusSkill(state.focusSkillId);
      setSupport(state.support);
      setShelf(state.shelf);
      setA(newA);
      setB(newB);
      setCommitted(state.committed);
      setOffset(0);
      setView("2d");
      setNotice(
        "Study restored after server validation. Frozen cohort counts were recomputed against their original release and source.",
      );
    } catch (error) {
      if (
        importTicket === importSequence.current &&
        context === requestCounter.current
      )
        setNotice((error as Error).message);
    }
  }
  const marks = useMemo<Mark[]>(
    () =>
      lens === "demand_shelves"
        ? activeCells.map((c) => ({
            id: c.id,
            label: `${c.occupationLabel} / ${c.level} / ${c.arrangement}`,
            count: c.count,
            position: [
              (axes?.occupations.findIndex((o) => o.id === c.occupationId) ||
                0) - 11,
              (axes?.levels.indexOf(c.level) || 0) * 1.35 - 4.7,
              arrangements.indexOf(c.arrangement) * 3 - 4.5,
            ],
          }))
        : lens === "coverage_cube"
          ? companies
              .filter((c) => c.count > 0)
              .map((c) => ({
                id: c.id,
                label: c.label,
                count: c.count,
                position: [
                  (c.knownCountryCount / c.count) * 20 - 10,
                  (c.eligiblePayCount / c.count) * 12 - 6,
                  (Math.log1p(c.count) /
                    Math.log1p(Math.max(1, ...companies.map((x) => x.count)))) *
                    12 -
                    6,
                ],
              }))
          : nodes.map((n, i) => ({
              id: n.id,
              label: n.label,
              count: n.count,
              position: [
                Math.cos(skillAngle(n.id)) * 9,
                Math.sin(skillAngle(n.id)) * 7,
                Math.sin(skillAngle(n.id) * 2.4) * 3,
              ],
            })),
    [scene, shelf, lens],
  );
  const inspectedCells = inspectedIds.length
    ? cells.filter((c) => inspectedIds.includes(c.id))
    : cells.filter((c) => c.id === inspected);
  const inspectedCell = inspectedCells[0],
    inspectedCompany = companies.find((c) => c.id === inspected),
    inspectedNode = nodes.find((c) => c.id === inspected);
  const inspectedLabel = inspectedCell
    ? `${inspectedCell.occupationLabel} · ${inspectedCell.level} · ${inspectedCells.length > 1 ? "All arrangements" : inspectedCell.arrangement}`
    : inspectedCompany?.label || inspectedNode?.label;
  const inspectCount = inspectedCells.length
    ? inspectedCells.reduce((sum, c) => sum + c.count, 0)
    : (inspectedCompany?.count ?? inspectedNode?.count);
  const can3d = () => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2");
      if (!gl) return false;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return true;
    } catch {
      return false;
    }
  };
  return (
    <div className="spatial-app" ref={root}>
      <a className="skip-link" href="#spatial-main">
        Skip to spatial analysis
      </a>
      <header className="spatial-header">
        <a className="brand" href="/canvas">
          <img src="/brand/mark.svg" width="36" height="36" alt="" />
          <span>
            <strong>JobMarket Lens</strong>
            <small>
              SPATIAL LAB <b>2.5.1</b>
            </small>
          </span>
        </a>
        <nav aria-label="Spatial navigation">
          <a href="/canvas">
            <ArrowLeft size={15} /> Research canvas
          </a>
          <span className="spatial-lab-badge">
            THREE DIMENSIONS. EXACT EVIDENCE.
          </span>
        </nav>
        <button className="button" onClick={share} disabled={!catalog}>
          <Share2 size={15} />
          Share scene
        </button>
      </header>
      <main id="spatial-main">
        <div className="spatial-intro">
          <div>
            <p className="eyebrow">
              A DIFFERENT PERSPECTIVE / THE SAME EVIDENCE
            </p>
            <h1>
              Give the question
              <br />
              <em>another dimension.</em>
            </h1>
            <p>
              Explore the structure of recorded demand. Isolate a layer, check
              what is unknown, and follow every selection to its contributors.
            </p>
          </div>
          <div className="spatial-intro-note">
            <Layers3 size={25} />
            <strong>
              Spatial is optional.
              <br />
              Evidence is essential.
            </strong>
            <span>
              Every view has an exact 2D and keyboard equivalent. Category
              spacing is never a measure of similarity.
            </span>
          </div>
        </div>
        {notice && (
          <div className="spatial-notice" role="status">
            <span>{notice}</span>
            <button aria-label="Dismiss message" onClick={() => setNotice("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {catalogError && (
          <div className="alert error" role="alert">
            {catalogError}
            <button onClick={() => location.reload()}>Reload</button>
          </div>
        )}
        {!catalog && !catalogError ? (
          <div className="spatial-loading" role="status">
            Opening the bounded research service…
          </div>
        ) : (
          catalog && (
            <>
              <form
                className="spatial-filters"
                onSubmit={(e) => {
                  e.preventDefault();
                  setFilter((old) => ({ ...old, search: search.trim() }));
                }}
              >
                <label>
                  Source basis
                  <select
                    value={mode}
                    onChange={(e) => changeMode(e.target.value as Mode)}
                  >
                    <option value="combined">Combined inventory</option>
                    <option value="upstream">Upstream reported</option>
                    <option value="local">Local observed</option>
                  </select>
                </label>
                <label>
                  Reported availability
                  <select
                    value={filter.availability || "open"}
                    onChange={(e) =>
                      setFilter({
                        ...filter,
                        availability: e.target.value as Filter["availability"],
                      })
                    }
                  >
                    <option value="open">Reported / observed open</option>
                    <option value="all">All reported statuses</option>
                    <option value="closed">Reported closed</option>
                  </select>
                </label>
                <label>
                  Employer focus
                  <select
                    value={filter.companyIds?.[0] || ""}
                    onChange={(e) =>
                      setFilter({
                        ...filter,
                        companyIds: e.target.value ? [e.target.value] : [],
                      })
                    }
                  >
                    <option value="">All employers</option>
                    {catalog.companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="spatial-search">
                  Search recorded fields
                  <input
                    value={search}
                    maxLength={160}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Role, employer or recorded skill"
                  />
                </label>
                <button className="button primary" type="submit">
                  <SlidersHorizontal size={15} />
                  Apply search
                </button>
                {filter.search && (
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setFilter({ ...filter, search: "" });
                    }}
                  >
                    Clear search
                  </button>
                )}
              </form>
              <div
                className="spatial-filter-chips"
                aria-label="All active filters"
              >
                {Object.entries(filter).flatMap(([key, value]) =>
                  Array.isArray(value) ? (
                    value.map((item) => (
                      <span key={key + item}>
                        {key.replace("Ids", "")}: {label(item)}
                      </span>
                    ))
                  ) : value ? (
                    <span key={key}>
                      {key}: {value}
                    </span>
                  ) : (
                    []
                  ),
                )}
                <button
                  onClick={() => {
                    setSearch("");
                    setFilter({ availability: "open" });
                  }}
                >
                  Clear all filters
                </button>
              </div>
              <div className="spatial-study-actions">
                <button className="button" onClick={downloadStudy}>
                  <Download size={14} />
                  Save full study
                </button>
                <label>
                  Restore full study
                  <input
                    aria-label="Restore full study JSON"
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void importStudy(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                <p>
                  JSON preserves applied selection and frozen A/B. Scene links
                  preserve scene controls.
                </p>
              </div>
              <div className="spatial-release">
                <span>
                  <span className="tiny-dot" />
                  {scene
                    ? `${count(scene.matchedCount)} matching postings`
                    : sceneQuery.loading
                      ? "Resolving population…"
                      : "Population unavailable"}
                </span>
                <span>
                  {mode} · {filter.availability || "open"} · release{" "}
                  {catalog.datasetVersion.slice(0, 10)}
                </span>
                <span>Source dates and methods remain in the evidence.</span>
              </div>
              <div
                className="spatial-lens-tabs"
                role="tablist"
                aria-label="Analytical lens"
              >
                {(Object.keys(lensNames) as Lens[]).map((key, i) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={lens === key}
                    onClick={() => setLens(key)}
                  >
                    <span>0{i + 1}</span>
                    {lensNames[key]}
                    <small>
                      {
                        [
                          "Occupation × level × arrangement",
                          "Country and pay comparison coverage",
                          "Supported recorded co-mentions",
                        ][i]
                      }
                    </small>
                  </button>
                ))}
              </div>
              <div className="spatial-board">
                <section
                  className="spatial-scene-card"
                  aria-label={lensNames[lens]}
                >
                  <div className="spatial-card-heading">
                    <div>
                      <p className="eyebrow">
                        {lens === "demand_shelves"
                          ? "CATEGORICAL RELATIONSHIPS"
                          : lens === "coverage_cube"
                            ? "QUANTITATIVE COVERAGE"
                            : "QUALITATIVE LAYOUT / EXACT PAIR COUNTS"}
                      </p>
                      <h2>{lensNames[lens]}</h2>
                    </div>
                    <div
                      className="spatial-view-toggle"
                      aria-label="Display mode"
                    >
                      <button
                        aria-pressed={view === "2d"}
                        onClick={() => setView("2d")}
                      >
                        <List size={15} />
                        2D
                      </button>
                      <button
                        aria-pressed={view === "3d"}
                        disabled={renderFailed}
                        onClick={() => {
                          if (can3d()) setView("3d");
                          else
                            setNotice(
                              "WebGL2 is unavailable. The complete 2D view remains ready.",
                            );
                        }}
                      >
                        <Box size={15} />
                        3D
                      </button>
                    </div>
                  </div>
                  <div className="spatial-scene-controls">
                    <label>
                      Action
                      <select
                        value={interaction}
                        onChange={(e) =>
                          setInteraction(e.target.value as "inspect" | "select")
                        }
                      >
                        <option value="inspect">Inspect marks</option>
                        <option value="select">Select contributors</option>
                      </select>
                    </label>
                    {lens === "demand_shelves" && (
                      <label>
                        Arrangement layer
                        <select
                          value={shelf}
                          onChange={(e) => setShelf(e.target.value)}
                        >
                          <option>All arrangements</option>
                          {arrangements.map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    {lens === "demand_shelves" && (
                      <button
                        className="button"
                        disabled={shelf === "All arrangements"}
                        aria-pressed={lasso}
                        onClick={() => {
                          setLasso(!lasso);
                          setView("2d");
                          setInteraction("select");
                        }}
                      >
                        Lasso isolated layer
                      </button>
                    )}
                    {lens === "skill_neighborhood" && (
                      <>
                        <label>
                          Focus skill
                          <select
                            value={focusSkill}
                            onChange={(e) => setFocusSkill(e.target.value)}
                          >
                            {catalog.skills.map((s) => (
                              <option value={s.id} key={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Observation basis
                          <select
                            value={basis}
                            onChange={(e) => setBasis(e.target.value as Basis)}
                          >
                            <option value="recorded_mentions">
                              Recorded mentions
                            </option>
                            <option value="analyzed_text">
                              Known locally analyzed text
                            </option>
                          </select>
                        </label>
                        <label>
                          Minimum pair support
                          <select
                            value={support}
                            onChange={(e) => setSupport(Number(e.target.value))}
                          >
                            <option value={20}>20 (default)</option>
                            <option value={5} disabled={mode !== "local"}>
                              5 (local-only, low support)
                            </option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                          </select>
                        </label>
                      </>
                    )}
                    {view === "3d" && (
                      <div
                        className="spatial-camera"
                        aria-label="Camera presets"
                      >
                        {["overview", "front", "top", "side"].map((p) => (
                          <button
                            key={p}
                            onClick={() => setPreset(`${p}:${Date.now()}`)}
                          >
                            {p}
                          </button>
                        ))}
                        <button
                          aria-label="Reset camera"
                          onClick={() => setPreset(`overview:${Date.now()}`)}
                        >
                          <RotateCcw size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  {sceneQuery.loading ? (
                    <div className="spatial-loading" role="status">
                      Resolving bounded aggregate cells…
                    </div>
                  ) : sceneQuery.error ? (
                    <div className="alert error" role="alert">
                      {sceneQuery.error}
                    </div>
                  ) : scene && (!scene.matchedCount || !scene.analysisCount) ? (
                    <div className="spatial-empty">
                      <h3>
                        {scene.matchedCount
                          ? "No contributors on this observation basis."
                          : "No contributors in this population."}
                      </h3>
                      <p>
                        {scene.matchedCount
                          ? `${count(scene.matchedCount)} postings match the filters, but none have known analyzed text on this source basis. Switch to recorded mentions to inspect the available metadata; unknown text coverage is not negative evidence.`
                          : "Broaden the search or source filters. Unknown information has not been turned into zero-valued evidence."}
                      </p>
                    </div>
                  ) : (
                    scene && (
                      <>
                        <div
                          className={`spatial-viewport ${view === "3d" ? "is-3d" : ""}`}
                        >
                          {view === "3d" ? (
                            <SceneBoundary
                              onFailure={() => {
                                setView("2d");
                                setRenderFailed(true);
                                setNotice(
                                  "3D could not start. Your complete 2D view and cohorts are preserved.",
                                );
                              }}
                            >
                              <Suspense
                                fallback={
                                  <div className="spatial-loading">
                                    Loading the optional 3D renderer…
                                  </div>
                                }
                              >
                                <SpatialScene
                                  marks={marks}
                                  selected={allDraft}
                                  onPick={choose}
                                  preset={preset}
                                  selecting={interaction === "select"}
                                  lens={lens}
                                  links={edges}
                                  maxCount={Math.max(
                                    1,
                                    ...(lens === "demand_shelves"
                                      ? cells
                                      : lens === "coverage_cube"
                                        ? companies
                                        : nodes
                                    ).map((x) => x.count),
                                  )}
                                />
                              </Suspense>
                            </SceneBoundary>
                          ) : lens === "demand_shelves" &&
                            lasso &&
                            shelf !== "All arrangements" ? (
                            <LassoShelf
                              cells={activeCells}
                              axes={axes}
                              selected={draft}
                              onSelect={(ids) => {
                                setDraft(ids);
                                setNotice(
                                  `${ids.length} cell centers in the lasso draft. Apply to resolve exact contributors.`,
                                );
                              }}
                            />
                          ) : lens === "demand_shelves" ? (
                            <DemandMatrix
                              cells={activeCells}
                              axes={axes}
                              draft={draft}
                              onPick={(ids) => {
                                setInspected(ids[0] || "");
                                setInspectedIds(ids);
                                if (interaction === "select")
                                  setDraft((old) =>
                                    ids.every((id) => old.includes(id))
                                      ? old.filter((id) => !ids.includes(id))
                                      : [...new Set([...old, ...ids])],
                                  );
                              }}
                            />
                          ) : lens === "coverage_cube" ? (
                            <CoveragePlot
                              companies={companies}
                              selected={draft}
                              onPick={choose}
                            />
                          ) : (
                            <SkillPlot
                              nodes={nodes}
                              edges={edges}
                              selected={skillDraft}
                              onPick={choose}
                              onEdge={(e) => {
                                setPair([e.a, e.b]);
                                setSkillDraft([]);
                                setInteraction("select");
                                setNotice(
                                  `Pair selected: ${label(e.a)} + ${label(e.b)}. Apply to resolve postings recording both.`,
                                );
                              }}
                            />
                          )}
                        </div>
                        {view === "3d" && (
                          <div className="spatial-3d-key">
                            <strong>AXIS KEY</strong>
                            {lens === "demand_shelves" ? (
                              <>
                                <span>
                                  Red X: occupation order · Green Y: level order
                                  · Blue Z: Remote → Hybrid → On-site → Unknown
                                </span>
                                <details>
                                  <summary>Read category ticks</summary>
                                  <p>
                                    X left to right:{" "}
                                    {axes?.occupations
                                      .map((o) => `${o.id} ${o.label}`)
                                      .join(" · ")}
                                  </p>
                                  <p>
                                    Y bottom to top: {axes?.levels.join(" · ")}
                                  </p>
                                </details>
                              </>
                            ) : lens === "coverage_cube" ? (
                              <span>
                                Red X: known country 0–100% · Green Y: eligible
                                USD pay 0–100% · Blue Z: log1p count, 0–
                                {count(
                                  Math.max(0, ...companies.map((c) => c.count)),
                                )}{" "}
                                raw postings
                              </span>
                            ) : (
                              <span>
                                All three coordinates are display layout only.
                                Edges show supported pairs; no coordinate
                                encodes skill distance.
                              </span>
                            )}
                            <span>
                              Counts use one area scale across this query.
                              Camera zoom changes display size, never count or
                              membership.
                            </span>
                          </div>
                        )}
                        <div className="spatial-axis-note">
                          {lens === "demand_shelves" ? (
                            <>
                              <strong>X</strong> occupation · <strong>Y</strong>{" "}
                              level · <strong>Z</strong> arrangement shelves.
                              {lasso &&
                              view === "2d" &&
                              shelf !== "All arrangements"
                                ? "Lasso handles have fixed size; exact counts are in the group list. "
                                : "Circle area = posting count. "}
                              Categorical spacing has no numeric meaning.
                            </>
                          ) : lens === "coverage_cube" ? (
                            <>
                              <strong>X</strong> known-country share ·{" "}
                              <strong>Y</strong> eligible USD-pay share ·{" "}
                              <strong>Z in 3D</strong> log1p posting count.
                              Circle area = posting count.
                            </>
                          ) : (
                            <>
                              Positions are a stable display arrangement, not
                              measured skill distance. Edges mean recorded
                              co-mentions, without causal or career-transition
                              claims.
                            </>
                          )}
                        </div>
                        <div className="spatial-coverage-strip">
                          <span>
                            {count(scene.data.coverage.shownGroups)} /{" "}
                            {count(scene.data.coverage.qualifyingGroups)} groups
                            shown
                          </span>
                          <span>
                            {count(scene.data.coverage.representedPostings)}{" "}
                            represented contributors
                          </span>
                          <span>
                            {count(scene.data.coverage.omittedGroups)} omitted
                            groups
                            {scene.data.coverage.omittedEdges !== undefined
                              ? ` · ${count(scene.data.coverage.shownEdges)} / ${count(scene.data.coverage.qualifyingEdges)} edges shown`
                              : ""}
                          </span>
                        </div>
                        {lens === "skill_neighborhood" && (
                          <p className="spatial-caution">
                            Basis: {basis.replaceAll("_", " ")} ·{" "}
                            {count(scene.analysisCount)} observation population
                            · {count(scene.basisExcludedCount)} excluded by
                            basis. Pair support ≥ max({support}, 0.2% of this
                            population). Empty skill lists and unknown upstream
                            text do not demonstrate absence.
                          </p>
                        )}
                      </>
                    )
                  )}
                  <div className="spatial-selection-bar">
                    <MousePointer2 size={18} />
                    <span>
                      <strong>
                        {pair
                          ? "1 skill pair"
                          : `${allDraft.length} ${lens === "skill_neighborhood" ? "skills" : "aggregate cells"}`}
                      </strong>{" "}
                      in draft · changes apply explicitly
                    </span>
                    {lens === "skill_neighborhood" && !pair && (
                      <label className="spatial-anyall">
                        Match
                        <select
                          value={operator}
                          onChange={(e) =>
                            setOperator(e.target.value as "any" | "all")
                          }
                        >
                          <option value="any">ANY selected skill</option>
                          <option value="all">ALL selected skills</option>
                        </select>
                      </label>
                    )}
                    <button
                      className="button"
                      onClick={() => {
                        setDraft([]);
                        setSkillDraft([]);
                        setPair(null);
                      }}
                    >
                      Clear draft
                    </button>
                    <button
                      className="button primary"
                      disabled={!selection() || !scene}
                      onClick={apply}
                    >
                      <Check size={16} />
                      Apply selection
                    </button>
                  </div>
                </section>
                <aside className="spatial-evidence-rail">
                  <p className="eyebrow">EXACT CONTRIBUTORS / EVIDENCE</p>
                  <h2>
                    What supports
                    <br />
                    this view?
                  </h2>
                  {inspectedLabel ? (
                    <div className="spatial-inspected">
                      <small>INSPECTED GROUP</small>
                      <h3>{inspectedLabel}</h3>
                      <strong>{count(inspectCount)}</strong>
                      <span>distinct postings in this group</span>
                      {inspectedCell && (
                        <p>
                          {count(
                            inspectedCells.reduce(
                              (sum, c) => sum + c.eligiblePayCount,
                              0,
                            ),
                          )}{" "}
                          eligible USD pay ·{" "}
                          {count(
                            inspectedCells.reduce(
                              (sum, c) => sum + c.analyzedTextCount,
                              0,
                            ),
                          )}{" "}
                          known analyzed text
                        </p>
                      )}
                      {inspectedCompany && (
                        <p>
                          Known country{" "}
                          {pct(
                            inspectedCompany.knownCountryCount,
                            inspectedCompany.count,
                          )}{" "}
                          · eligible USD pay{" "}
                          {pct(
                            inspectedCompany.eligiblePayCount,
                            inspectedCompany.count,
                          )}
                        </p>
                      )}
                      <button
                        className="button"
                        onClick={() => {
                          if (lens === "skill_neighborhood") {
                            setSkillDraft([inspected]);
                            setPair(null);
                          } else
                            setDraft(
                              inspectedIds.length ? inspectedIds : [inspected],
                            );
                          setInteraction("select");
                        }}
                      >
                        Use this group as draft
                      </button>
                    </div>
                  ) : (
                    <div className="spatial-inspect-hint">
                      <MousePointer2 size={23} />
                      <p>
                        Inspect a mark or an exact-list row to see its evidence.
                        Select mode builds a draft; Apply resolves its
                        contributors.
                      </p>
                    </div>
                  )}
                  <div className="spatial-applied">
                    <small>APPLIED COHORT</small>
                    <strong>
                      {committed
                        ? selected.loading
                          ? "…"
                          : selectedData
                            ? count(selectedData.matchedCount)
                            : "Unavailable"
                        : "—"}
                    </strong>
                    <p>
                      {committed
                        ? selectedData
                          ? "Distinct posting IDs, resolved on the server."
                          : selected.loading
                            ? "Resolving the applied selection…"
                            : "Selection unavailable. No count or export has been established."
                        : "No cohort applied. Inspecting or moving the camera does not change membership."}
                    </p>
                    {selected.error && <p role="alert">{selected.error}</p>}
                    <div className="spatial-pin-actions">
                      <button disabled={!selectedData} onClick={() => pin("a")}>
                        Freeze A
                      </button>
                      <button disabled={!selectedData} onClick={() => pin("b")}>
                        Freeze B
                      </button>
                    </div>
                    <button
                      className="button"
                      disabled={!selectedData || exporting}
                      onClick={exportCsv}
                    >
                      <Download size={15} />
                      {exporting
                        ? "Preparing exact CSV…"
                        : "Export exact contributors"}
                    </button>
                    {selectedData && (
                      <small className="spatial-hash">
                        Contributor hash{" "}
                        {selectedData.contributorHash.slice(0, 16)}
                      </small>
                    )}
                  </div>
                  <div className="spatial-truth-note">
                    <strong>Missing is not a market problem.</strong>
                    <p>
                      Valid non-USD pay is outside the USD comparison, not
                      invalid pay. Different reporting bases can describe the
                      same open state.
                    </p>
                  </div>
                  {scene?.data.diagnostics && (
                    <dl className="spatial-diagnostics">
                      <div>
                        <dt>Overlapping source pairs in this population</dt>
                        <dd>{count(scene.data.diagnostics.totalPairs)}</dd>
                      </div>
                      {[
                        [
                          "basisDifferences",
                          "Observation / reporting basis differences",
                        ],
                        [
                          "semanticStateDisagreements",
                          "Normalized state disagreements",
                        ],
                        ["dateDifferences", "Recorded date differences"],
                        [
                          "locationDifferences",
                          "Recorded location differences",
                        ],
                      ].map(([key, name]) => (
                        <div key={key}>
                          <dt>{name}</dt>
                          <dd>{count(scene.data.diagnostics?.[key])}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <p className="spatial-small">
                    This is a snapshot with uneven employer coverage. It does
                    not estimate the whole labor market, hires, or employee
                    supply.
                  </p>
                </aside>
              </div>
              <section className="spatial-exact-card">
                <div className="spatial-card-heading">
                  <div>
                    <p className="eyebrow">
                      EVERY MARK HAS AN EXACT ALTERNATIVE
                    </p>
                    <h2>Groups & selection</h2>
                  </div>
                  <button
                    className="button"
                    aria-expanded={listing}
                    onClick={() => setListing(!listing)}
                  >
                    {listing ? "Collapse exact list" : "Open exact list"}{" "}
                    <List size={16} />
                  </button>
                </div>
                <p className="spatial-small">
                  Keyboard-operable rows use the same aggregate IDs as the
                  scene. Selection includes the complete group, never just
                  visible record pages.
                </p>
                {listing && (
                  <div className="spatial-group-list">
                    {shownItems.length ? (
                      shownItems.map((item) => (
                        <div
                          key={item.id}
                          className={
                            allDraft.includes(item.id) ? "selected" : ""
                          }
                        >
                          <input
                            type="checkbox"
                            aria-label={`Select ${item.label}`}
                            checked={allDraft.includes(item.id)}
                            onChange={() => {
                              setInteraction("select");
                              if (lens === "skill_neighborhood") {
                                setPair(null);
                                setSkillDraft((old) =>
                                  old.includes(item.id)
                                    ? old.filter((x) => x !== item.id)
                                    : [...old, item.id],
                                );
                              } else
                                setDraft((old) =>
                                  old.includes(item.id)
                                    ? old.filter((x) => x !== item.id)
                                    : [...old, item.id],
                                );
                            }}
                          />
                          <button
                            onClick={() => {
                              setInspected(item.id);
                              setInspectedIds([item.id]);
                            }}
                          >
                            {item.label}
                          </button>
                          <strong>{count(item.count)}</strong>
                        </div>
                      ))
                    ) : (
                      <p>
                        No qualifying groups. Try another basis or explicit
                        support threshold.
                      </p>
                    )}
                  </div>
                )}
                {lens === "skill_neighborhood" && (
                  <details className="spatial-pair-list">
                    <summary>Exact skill pairs ({edges.length} shown)</summary>
                    <div className="spatial-table-scroll">
                      <table>
                        <caption>
                          Supported co-mentions; conditional shares use
                          recorded-skill marginals in the same observation
                          basis.
                        </caption>
                        <thead>
                          <tr>
                            <th>Recorded pair</th>
                            <th>Both</th>
                            <th>Jaccard</th>
                            <th>P(B | A)</th>
                            <th>P(A | B)</th>
                            <th>Selection</th>
                          </tr>
                        </thead>
                        <tbody>
                          {edges.map((e) => (
                            <tr key={e.id}>
                              <td>
                                {label(e.a)} + {label(e.b)}
                              </td>
                              <td>{count(e.count)}</td>
                              <td>{(e.jaccard * 100).toFixed(1)}%</td>
                              <td>{(e.aShare * 100).toFixed(1)}%</td>
                              <td>{(e.bShare * 100).toFixed(1)}%</td>
                              <td>
                                <button
                                  className="button"
                                  onClick={() => {
                                    setPair([e.a, e.b]);
                                    setSkillDraft([]);
                                    setInteraction("select");
                                  }}
                                >
                                  Draft both skills
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </section>
              <section className="spatial-comparison-card">
                <div>
                  <p className="eyebrow">
                    FROZEN SELECTIONS / SAME SOURCE & RELEASE
                  </p>
                  <h2>Compare without moving the goalposts.</h2>
                  <p>
                    Freeze an applied selection into A or B. Later filters and
                    camera changes leave its membership intact.
                  </p>
                </div>
                <div className="spatial-cohort-cards">
                  {(
                    [
                      ["a", a],
                      ["b", b],
                    ] as const
                  ).map(([key, p]) => (
                    <div key={key}>
                      <span>COHORT {key.toUpperCase()}</span>
                      <strong>{p ? count(p.count) : "—"}</strong>
                      <small>
                        {p ? p.label : "Apply a selection, then freeze it."}
                      </small>
                      {p && (
                        <details className="spatial-pin-context">
                          <summary>Frozen context</summary>
                          <p>
                            {p.request.sceneRequest.sourceMode} ·{" "}
                            {p.request.sceneRequest.basis.replaceAll("_", " ")}{" "}
                            · release{" "}
                            {p.request.sceneRequest.datasetVersion.slice(0, 10)}
                          </p>
                          <p>
                            {Object.entries(p.request.sceneRequest.filter)
                              .map(
                                ([key, value]) =>
                                  `${key}: ${Array.isArray(value) ? value.map(label).join(", ") : value}`,
                              )
                              .join(" · ")}
                          </p>
                          <p>
                            Selection:{" "}
                            {p.request.selection.kind.replaceAll("_", " ")} ·
                            hash {p.hash.slice(0, 12)}
                          </p>
                        </details>
                      )}
                      {p && (
                        <button
                          onClick={() =>
                            key === "a" ? setA(null) : setB(null)
                          }
                        >
                          Clear {key.toUpperCase()}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {comparison.loading && (
                  <p role="status">Resolving exact overlap…</p>
                )}
                {comparison.error && <p role="alert">{comparison.error}</p>}
                {comparison.data && (
                  <div className="spatial-overlap">
                    <div>
                      <strong>{count(comparison.data.data.onlyA)}</strong>
                      <span>Only A</span>
                    </div>
                    <div>
                      <strong>{count(comparison.data.data.overlap)}</strong>
                      <span>A ∩ B · overlaps retained</span>
                    </div>
                    <div>
                      <strong>{count(comparison.data.data.onlyB)}</strong>
                      <span>Only B</span>
                    </div>
                    <p>
                      A: {count(comparison.data.data.a.count)} · B:{" "}
                      {count(comparison.data.data.b.count)}. Shared contributors
                      are counted once in the union. Observation bases: A{" "}
                      {a?.request.sceneRequest.basis.replaceAll("_", " ")} · B{" "}
                      {b?.request.sceneRequest.basis.replaceAll("_", " ")}.
                    </p>
                  </div>
                )}
              </section>
              <section className="spatial-records-card">
                <div className="spatial-card-heading">
                  <div>
                    <p className="eyebrow">APPLIED COHORT / PUBLIC EVIDENCE</p>
                    <h2>Inspect the contributors.</h2>
                  </div>
                  {selectedData && (
                    <span>
                      {count(selectedData.matchedCount)} distinct postings ·
                      pages of 100
                    </span>
                  )}
                </div>
                {!committed ? (
                  <p>
                    Apply a selection to open its contributors. Detailed posting
                    data stays on the server until requested.
                  </p>
                ) : selected.loading ? (
                  <p role="status">Resolving this contributor page…</p>
                ) : selected.error ? (
                  <p role="alert">{selected.error}</p>
                ) : (
                  selectedData && (
                    <>
                      <div className="spatial-table-scroll">
                        <table>
                          <caption>
                            Exact contributors to the applied selection. Private
                            descriptions are excluded.
                          </caption>
                          <thead>
                            <tr>
                              <th>Posting</th>
                              <th>Employer</th>
                              <th>Arrangement</th>
                              <th>Reported level</th>
                              <th>Evidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedData.data.records.rows.map((row) => (
                              <tr key={row.id}>
                                <td>
                                  <button
                                    className="spatial-record-link"
                                    onClick={() => setDetail(row.id)}
                                  >
                                    {row.title}
                                  </button>
                                </td>
                                <td>{label(row.companyId)}</td>
                                <td>{row.arrangement || "Unknown"}</td>
                                <td>{row.level || "Unknown"}</td>
                                <td>
                                  {row.hasDescription === true
                                    ? "Known analyzed text"
                                    : row.hasDescription === false
                                      ? "No usable analyzed text"
                                      : "Text coverage unknown"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="spatial-pagination">
                        <button
                          className="button"
                          disabled={!offset}
                          onClick={() => setOffset(Math.max(0, offset - 100))}
                        >
                          <ChevronLeft size={15} />
                          Previous
                        </button>
                        <span>
                          {count(
                            Math.min(offset + 1, selectedData.matchedCount),
                          )}
                          –
                          {count(
                            Math.min(offset + 100, selectedData.matchedCount),
                          )}{" "}
                          of {count(selectedData.matchedCount)}
                        </span>
                        <button
                          className="button"
                          disabled={!selectedData.data.records.hasMore}
                          onClick={() => setOffset(offset + 100)}
                        >
                          Next
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    </>
                  )
                )}
              </section>
              <footer className="spatial-footer">
                <p>See the demand. Check the evidence.</p>
                <a href="/evidence">
                  Methods & source limitations <ArrowUpRight size={14} />
                </a>
                <span>
                  Three.js spatial prototype · exact Node semantic queries ·
                  optional 3D
                </span>
              </footer>
            </>
          )
        )}
      </main>
      {detail && catalog && (
        <Detail
          id={detail}
          mode={mode}
          catalog={catalog}
          label={label}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
function DemandMatrix({
  cells,
  axes,
  draft,
  onPick,
}: {
  cells: Cell[];
  axes: Scene["data"]["axes"];
  draft: string[];
  onPick: (ids: string[]) => void;
}) {
  if (!axes) return null;
  const totals = new Map<string, number>();
  cells.forEach((c) => {
    const key = c.occupationId + "|" + c.level;
    totals.set(key, (totals.get(key) || 0) + c.count);
  });
  const max = Math.max(1, ...totals.values());
  return (
    <div className="spatial-demand-matrix">
      <table>
        <caption>
          Occupation by level. Arrangement filter controls the shelf; All
          arrangements combines exact cell unions.
        </caption>
        <thead>
          <tr>
            <th>Occupation / level</th>
            {axes.levels.map((level) => (
              <th key={level}>{level}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {axes.occupations.map((o) => (
            <tr key={o.id}>
              <th scope="row">{o.label}</th>
              {axes.levels.map((level) => {
                const group = cells.filter(
                    (c) => c.occupationId === o.id && c.level === level,
                  ),
                  n = group.reduce((sum, c) => sum + c.count, 0),
                  active =
                    !!group.length && group.every((c) => draft.includes(c.id));
                return (
                  <td key={level}>
                    {n ? (
                      <button
                        className={active ? "active" : ""}
                        aria-label={`${o.label}, ${level}: ${count(n)} postings`}
                        aria-pressed={active}
                        onClick={() => onPick(group.map((c) => c.id))}
                      >
                        <span
                          className="spatial-matrix-dot"
                          style={{
                            width: `${34 * Math.sqrt(n / max)}px`,
                            height: `${34 * Math.sqrt(n / max)}px`,
                          }}
                        />
                        <span>{count(n)}</span>
                      </button>
                    ) : (
                      <span className="spatial-zero" aria-label="Zero postings">
                        —
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function CoveragePlot({
  companies,
  selected,
  onPick,
}: {
  companies: NonNullable<Scene["data"]["companies"]>;
  selected: string[];
  onPick: (id: string) => void;
}) {
  const max = Math.max(1, ...companies.map((c) => c.count));
  return (
    <svg
      viewBox="0 0 900 460"
      role="img"
      aria-labelledby="coverage-title coverage-description"
      className="spatial-svg"
    >
      <title id="coverage-title">Employer coverage comparison</title>
      <desc id="coverage-description">
        X is known-country share, Y is eligible USD-pay share. Circle area
        encodes posting count. Use the exact employer list below for keyboard
        inspection and selection.
      </desc>
      {[0, 25, 50, 75, 100].map((n) => (
        <g key={n}>
          <path
            d={`M70 ${390 - n * 3.2}H850 M${70 + n * 7.8} 70V390`}
            stroke="#dce7df"
          />
          <text x="55" y={394 - n * 3.2} textAnchor="end">
            {n}%
          </text>
          <text x={70 + n * 7.8} y="415" textAnchor="middle">
            {n}%
          </text>
        </g>
      ))}
      <text x="460" y="449" textAnchor="middle">
        Postings with at least one known country / employer postings
      </text>
      <text transform="translate(18 230) rotate(-90)" textAnchor="middle">
        Eligible USD pay / employer postings
      </text>
      {companies
        .filter((c) => c.count > 0)
        .map((c) => (
          <circle
            key={c.id}
            cx={70 + (c.knownCountryCount / c.count) * 780}
            cy={390 - (c.eligiblePayCount / c.count) * 320}
            r={17 * Math.sqrt(c.count / max)}
            fill={selected.includes(c.id) ? "#b06813" : "#28776d"}
            fillOpacity=".75"
            stroke={selected.includes(c.id) ? "#633a09" : "#f4f7f2"}
            strokeWidth={selected.includes(c.id) ? 3 : 1}
            onClick={() => onPick(c.id)}
          >
            <title>
              {c.label}: {count(c.count)} postings; known country{" "}
              {pct(c.knownCountryCount, c.count)}; USD eligible{" "}
              {pct(c.eligiblePayCount, c.count)}
            </title>
          </circle>
        ))}
    </svg>
  );
}
function SkillPlot({
  nodes,
  edges,
  selected,
  onPick,
  onEdge,
}: {
  nodes: NonNullable<Scene["data"]["nodes"]>;
  edges: Edge[];
  selected: string[];
  onPick: (id: string) => void;
  onEdge: (edge: Edge) => void;
}) {
  const positions = Object.fromEntries(
    nodes.map((n, i) => [
      n.id,
      {
        x: 450 + Math.cos(skillAngle(n.id)) * 290,
        y: 240 + Math.sin(skillAngle(n.id)) * 170,
      },
    ]),
  );
  return (
    <svg
      viewBox="0 0 900 480"
      role="img"
      aria-labelledby="skill-layout-title skill-layout-desc"
      className="spatial-svg"
    >
      <title id="skill-layout-title">
        Recorded skill co-mention neighborhood
      </title>
      <desc id="skill-layout-desc">
        Stable circular display, not a measured distance. Exact counts, Jaccard
        and conditional shares are in the pair list below.
      </desc>
      {edges.map((e) => {
        const a = positions[e.a],
          b = positions[e.b];
        return a && b ? (
          <line
            key={e.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#bed2c5"
            strokeWidth="1.3"
            onClick={() => onEdge(e)}
          >
            <title>{e.count} co-mentions</title>
          </line>
        ) : null;
      })}
      {nodes.map((n, i) => {
        const p = positions[n.id];
        return (
          <g key={n.id} onClick={() => onPick(n.id)}>
            <circle
              cx={p.x}
              cy={p.y}
              r={selected.includes(n.id) ? 10 : 7}
              fill={selected.includes(n.id) ? "#b06813" : "#28776d"}
            />
            {(nodes.length <= 18 || i % 3 === 0) && (
              <text x={p.x} y={p.y - 13} textAnchor="middle">
                {n.label.length > 22 ? n.label.slice(0, 20) + "…" : n.label}
              </text>
            )}
            <title>
              {n.label}: {count(n.count)} recorded mentions
            </title>
          </g>
        );
      })}
    </svg>
  );
}
