import { useId, useMemo, useState } from "react";
import type { Employer, IssueGroup } from "./types";
import "./coverage.css";

export type CoverageIssueGroup = IssueGroup;
export interface CoverageEmployer extends Employer {
  rawRangeCount: number;
  payAssessableCount: number;
  knownCurrencyCount: number;
  validNonUsdCount: number;
  invalidBoundCount: number;
  suspiciousPayCount: number;
  analyzedTextCount: number;
  issueGroups?: CoverageIssueGroup[];
}
export interface CoverageAnalysisProps {
  companies: CoverageEmployer[];
  emptyCompanies: { id: string; label: string }[];
  selected: string[];
  inspectedId?: string;
  interaction: "inspect" | "select";
  onPick: (id: string) => void;
  onInspect?: (id: string) => void;
  onToggle?: (id: string) => void;
}
type Signal = "none" | "unknown_country" | "invalid_bounds" | "suspicious_pay";
type Metric = "country" | "usd" | "volume";
const number = (value: number) => new Intl.NumberFormat("en").format(value);
const percent = (numerator: number, denominator: number) =>
  denominator > 0
    ? `${((100 * numerator) / denominator).toFixed(1)}%`
    : "Unavailable";
const metricNames: Record<Metric, string> = {
  country: "Known-country share",
  usd: "Eligible USD-pay share",
  volume: "Posting count · log1p scale",
};
function signalCount(company: CoverageEmployer, signal: Signal) {
  if (signal === "unknown_country")
    return Math.max(0, company.count - company.knownCountryCount);
  if (signal === "invalid_bounds") return company.invalidBoundCount;
  if (signal === "suspicious_pay") return company.suspiciousPayCount;
  return 0;
}
function metricValue(company: CoverageEmployer, metric: Metric) {
  if (metric === "volume") return company.count;
  if (!company.count) return null;
  return metric === "country"
    ? company.knownCountryCount / company.count
    : company.eligiblePayCount / company.count;
}
function support(numerator: number, denominator: number) {
  return `${number(numerator)} / ${number(denominator)} · ${percent(numerator, denominator)}`;
}
const signalLabels: Record<Signal, string> = {
  none: "No diagnostic color",
  unknown_country: "Unknown country present",
  invalid_bounds: "Invalid numeric / inverted pay bounds recorded",
  suspicious_pay: "Suspicious pay flags · needs review",
};

/** Equal-data projections. Hover is local; only explicit actions reach the parent. */
export default function CoverageAnalysis({
  companies,
  emptyCompanies,
  selected,
  inspectedId,
  interaction,
  onPick,
  onInspect,
  onToggle,
}: CoverageAnalysisProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [signal, setSignal] = useState<Signal>("none");
  const [sort, setSort] = useState("count");
  const [search, setSearch] = useState("");
  const noteId = useId();
  const matched = useMemo(
    () => companies.filter((company) => company.count > 0),
    [companies],
  );
  const empty = useMemo(() => {
    const unique = new Map(
      emptyCompanies.map((company) => [company.id, company]),
    );
    companies
      .filter((company) => !company.count)
      .forEach((company) =>
        unique.set(company.companyId, {
          id: company.companyId,
          label: company.label,
        }),
      );
    return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [companies, emptyCompanies]);
  const active = matched.find(
    (company) => company.id === (hoveredId || focusedId || inspectedId),
  );
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const total = matched.reduce((sum, company) => sum + company.count, 0);
  const maximumCount = Math.max(1, ...matched.map((company) => company.count));
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...companies]
      .filter(
        (company) =>
          !query ||
          `${company.label} ${company.companyId}`
            .toLocaleLowerCase()
            .includes(query),
      )
      .sort((a, b) => {
        const value = (company: CoverageEmployer) =>
          sort === "invalid"
            ? company.invalidBoundCount
            : sort === "suspicious"
              ? company.suspiciousPayCount
              : sort === "unknown"
                ? company.count - company.knownCountryCount
                : company.count;
        return sort === "name"
          ? a.label.localeCompare(b.label)
          : value(b) - value(a) || a.label.localeCompare(b.label);
      });
  }, [companies, search, sort]);
  const issues = {
    invalid: matched.reduce(
      (sum, company) => sum + company.invalidBoundCount,
      0,
    ),
    assessable: matched.reduce(
      (sum, company) => sum + company.payAssessableCount,
      0,
    ),
    suspicious: matched.reduce(
      (sum, company) => sum + company.suspiciousPayCount,
      0,
    ),
    nonUsd: matched.reduce((sum, company) => sum + company.validNonUsdCount, 0),
  };
  return (
    <div className="coverage-analysis">
      <div className="coverage-overview">
        <div>
          <p className="coverage-kicker">THREE PROJECTIONS / ONE POPULATION</p>
          <h3>Volume and coverage, without hidden dimensions.</h3>
          <p>
            {number(matched.length)} employers · {number(total)} distinct
            matched postings. Every projection uses the same employers and
            posting counts.
          </p>
        </div>
        <label>
          Diagnostic emphasis
          <select
            value={signal}
            onChange={(event) => setSignal(event.target.value as Signal)}
          >
            {(Object.keys(signalLabels) as Signal[]).map((value) => (
              <option key={value} value={value}>
                {signalLabels[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="coverage-reading" id={noteId}>
        Both coverage shares use employer matched postings as the denominator.
        Log1p changes the count axis spacing; ticks and inspection show raw
        counts. Circle area encodes posting count with one common scale.{" "}
        {interaction === "select"
          ? "Tap a mark to toggle its draft membership."
          : "Tap a mark to inspect its contributors."}{" "}
        Hover previews locally and never changes a cohort.
      </p>
      <div className="coverage-projections">
        {(
          [
            ["country", "usd"],
            ["country", "volume"],
            ["usd", "volume"],
          ] as [Metric, Metric][]
        ).map(([x, y], index) => (
          <Projection
            key={`${x}-${y}`}
            companies={matched}
            xMetric={x}
            yMetric={y}
            index={index + 1}
            maximumCount={maximumCount}
            selected={selectedIds}
            activeId={active?.id}
            signal={signal}
            onHover={setHoveredId}
            onPick={onPick}
          />
        ))}
      </div>
      <div className="coverage-legend" aria-label="Projection key">
        <span>
          <i className="coverage-symbol" />
          Employer aggregate
        </span>
        <span>
          <i className="coverage-symbol is-selected" />
          Outlined = draft selection
        </span>
        <span>
          <i className="coverage-symbol is-active" />
          Dark outline = linked inspection
        </span>
        {signal !== "none" && (
          <span>
            <i className="coverage-symbol is-flagged" />
            Amber / dashed = {signalLabels[signal].toLowerCase()}
          </span>
        )}
      </div>
      <div
        className="coverage-linked-preview"
        aria-live="polite"
        aria-atomic="true"
      >
        {active ? (
          <>
            <strong>{active.label}</strong>
            <span>{number(active.count)} postings</span>
            <span>
              Known country {support(active.knownCountryCount, active.count)}
            </span>
            <span>
              USD eligible {support(active.eligiblePayCount, active.count)}
            </span>
          </>
        ) : (
          <>
            <strong>Linked inspection</strong>
            <span>
              Hover a mark or focus an employer row to highlight the same
              employer in all three projections. Use the exact table for
              overlapping or tiny marks.
            </span>
          </>
        )}
      </div>
      <div className="coverage-issue-notes">
        <div>
          <span>SUPPORTED PAY-BOUND FLAGS</span>
          <strong>{support(issues.invalid, issues.assessable)}</strong>
          <p>
            Recorded numeric or inverted-bound flags among assessable pay
            records.
          </p>
        </div>
        <div>
          <span>SUSPICIOUS PAY / NEEDS REVIEW</span>
          <strong>
            {number(issues.suspicious)} / {number(total)}
          </strong>
          <p>
            Flags indicate a review candidate, not a proven error or employer
            quality.
          </p>
        </div>
        <div>
          <span>VALID NON-USD PAY</span>
          <strong>
            {number(issues.nonUsd)} / {number(total)}
          </strong>
          <p>
            Outside USD comparison coverage. A valid non-USD range is not
            invalid pay.
          </p>
        </div>
      </div>
      <section
        className="coverage-evidence"
        aria-labelledby={`${noteId}-table`}
      >
        <div className="coverage-evidence-heading">
          <div>
            <p className="coverage-kicker">
              EXACT EMPLOYER EVIDENCE / SAME QUERY
            </p>
            <h3 id={`${noteId}-table`}>Inspect the underlying counts.</h3>
          </div>
          <div className="coverage-table-controls">
            <label>
              Find an employer
              <input
                type="search"
                value={search}
                maxLength={160}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name or employer ID"
              />
            </label>
            <label>
              Sort employer evidence
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="count">Posting count</option>
                <option value="name">Employer name</option>
                <option value="unknown">Unknown-country count</option>
                <option value="invalid">Invalid-bound count</option>
                <option value="suspicious">Suspicious-pay count</option>
              </select>
            </label>
          </div>
        </div>
        <p className="coverage-table-note">
          Employer names inspect without applying a cohort. Checkboxes only
          change the draft; Apply commits it. Table search and sorting affect
          this list only, never the population or projections.{" "}
          {number(filtered.length)} of {number(companies.length)} matched
          employer groups listed.
        </p>
        <div
          className="coverage-table-scroll"
          role="region"
          aria-label="Employer evidence counts, horizontally scrollable"
          tabIndex={0}
        >
          <table aria-describedby={noteId}>
            <caption>
              Every field is a separate recorded count. Parentheses show its
              denominator and share. Categories can overlap and must not be
              added together as distinct postings.
            </caption>
            <thead>
              <tr>
                <th scope="col">Draft</th>
                <th scope="col">Employer / inspect</th>
                <th scope="col">Postings</th>
                <th scope="col">Known country</th>
                <th scope="col">Eligible USD pay</th>
                <th scope="col">Raw low + high present</th>
                <th scope="col">Known currency</th>
                <th scope="col">Valid non-USD pay</th>
                <th scope="col">Pay assessable</th>
                <th scope="col">Invalid bounds / assessable</th>
                <th scope="col">Suspicious flags / postings</th>
                <th scope="col">Unknown arrangement</th>
                <th scope="col">Reporting basis differences</th>
                <th scope="col">Normalized state disagreements</th>
                <th scope="col">Recorded date differences</th>
                <th scope="col">Recorded location differences</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((company) => (
                <tr
                  key={company.id}
                  className={`${selectedIds.has(company.id) ? "is-selected" : ""} ${active?.id === company.id ? "is-active" : ""}`}
                  onMouseEnter={() => setHoveredId(company.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onFocus={() => setFocusedId(company.id)}
                  onBlur={(event) => {
                    if (
                      !event.currentTarget.contains(event.relatedTarget as Node)
                    )
                      setFocusedId(null);
                  }}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Draft employer ${company.label}`}
                      checked={selectedIds.has(company.id)}
                      disabled={!company.count || !onToggle}
                      onChange={() => onToggle?.(company.id)}
                    />
                  </td>
                  <th scope="row">
                    <button
                      type="button"
                      onClick={() => (onInspect || onPick)(company.id)}
                      disabled={!company.count}
                    >
                      {company.label}
                    </button>
                    <small>{company.companyId}</small>
                  </th>
                  <td>{number(company.count)}</td>
                  <MetricCell
                    value={company.knownCountryCount}
                    denominator={company.count}
                  />
                  <MetricCell
                    value={company.eligiblePayCount}
                    denominator={company.count}
                  />
                  <MetricCell
                    value={company.rawRangeCount}
                    denominator={company.count}
                  />
                  <MetricCell
                    value={company.knownCurrencyCount}
                    denominator={company.count}
                  />
                  <MetricCell
                    value={company.validNonUsdCount}
                    denominator={company.count}
                  />
                  <MetricCell
                    value={company.payAssessableCount}
                    denominator={company.count}
                  />
                  <MetricCell
                    value={company.invalidBoundCount}
                    denominator={company.payAssessableCount}
                    caution={company.invalidBoundCount > 0}
                  />
                  <MetricCell
                    value={company.suspiciousPayCount}
                    denominator={company.count}
                    caution={company.suspiciousPayCount > 0}
                  />
                  <MetricCell
                    value={company.unknownArrangementCount}
                    denominator={company.count}
                  />
                  <IssueCell
                    group={company.issueGroups?.find(
                      (group) => group.issue === "basis_difference",
                    )}
                  />
                  <IssueCell
                    group={company.issueGroups?.find(
                      (group) => group.issue === "state_disagreement",
                    )}
                  />
                  <IssueCell
                    group={company.issueGroups?.find(
                      (group) => group.issue === "date_difference",
                    )}
                  />
                  <IssueCell
                    group={company.issueGroups?.find(
                      (group) => group.issue === "location_difference",
                    )}
                  />
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <p className="coverage-no-rows">
              No employer names match this table search. The query population
              remains unchanged.
            </p>
          )}
        </div>
        <details className="coverage-definitions">
          <summary>How to read the pay and paired-source evidence</summary>
          <dl>
            <div>
              <dt>Raw range</dt>
              <dd>
                Both reported low and high endpoints are present. Presence does
                not establish validity or USD eligibility.
              </dd>
            </div>
            <div>
              <dt>Known currency</dt>
              <dd>
                A currency is recorded; other pay fields may still be missing.
              </dd>
            </div>
            <div>
              <dt>Pay assessable</dt>
              <dd>
                Both endpoints are recorded, or an explicit
                numeric/inverted-bound flag exists. This is the invalid-bound
                diagnostic denominator.
              </dd>
            </div>
            <div>
              <dt>Invalid bounds</dt>
              <dd>
                Recorded inverted_range, inverted_annual_range, or
                invalid_numeric_pay flags. Zero assessable records means an
                unavailable rate, not a zero error rate.
              </dd>
            </div>
            <div>
              <dt>Suspicious pay</dt>
              <dd>
                Recorded suspicious_annual_max or suspicious_range flags,
                divided by all matched employer postings. These records require
                review; they are not established errors.
              </dd>
            </div>
            <div>
              <dt>Paired-source differences</dt>
              <dd>
                Each diagnostic has its own reported denominator and unavailable
                count. Reporting-basis differences are not contradictory
                normalized states. Recorded dates and locations may differ
                because of timing or precision, without demonstrating an error.
              </dd>
            </div>
          </dl>
        </details>
      </section>
      <details className="coverage-empty-employers">
        <summary>
          Catalog employers without contributors in this query (
          {number(empty.length)})
        </summary>
        <p>
          No matched postings means no coverage denominator. These employers are
          not plotted at zero or assigned invented coordinates, and cannot be
          selected as a contributing group.
        </p>
        {empty.length ? (
          <ul>
            {empty.map((company) => (
              <li key={company.id}>
                <strong>{company.label}</strong>
                <span>
                  {company.id} · 0 matched postings · coverage unavailable
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            Every catalog employer has at least one contributor in this query.
          </p>
        )}
      </details>
    </div>
  );
}
function MetricCell({
  value,
  denominator,
  caution = false,
}: {
  value: number;
  denominator: number;
  caution?: boolean;
}) {
  return (
    <td className={caution ? "coverage-cell-caution" : undefined}>
      <strong>{number(value)}</strong>
      <small>
        /{number(denominator)} · {percent(value, denominator)}
      </small>
    </td>
  );
}
function Projection({
  companies,
  xMetric,
  yMetric,
  index,
  maximumCount,
  selected,
  activeId,
  signal,
  onHover,
  onPick,
}: {
  companies: CoverageEmployer[];
  xMetric: Metric;
  yMetric: Metric;
  index: number;
  maximumCount: number;
  selected: Set<string>;
  activeId?: string;
  signal: Signal;
  onHover: (id: string | null) => void;
  onPick: (id: string) => void;
}) {
  const titleId = useId(),
    descriptionId = useId();
  const left = 48,
    top = 25,
    width = 265,
    height = 205;
  const fraction = (value: number, metric: Metric) =>
    metric === "volume" ? Math.log1p(value) / Math.log1p(maximumCount) : value;
  const ticks = (metric: Metric) =>
    metric !== "volume"
      ? [0, 0.25, 0.5, 0.75, 1]
      : [
          ...new Set([
            0,
            ...[1, 10, 100, 1000, 10000, 100000].filter(
              (value) => value < maximumCount,
            ),
            maximumCount,
          ]),
        ];
  const tickLabel = (value: number, metric: Metric) =>
    metric === "volume" ? number(value) : `${Math.round(value * 100)}%`;
  // Active/drafted marks render last so their outlines remain visible in dense corners.
  const ordered = [...companies].sort(
    (a, b) =>
      Number(selected.has(a.id) || a.id === activeId) -
      Number(selected.has(b.id) || b.id === activeId),
  );
  return (
    <section className="coverage-projection">
      <div className="coverage-projection-heading">
        <span>0{index}</span>
        <h4>
          {metricNames[xMetric]} ×{" "}
          {yMetric === "volume" ? "volume" : "USD eligibility"}
        </h4>
      </div>
      <svg
        viewBox="0 0 340 285"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        onMouseLeave={() => onHover(null)}
      >
        <title id={titleId}>
          {metricNames[xMetric]} versus {metricNames[yMetric]}
        </title>
        <desc id={descriptionId}>
          Each circle is one employer. Area encodes posting count. All three
          projections share the same population. Use the exact employer evidence
          table for keyboard inspection and selection, including overlapping
          marks.
        </desc>
        {ticks(xMetric).map((value) => {
          const x = left + fraction(value, xMetric) * width;
          return (
            <g key={`x${value}`}>
              <path d={`M${x} ${top}V${top + height}`} stroke="#e0e8dd" />
              <text x={x} y={top + height + 18} textAnchor="middle">
                {tickLabel(value, xMetric)}
              </text>
            </g>
          );
        })}
        {ticks(yMetric).map((value) => {
          const y = top + height - fraction(value, yMetric) * height;
          return (
            <g key={`y${value}`}>
              <path d={`M${left} ${y}H${left + width}`} stroke="#e0e8dd" />
              <text x={left - 7} y={y + 4} textAnchor="end">
                {tickLabel(value, yMetric)}
              </text>
            </g>
          );
        })}
        <text x={left + width / 2} y="274" textAnchor="middle">
          {xMetric === "country"
            ? "Known-country share"
            : "Eligible USD-pay share"}
        </text>
        <text
          transform={`translate(12 ${top + height / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {yMetric === "volume"
            ? "Posting count (log1p)"
            : "Eligible USD-pay share"}
        </text>
        {ordered.map((company) => {
          const x = metricValue(company, xMetric),
            y = metricValue(company, yMetric);
          if (x === null || y === null) return null;
          const flagged = signalCount(company, signal) > 0,
            active = company.id === activeId,
            chosen = selected.has(company.id);
          return (
            <circle
              key={company.id}
              data-employer-id={company.id}
              cx={left + fraction(x, xMetric) * width}
              cy={top + height - fraction(y, yMetric) * height}
              r={13 * Math.sqrt(company.count / maximumCount)}
              fill={flagged ? "#a66e24" : "#28776d"}
              fillOpacity={active ? 1 : 0.68}
              stroke={
                active
                  ? "#173e43"
                  : chosen
                    ? "#8b4f0c"
                    : flagged
                      ? "#734812"
                      : "#f7f9f4"
              }
              strokeWidth={active || chosen ? 2.4 : 0.7}
              strokeDasharray={
                flagged && !active && !chosen ? "2 1" : undefined
              }
              onMouseEnter={() => onHover(company.id)}
              onClick={() => onPick(company.id)}
            >
              <title>
                {company.label}: {number(company.count)} postings; known country{" "}
                {support(company.knownCountryCount, company.count)}; eligible
                USD pay {support(company.eligiblePayCount, company.count)}
                {flagged
                  ? `; ${signalLabels[signal]}: ${number(signalCount(company, signal))}`
                  : ""}
              </title>
            </circle>
          );
        })}
      </svg>
    </section>
  );
}

function IssueCell({ group }: { group?: CoverageIssueGroup }) {
  if (!group)
    return (
      <td>
        <span className="coverage-unavailable">Unavailable</span>
        <small>No pair diagnostic supplied</small>
      </td>
    );
  return (
    <td title={group.meaning}>
      <strong>{number(group.numerator)}</strong>
      <small>
        /{number(group.denominator)} ·{" "}
        {percent(group.numerator, group.denominator)}
      </small>
      <small className="coverage-pair-denominator">
        {group.denominatorLabel}
      </small>
      {group.unavailableCount > 0 && (
        <small>{number(group.unavailableCount)} unavailable / excluded</small>
      )}
    </td>
  );
}
