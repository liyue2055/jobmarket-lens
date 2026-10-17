import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Filter as FilterIcon,
  Info,
  Layers3,
  Link2,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import { Analytics } from "./Analytics";
import { Header } from "./Brand";
import { api, queryBody, useQuery } from "./api";
import {
  download,
  fieldLabels,
  fromLocation,
  initial,
  modeLabel,
  n,
  studyUrl,
  validateStudy,
  validateFilter,
} from "./state";
import type {
  Catalog,
  Comparison,
  Dimension,
  Envelope,
  Evidence,
  Filter,
  Mode,
  Overview,
  Posting,
  RecordsResult,
  SkillsResult,
  Study,
  Workspace,
} from "./types";
import {
  DemandMatrix,
  Distribution,
  ComparisonPanel,
  PayPanel,
  SkillsWorkspace,
  EvidenceWorkspace,
} from "./Workspace";
import { Detail } from "./Detail";
import { TourButton } from "./video/TourPlayer";
export function Studio() {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [study, setStudy] = useState<Study | null>(null),
    [error, setError] = useState(""),
    [blocked, setBlocked] = useState(false),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<string | null>(null),
    [filtersOpen, setFiltersOpen] = useState(false),
    [exporting, setExporting] = useState(false);
  const latest = useRef<Study | null>(null),
    file = useRef<HTMLInputElement>(null);
  latest.current = study;
  useEffect(() => {
    const controller = new AbortController();
    api<Catalog>("/api/catalog", { signal: controller.signal })
      .then((c) => {
        if (
          c.protocolVersion !== "2.5" ||
          !/^[a-f0-9]{64}$/.test(c.datasetVersion)
        )
          throw new Error("The catalog does not match this application.");
        setCatalog(c);
        try {
          const s = fromLocation(c.datasetVersion);
          setStudy(s);
          setSearch(s.filter.search || "");
          history.replaceState(s, "", location.href);
        } catch (e) {
          setStudy(initial(c.datasetVersion));
          setBlocked(true);
          setError((e as Error).message);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  const commit = useCallback((fn: (s: Study) => Study) => {
    if (!latest.current) return;
    const next = fn(latest.current);
    latest.current = next;
    setStudy(next);
    const url = studyUrl(next);
    history.pushState(next, "", url || "/" + next.workspace);
    setError("");
  }, []);
  useEffect(() => {
    if (!catalog) return;
    const pop = (event: PopStateEvent) => {
      try {
        const s = event.state
          ? validateStudy(event.state)
          : fromLocation(catalog.datasetVersion);
        if (s.datasetVersion !== catalog.datasetVersion)
          throw new Error("This history entry belongs to a different release.");
        setStudy(s);
        setSearch(s.filter.search || "");
        setOffset(0);
        setSelected(null);
      } catch (e) {
        setError((e as Error).message);
        setBlocked(true);
      }
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [catalog]);
  useEffect(() => {
    if (!study || blocked) return;
    const timer = setTimeout(() => {
      if (search !== (study.filter.search || "")) {
        commit((s) => ({ ...s, filter: { ...s.filter, search } }));
        setOffset(0);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, study?.filter.search, blocked, commit]);
  useEffect(() => {
    if (!filtersOpen) return;
    const previous = document.activeElement as HTMLElement;
    document
      .querySelector<HTMLButtonElement>('[aria-label="Close study filters"]')
      ?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFiltersOpen(false);
      if (e.key === "Tab") {
        const targets = [
          ...document.querySelectorAll<HTMLElement>(
            ".study-sidebar button,.study-sidebar select,.study-sidebar input",
          ),
        ].filter((x) => x.getClientRects().length > 0);
        if (e.shiftKey && document.activeElement === targets[0]) {
          e.preventDefault();
          targets.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === targets.at(-1)) {
          e.preventDefault();
          targets[0]?.focus();
        }
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, [filtersOpen]);
  const version = catalog?.datasetVersion || "",
    mode = study?.mode || "combined",
    filter = study?.filter || { availability: "open" },
    enabled = !!study && !blocked;
  const overview = useQuery<Overview>(
      mode,
      filter,
      version,
      "overview",
      {},
      enabled,
    ),
    records = useQuery<RecordsResult>(
      mode,
      filter,
      version,
      "records",
      { page: { offset, limit: 100 } },
      enabled,
    ),
    skills = useQuery<SkillsResult>(
      mode,
      filter,
      version,
      "skills",
      {},
      enabled && study?.workspace === "skills",
    ),
    evidence = useQuery<Evidence>(
      mode,
      filter,
      version,
      "evidence",
      {},
      enabled && study?.workspace === "evidence",
    );
  const compatible =
    !!study?.a &&
    !!study?.b &&
    study.a.mode === mode &&
    study.b.mode === mode &&
    study.a.datasetVersion === version &&
    study.b.datasetVersion === version;
  const comparison = useQuery<Comparison>(
    mode,
    { availability: "all" },
    version,
    "compare",
    { cohortA: study?.a?.filter, cohortB: study?.b?.filter },
    enabled && compatible,
  );
  const labels = useMemo(
    () =>
      new Map(
        [
          ...(catalog?.companies || []),
          ...(catalog?.occupations || []),
          ...(catalog?.skills || []),
        ].map((x) => [x.id, x.name]),
      ),
    [catalog],
  );
  const label = (id: string) =>
    id === "__unknown__" ? "Unknown" : labels.get(id) || id;
  const setFilter = (fn: (f: Filter) => Filter) => {
    if (!latest.current) return;
    const next = fn(latest.current.filter);
    try {
      validateFilter(next);
    } catch (error) {
      setNotice((error as Error).message);
      return;
    }
    commit((s) => ({ ...s, filter: next }));
    setOffset(0);
    setSelected(null);
  };
  const add = (field: Dimension, value: string) =>
    setFilter((f) => ({
      ...f,
      [field]: [...new Set([...(f[field] || []), value])],
    }));
  const exact = (values: Partial<Filter>) =>
    setFilter((f) => ({ ...f, ...values }));
  const remove = (field: Dimension, value: string) =>
    setFilter((f) => ({ ...f, [field]: f[field]?.filter((v) => v !== value) }));
  const reset = () => {
    setSearch("");
    setFilter(() => ({ availability: "open" }));
  };
  const pin = (slot: "a" | "b") => {
    if (!study || !overview.data || overview.loading) return;
    commit((s) => ({
      ...s,
      [slot]: {
        label: `Cohort ${slot.toUpperCase()}`,
        filter: structuredClone(s.filter),
        mode: s.mode,
        datasetVersion: s.datasetVersion,
        count: overview.data!.matchedCount,
      },
    }));
    setNotice(
      `Cohort ${slot.toUpperCase()} frozen. Refine this view to build another perspective.`,
    );
  };
  const share = async () => {
    if (!study) return;
    const url = studyUrl(study);
    if (!url) {
      download("jobmarket-lens-study.json", JSON.stringify(study, null, 2));
      setNotice(
        "This study exceeds the link budget. A portable study file was downloaded.",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Study link copied, including the release and frozen cohorts.");
    } catch {
      setNotice(
        "The browser address contains this reproducible study. Copy it to share.",
      );
    }
  };
  const exportRows = async () => {
    if (!study) return;
    setExporting(true);
    try {
      const request = queryBody(mode, filter, version, "records");
      const response = await fetch("/api/export", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Export failed.");
      }
      if (
        response.headers.get("X-Dataset-Version") !== version ||
        response.headers.get("X-Contributor-Hash") !==
          overview.data?.contributorHash
      )
        throw new Error(
          "Export contributor identity does not match the selected view. Retry after the query completes.",
        );
      const url = URL.createObjectURL(await response.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = "jobmarket-lens-study.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        `Exported ${n(overview.data?.matchedCount || 0)} matching public records. Formula-like spreadsheet text is escaped.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };
  const restore = async (f: File) => {
    try {
      if (f.size > 1_000_000) throw new Error("Study file exceeds 1 MB.");
      const s = validateStudy(JSON.parse(await f.text()));
      if (s.datasetVersion !== version)
        throw new Error(
          "This study uses a different release. Frozen cohorts cannot be retargeted automatically.",
        );
      commit(() => s);
      setSearch(s.filter.search || "");
      setOffset(0);
      setBlocked(false);
      setNotice("Study restored from its public filter definitions.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const queryError =
    error ||
    overview.error ||
    records.error ||
    skills.error ||
    evidence.error ||
    comparison.error;
  const selectedCount = overview.data?.matchedCount,
    workspace = study?.workspace || "canvas";
  return (
    <>
      <Analytics config={catalog?.analytics} workspace={workspace} />
      <a className="skip-link" href="#research">
        Skip to research
      </a>
      <Header
        workspace={workspace}
        onNavigate={(w) => {
          commit((s) => ({ ...s, workspace: w }));
          setSelected(null);
        }}
      />
      <main className="studio" id="research" tabIndex={-1}>
        <section className="studio-intro">
          <div>
            <div className="eyebrow">
              <span className="live-dot" />
              THE RESEARCH STUDIO / V2.5
            </div>
            <h1>
              See the demand.
              <br />
              <span>Check the evidence.</span>
            </h1>
            <p>
              A clearer perspective on job postings. One question, linked views,
              <br className="desktop" /> and the context behind every
              comparison.
            </p>
          </div>
          <div className="intro-right">
            <div className="release-pill">
              <Database size={13} />
              <span>RELEASE {version.slice(0, 8) || "LOADING"}</span>
            </div>
            <div className="release-date">
              {catalog?.asOf
                ? `Source as of ${catalog.asOf.slice(0, 10)}`
                : "Reading the source catalog"}
            </div>
            <div className="intro-actions">
              <TourButton currentDatasetVersion={catalog?.datasetVersion} />
              <button
                className="button secondary"
                onClick={share}
                disabled={!study || blocked}
              >
                <Link2 size={15} />
                Share study
              </button>
              <button
                className="button primary"
                onClick={exportRows}
                disabled={
                  !overview.data || overview.loading || blocked || exporting
                }
              >
                {exporting ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <ArrowDownToLine size={15} />
                )}
                Export records
              </button>
            </div>
          </div>
        </section>
        {queryError && (
          <div className="alert error" role="alert">
            <Info size={17} />
            <span>{queryError}</span>
            {blocked ? (
              <button
                onClick={() => {
                  if (catalog) {
                    const fresh = initial(catalog.datasetVersion);
                    commit(() => fresh);
                    setSearch("");
                    setBlocked(false);
                  }
                }}
              >
                Start a fresh study <ArrowRight size={14} />
              </button>
            ) : (
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}
        {notice && (
          <div className="alert notice" role="status">
            <Check size={16} />
            <span>{notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {!catalog || !study ? (
          <div className="initial-loading">
            <LoaderCircle size={28} className="spin" />
            <h2>
              {error
                ? "The research service is unavailable"
                : "Opening a new perspective"}
            </h2>
            <p>Reading the versioned source catalog.</p>
            {error && (
              <button
                className="button secondary"
                onClick={() => location.reload()}
              >
                Retry connection
              </button>
            )}
          </div>
        ) : (
          <div className="research-layout">
            <aside
              className={`study-sidebar ${filtersOpen ? "open" : ""}`}
              aria-label="Study filters"
              role={filtersOpen ? "dialog" : undefined}
              aria-modal={filtersOpen || undefined}
            >
              <div className="sidebar-heading">
                <div className="eyebrow">YOUR RESEARCH QUESTION</div>
                <button
                  className="icon-button mobile"
                  onClick={() => setFiltersOpen(false)}
                  aria-label="Close study filters"
                >
                  <X size={18} />
                </button>
              </div>
              <h2>Define the view.</h2>
              <p className="sidebar-description">
                A selection updates every panel.
              </p>
              <label className="search-field">
                <Search size={16} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search titles, employers or skills"
                  maxLength={160}
                  placeholder="Title, employer, skill…"
                />
                {search && (
                  <button
                    className="icon-button"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                  >
                    <X size={14} />
                  </button>
                )}
              </label>
              <div className="sidebar-section-label">
                <span>01</span>Population
              </div>
              <label className="select-field">
                Data source
                <select
                  value={mode}
                  aria-label="Data source"
                  onChange={(e) => {
                    commit((s) => ({ ...s, mode: e.target.value as Mode }));
                    setOffset(0);
                    setSelected(null);
                    if (study.a || study.b)
                      setNotice(
                        "Frozen cohorts retain their original source. Switch back to compare them or replace them explicitly.",
                      );
                  }}
                >
                  <option value="combined">Combined inventory</option>
                  <option value="upstream">Upstream reported</option>
                  <option value="local">Local observations</option>
                </select>
              </label>
              <label className="select-field">
                Availability
                <select
                  value={filter.availability || "open"}
                  aria-label="Availability"
                  onChange={(e) =>
                    setFilter((f) => ({
                      ...f,
                      availability: e.target.value as Filter["availability"],
                    }))
                  }
                >
                  <option value="open">Reported / observed open</option>
                  <option value="all">All statuses</option>
                  <option value="closed">Reported closed</option>
                </select>
              </label>
              <div className="population-caption">
                <span className="tiny-dot" />
                {n(catalog.counts[mode] || 0)} postings in source inventory
              </div>
              <div className="sidebar-section-label">
                <span>02</span>Refinements<button onClick={reset}>Reset</button>
              </div>
              <DimensionSelect
                title="Occupation"
                field="occupationIds"
                options={catalog.occupations}
                selected={filter.occupationIds || []}
                onAdd={add}
              />
              <DimensionSelect
                title="Employer"
                field="companyIds"
                options={catalog.companies}
                selected={filter.companyIds || []}
                onAdd={add}
              />
              <DimensionSelect
                title="Recorded skill"
                field="skillIds"
                options={catalog.skills}
                selected={filter.skillIds || []}
                onAdd={add}
              />
              <DimensionSelect
                title="Work arrangement"
                field="arrangements"
                options={["Remote", "Hybrid", "On-site"].map((id) => ({
                  id,
                  name: id,
                }))}
                selected={filter.arrangements || []}
                onAdd={add}
              />
              <DimensionSelect
                title="Country"
                field="countries"
                options={(overview.data?.data.countries || []).map((c) => ({
                  id: c.id,
                  name: c.label,
                }))}
                selected={filter.countries || []}
                onAdd={add}
              />
              <p className="filter-basis">
                Categories within a field use OR.
                <br />
                Selected skills must all be present.
                <br />
                Unknowns stay visible until a filter excludes them.
              </p>
              <div className="sidebar-section-label">
                <span>03</span>Make a comparison
              </div>
              <p className="sidebar-description">
                Pin a view, refine another.
                <br />
                The original stays frozen.
              </p>
              <div className="sidebar-pins">
                <button
                  onClick={() => pin("a")}
                  disabled={overview.loading || blocked}
                  className="pin-action"
                >
                  <b>A</b>Pin this view
                </button>
                <button
                  onClick={() => pin("b")}
                  disabled={overview.loading || blocked}
                  className="pin-action teal"
                >
                  <b>B</b>Pin this view
                </button>
              </div>
              <div className="sidebar-foot">
                <ShieldCheck size={18} />
                <p>
                  Public metadata. Private evidence stays private.
                  <a
                    href="/evidence"
                    onClick={(e) => {
                      e.preventDefault();
                      commit((s) => ({ ...s, workspace: "evidence" }));
                    }}
                  >
                    Understand the source <ArrowUpRight size={12} />
                  </a>
                </p>
              </div>
            </aside>
            <div className="board">
              <section className="scope-strip" aria-label="Current study scope">
                <div>
                  <span className="scope-icon">
                    <Layers3 size={17} />
                  </span>
                  <span>
                    <strong>{modeLabel[mode]}</strong>
                    <small>
                      {filter.availability === "all"
                        ? "All reported statuses"
                        : filter.availability === "closed"
                          ? "Reported closed"
                          : "Reported or observed open"}{" "}
                      · snapshot, not real-time vacancies
                    </small>
                  </span>
                </div>
                <div className="scope-actions">
                  <button
                    className="button secondary mobile"
                    onClick={() => setFiltersOpen(true)}
                  >
                    <SlidersHorizontal size={15} />
                    Filters
                  </button>
                  <span className="sample-badge">
                    <span />
                    Observed sample
                  </span>
                </div>
              </section>
              <div className="filter-chips" aria-label="Active refinements">
                {filter.search && (
                  <button
                    onClick={() => {
                      setSearch("");
                      setFilter((f) => ({ ...f, search: "" }));
                    }}
                  >
                    Search: {filter.search}
                    <X size={12} />
                  </button>
                )}
                {Object.entries(fieldLabels).flatMap(([key, title]) =>
                  (filter[key as Dimension] || []).map((value) => (
                    <button
                      key={key + value}
                      onClick={() => remove(key as Dimension, value)}
                    >
                      <span>{title}</span>
                      {label(value)}
                      <X size={12} />
                    </button>
                  )),
                )}
                {!filter.search &&
                  !Object.keys(fieldLabels).some(
                    (k) => (filter[k as Dimension] || []).length,
                  ) && (
                    <span>
                      Start with the whole observed inventory. Select a cell or
                      category to focus your question.
                    </span>
                  )}
              </div>
              <div
                className="selection-overview"
                aria-live="polite"
                aria-busy={overview.loading}
              >
                <div className="selected-number">
                  <span className="eyebrow">POSTINGS IN THIS VIEW</span>
                  <strong data-testid="matched-count">
                    {selectedCount === undefined ? "—" : n(selectedCount)}
                  </strong>
                  <span>
                    {overview.loading ? (
                      <>
                        <LoaderCircle size={12} className="spin" />
                        Updating the selection
                      </>
                    ) : (
                      <>
                        <span className="tiny-dot" />
                        {overview.data?.data.companyCount ?? "—"} employers
                        represented
                      </>
                    )}
                  </span>
                </div>
                <div className="overview-fact">
                  <span className="fact-icon">
                    <Database size={18} />
                  </span>
                  <div>
                    <strong>
                      {n(overview.data?.data.analyzedTextCount || 0)}
                      <small>
                        /{selectedCount === undefined ? "—" : n(selectedCount)}
                      </small>
                    </strong>
                    <span>Locally analyzed texts</span>
                  </div>
                </div>
                <div className="overview-fact">
                  <span className="fact-icon amber">
                    <Info size={18} />
                  </span>
                  <div>
                    <strong>
                      {n(overview.data?.data.eligiblePayCount || 0)}
                    </strong>
                    <span>Validated USD pay ranges</span>
                  </div>
                </div>
                <div className="view-pin-actions">
                  <button
                    className="button secondary"
                    onClick={() => pin("a")}
                    disabled={overview.loading || blocked}
                  >
                    <span className="letter a">A</span>Pin view
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => pin("b")}
                    disabled={overview.loading || blocked}
                  >
                    <span className="letter b">B</span>Pin view
                  </button>
                  {study.a && study.b && (
                    <button
                      className="text-button compare-jump"
                      onClick={() => {
                        document
                          .getElementById("cohort-comparison")
                          ?.scrollIntoView({ block: "center" });
                        document.getElementById("cohort-comparison")?.focus();
                      }}
                    >
                      Inspect comparison <ArrowRight size={12} />
                    </button>
                  )}
                </div>
              </div>
              {blocked ? (
                <div className="panel empty">
                  <ShieldCheck size={30} />
                  <h2>Keep the original study intact.</h2>
                  <p>
                    Its release is unavailable. Start a fresh study explicitly
                    to explore this release.
                  </p>
                </div>
              ) : (
                <div className="board-columns">
                  <div className="primary-column">
                    {workspace === "canvas" && (
                      <>
                        <DemandMatrix
                          data={overview.data?.data}
                          loading={overview.loading}
                          onSelect={(companyId, occupationId) =>
                            exact({
                              companyIds: [companyId],
                              occupationIds: [occupationId],
                            })
                          }
                        />
                        <div className="distribution-grid">
                          <Distribution
                            title="Which employers appear?"
                            eyebrow="EMPLOYER COMPOSITION"
                            categories={overview.data?.data.companies || []}
                            total={selectedCount || 0}
                            kind="employer"
                            onSelect={(id) => exact({ companyIds: [id] })}
                          />
                          <Distribution
                            title="Where is the location recorded?"
                            eyebrow="RECORDED COUNTRY"
                            categories={overview.data?.data.countries || []}
                            total={selectedCount || 0}
                            kind="country"
                            onSelect={(id) => exact({ countries: [id] })}
                          />
                        </div>
                      </>
                    )}
                    {workspace === "skills" && (
                      <SkillsWorkspace
                        response={skills.data}
                        loading={skills.loading}
                        onSelect={(ids) =>
                          exact({
                            skillIds: [
                              ...new Set([...(filter.skillIds || []), ...ids]),
                            ],
                          })
                        }
                      />
                    )}{" "}
                    {workspace === "evidence" && (
                      <EvidenceWorkspace
                        response={evidence.data}
                        catalog={catalog}
                        mode={mode}
                        overview={overview.data}
                        onExport={() =>
                          download(
                            "jobmarket-lens-study.json",
                            JSON.stringify(study, null, 2),
                          )
                        }
                        onImport={() => file.current?.click()}
                      />
                    )}
                  </div>
                  <aside
                    className="context-column"
                    aria-label="Cohort comparison and context"
                  >
                    <ComparisonPanel
                      study={study}
                      result={comparison.data?.data}
                      loading={comparison.loading}
                      compatible={compatible}
                      label={label}
                      onPin={pin}
                      onClear={(slot) =>
                        commit((s) => ({ ...s, [slot]: null }))
                      }
                      onRename={(slot, name) =>
                        commit((s) => ({
                          ...s,
                          [slot]: s[slot] ? { ...s[slot]!, label: name } : null,
                        }))
                      }
                      onInspect={(slot, skill) => {
                        const c = study[slot];
                        if (!c) return;
                        commit((s) => ({
                          ...s,
                          mode: c.mode,
                          filter: {
                            ...c.filter,
                            skillIds: [
                              ...new Set([...(c.filter.skillIds || []), skill]),
                            ],
                          },
                          workspace: "canvas",
                        }));
                        setSearch(c.filter.search || "");
                        setOffset(0);
                        setNotice(
                          `Inspecting ${label(skill)} contributors from frozen cohort ${slot.toUpperCase()}.`,
                        );
                      }}
                    />
                    <PayPanel overview={overview.data?.data} />
                    <div className="context-note">
                      <Info size={15} />
                      <p>
                        Advertisements describe demand signals.
                        <br />
                        They do not establish hires, earnings, or available
                        talent.
                      </p>
                    </div>
                  </aside>
                </div>
              )}
              {!blocked && (
                <section
                  className="panel records-panel"
                  aria-label="Contributing records"
                >
                  <div className="panel-head">
                    <div>
                      <p className="eyebrow">FROM PATTERN TO POSTING</p>
                      <h2>
                        The records behind this view{" "}
                        <span className="count-pill">
                          {n(records.data?.data.total || 0)}
                        </span>
                      </h2>
                    </div>
                    <button
                      className="button secondary small"
                      onClick={exportRows}
                      disabled={!overview.data || overview.loading || exporting}
                    >
                      <ArrowDownToLine size={14} />
                      Export full selection
                    </button>
                  </div>
                  <p className="panel-description">
                    Inspect public details and source links. The table is paged;
                    your analysis and export include the full matching
                    population.
                  </p>
                  <div
                    className="record-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label="Scrollable posting table"
                    aria-busy={records.loading}
                  >
                    <table className="records-table">
                      <thead>
                        <tr>
                          <th>Role & employer</th>
                          <th>Work arrangement</th>
                          <th>Source statement</th>
                          <th>
                            <span className="sr-only">Details</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.data?.data.rows.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <button
                                className="record-title"
                                onClick={() => setSelected(r.id)}
                              >
                                {r.title}
                              </button>
                              <span>
                                {label(r.companyId)}
                                <i>·</i>
                                {label(r.occupationId || "__unknown__")}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`arrangement ${r.arrangement === "Remote" ? "remote" : ""}`}
                              >
                                {r.arrangement || "Unknown"}
                              </span>
                              <small>
                                {r.locations
                                  .map((l) => l.city || l.region || l.country)
                                  .filter(Boolean)
                                  .join(" · ") || "Location unknown"}
                              </small>
                            </td>
                            <td>
                              <span className="source-statement">
                                <span className="tiny-dot" />
                                {r.availability === "local_observed"
                                  ? "Locally observed open"
                                  : r.availability === "upstream_reported_open"
                                    ? "Upstream reported open"
                                    : r.availability.replaceAll("_", " ")}
                              </span>
                              <small>
                                {r.availabilityAsOf?.slice(0, 10) ||
                                  "As-of unknown"}
                              </small>
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={`Inspect ${r.title}`}
                                onClick={() => setSelected(r.id)}
                              >
                                <ArrowUpRight size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {records.loading && !records.data && (
                      <div className="panel-loading">
                        <LoaderCircle size={22} className="spin" />
                        Retrieving the first public record page…
                      </div>
                    )}
                    {records.data?.data.total === 0 && (
                      <div className="empty">
                        <Search size={25} />
                        <h3>No postings match these filters.</h3>
                        <p>
                          Remove a refinement to widen the view. Unknown values
                          are not treated as known categories.
                        </p>
                        <button className="button secondary" onClick={reset}>
                          Clear refinements
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="records-footer">
                    <span>
                      {records.data?.data.total ? n(offset + 1) : "0"}–
                      {n(Math.min(offset + 100, records.data?.data.total || 0))}{" "}
                      of {n(records.data?.data.total || 0)}{" "}
                      <span>· 100 per page</span>
                    </span>
                    <div>
                      <button
                        className="icon-button"
                        disabled={!offset || records.loading}
                        aria-label="Previous records"
                        onClick={() => setOffset(Math.max(0, offset - 100))}
                      >
                        <ChevronLeft size={17} />
                      </button>
                      <span>Page {Math.floor(offset / 100) + 1}</span>
                      <button
                        className="icon-button"
                        disabled={
                          !records.data?.data.hasMore || records.loading
                        }
                        aria-label="Next records"
                        onClick={() => setOffset(offset + 100)}
                      >
                        <ChevronRight size={17} />
                      </button>
                    </div>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
        <footer className="studio-footer">
          <span>
            JobMarket Lens <strong>Research Canvas / 2.5</strong>
            <span className="footer-separator">/</span>See the demand. Check the
            evidence.
          </span>
          <div>
            <a
              href="https://jobmarket.feedos.si"
              target="_blank"
              rel="noreferrer"
            >
              Compare with V2 <ArrowUpRight size={12} />
            </a>
            <a href="/admin">
              Owner access <ArrowUpRight size={12} />
            </a>
          </div>
        </footer>
      </main>
      {study && catalog && !blocked && (
        <div
          className="mobile-study-bar mobile"
          aria-label="Persistent study scope"
        >
          <div>
            <strong>
              {selectedCount === undefined ? "—" : n(selectedCount)}
            </strong>
            <span>
              postings<small>{modeLabel[mode]}</small>
            </span>
          </div>
          <button
            className="button secondary"
            onClick={() => setFiltersOpen(true)}
          >
            <SlidersHorizontal size={14} />
            Refine view
          </button>
          {study.a && study.b && (
            <button
              className="icon-button"
              aria-label="Inspect frozen cohort comparison"
              onClick={() => {
                document
                  .getElementById("cohort-comparison")
                  ?.scrollIntoView({ block: "center" });
                document.getElementById("cohort-comparison")?.focus();
              }}
            >
              <Layers3 size={18} />
            </button>
          )}
        </div>
      )}
      <input
        ref={file}
        className="sr-only"
        type="file"
        accept=".json,application/json"
        aria-label="Restore study file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void restore(f);
          e.target.value = "";
        }}
      />
      {selected && catalog && (
        <Detail
          id={selected}
          mode={mode}
          catalog={catalog}
          label={label}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
function DimensionSelect({
  title,
  field,
  options,
  selected,
  onAdd,
}: {
  title: string;
  field: Dimension;
  options: { id: string; name: string }[];
  selected: string[];
  onAdd: (f: Dimension, v: string) => void;
}) {
  return (
    <label className="select-field">
      {title}
      <span className="select-wrap">
        <select
          aria-label={`Add ${title.toLowerCase()} filter`}
          value=""
          onChange={(e) => {
            if (e.target.value) onAdd(field, e.target.value);
          }}
        >
          <option value="">
            {selected.length
              ? `${selected.length} selected · add another`
              : `All ${title.toLowerCase()}s`}
          </option>
          {options
            .filter((x) => !selected.includes(x.id))
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
      </span>
    </label>
  );
}
