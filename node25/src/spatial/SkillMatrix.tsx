import { useMemo, useState } from "react";
import type { Edge, SkillNode } from "./types";
import "./skill-matrix.css";

export interface SkillMatrixPair extends Edge {
  aCount: number;
  bCount: number;
  qualifies: boolean;
  shownEdge: boolean;
}

export interface SkillMatrixData {
  methodVersion: string;
  nodeIds: string[];
  pairs: SkillMatrixPair[];
  possiblePairs: number;
  qualifyingPairs: number;
  shownEdges: number;
}

export interface SkillMatrixProps {
  nodes: SkillNode[];
  matrix?: SkillMatrixData;
  analysisCount: number;
  onInspectNode: (id: string) => void;
  onInspectPair: (pair: Edge) => void;
  onDraftPair: (pair: Edge) => void;
}

type SortMode = "support" | "jaccard" | "label";
const formatter = new Intl.NumberFormat("en");
const pairKey = (a: string, b: string) => [a, b].sort().join("\u0000");
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

/** Exact marginal/pair matrix and sortable listing; layout selection stays external. */
export default function SkillMatrix({
  nodes,
  matrix,
  analysisCount,
  onInspectNode,
  onInspectPair,
  onDraftPair,
}: SkillMatrixProps) {
  const [sort, setSort] = useState<SortMode>("support");
  const [pairPage, setPairPage] = useState(0);
  const [focusedPair, setFocusedPair] = useState<SkillMatrixPair | null>(null);
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const matrixNodes = matrix
    ? matrix.nodeIds
        .map((id) => nodeById.get(id))
        .filter((node): node is SkillNode => !!node)
    : nodes;
  const missingNodeIds =
    matrix?.nodeIds.filter((id) => !nodeById.has(id)) || [];
  const pairByKey = useMemo(
    () =>
      new Map(
        (matrix?.pairs || []).map((pair) => [pairKey(pair.a, pair.b), pair]),
      ),
    [matrix],
  );
  const rankedPairs = useMemo(() => {
    const pairs = [...(matrix?.pairs || [])];
    return pairs.sort((left, right) => {
      if (sort === "support" && left.count !== right.count)
        return right.count - left.count;
      if (sort === "jaccard" && left.jaccard !== right.jaccard)
        return right.jaccard - left.jaccard;
      const leftA = nodeById.get(left.a)?.label || left.a;
      const rightA = nodeById.get(right.a)?.label || right.a;
      const leftB = nodeById.get(left.b)?.label || left.b;
      const rightB = nodeById.get(right.b)?.label || right.b;
      return (
        leftA.localeCompare(rightA) ||
        leftB.localeCompare(rightB) ||
        left.a.localeCompare(right.a) ||
        left.b.localeCompare(right.b)
      );
    });
  }, [matrix, nodeById, sort]);

  function inspect(pair: SkillMatrixPair) {
    setFocusedPair(pair);
    onInspectPair(pair);
  }

  return (
    <section
      className="spatial-skill-matrix"
      aria-label="Exact skill co-mentions"
    >
      <header className="spatial-skill-matrix-header">
        <div>
          <h3>Exact co-mention matrix</h3>
          <p>
            Distinct postings in the current observation population:{" "}
            {formatter.format(analysisCount)}. Diagonal values are skill
            marginals; off-diagonal values are postings recording both.
          </p>
        </div>
        {matrix && <small>Method {matrix.methodVersion}</small>}
      </header>

      {analysisCount <= 0 ? (
        <p className="spatial-skill-matrix-empty" role="status">
          No analyzed observation population is available. Skills and pair
          counts are unavailable; unknown coverage is not displayed as zero.
        </p>
      ) : !matrix ? (
        <p className="spatial-skill-matrix-empty" role="status">
          Exact pair matrix unavailable. Missing matrix data is not treated as
          zero co-mentions.
        </p>
      ) : (
        <>
          <p className="spatial-skill-matrix-coverage">
            {formatter.format(matrix.pairs.length)} of{" "}
            {formatter.format(matrix.possiblePairs)} unordered pairs have exact
            counts; {formatter.format(matrix.qualifyingPairs)} qualify and{" "}
            {formatter.format(matrix.shownEdges)} are drawn in the neighborhood.
            A listed pair omitted from the graph is not an absent relationship.
          </p>
          {missingNodeIds.length > 0 && (
            <p className="spatial-skill-matrix-empty" role="status">
              {formatter.format(missingNodeIds.length)} matrix node labels are
              unavailable. Those rows and columns are not inferred.
            </p>
          )}
          <div className="spatial-skill-matrix-scroll" tabIndex={0}>
            <table className="spatial-skill-matrix-grid">
              <caption>
                Each unordered pair appears once in the supplied exact pair
                data. Missing pair data is marked Unavailable.
              </caption>
              <thead>
                <tr>
                  <th className="spatial-skill-matrix-corner" scope="col">
                    Skill
                  </th>
                  {matrixNodes.map((node) => (
                    <th scope="col" key={node.id}>
                      <button
                        type="button"
                        onClick={() => onInspectNode(node.id)}
                      >
                        {node.label}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixNodes.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">
                      <button
                        type="button"
                        onClick={() => onInspectNode(row.id)}
                      >
                        {row.label}
                      </button>
                    </th>
                    {matrixNodes.map((column) => {
                      if (row.id === column.id)
                        return (
                          <td key={column.id} className="is-diagonal">
                            <span>{formatter.format(row.count)}</span>
                            <small>marginal</small>
                          </td>
                        );
                      const pair = pairByKey.get(pairKey(row.id, column.id));
                      if (!pair)
                        return (
                          <td key={column.id} className="is-unavailable">
                            Unavailable
                          </td>
                        );
                      const selected =
                        !!focusedPair &&
                        pairKey(focusedPair.a, focusedPair.b) ===
                          pairKey(pair.a, pair.b);
                      return (
                        <td key={column.id}>
                          <button
                            type="button"
                            className={
                              selected ? "is-pair-selected" : undefined
                            }
                            aria-label={`${row.label} and ${column.label}: ${formatter.format(pair.count)} co-mentions${pair.qualifies ? ", meets threshold" : ", below threshold"}`}
                            aria-pressed={selected}
                            onClick={() => inspect(pair)}
                          >
                            {formatter.format(pair.count)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {focusedPair && (
            <div className="spatial-skill-pair-detail" aria-live="polite">
              <div>
                <strong>
                  {nodeById.get(focusedPair.a)?.label || focusedPair.a} +{" "}
                  {nodeById.get(focusedPair.b)?.label || focusedPair.b}
                </strong>
                <span>
                  {formatter.format(focusedPair.count)} postings record both
                </span>
                <span>
                  Marginals: {formatter.format(focusedPair.aCount)} and{" "}
                  {formatter.format(focusedPair.bCount)}
                </span>
                <span>
                  Jaccard {pct(focusedPair.jaccard)} · P(B | A){" "}
                  {pct(focusedPair.aShare)} · P(A | B) {pct(focusedPair.bShare)}
                </span>
                <span>
                  {focusedPair.qualifies
                    ? "Meets pair threshold"
                    : "Below pair threshold"}
                  ;{" "}
                  {focusedPair.shownEdge
                    ? "shown in graph"
                    : "not shown in graph"}
                </span>
              </div>
              <button
                type="button"
                className="button"
                onClick={() => onDraftPair(focusedPair)}
              >
                Draft both skills
              </button>
            </div>
          )}

          <div className="spatial-skill-pair-list-heading">
            <div>
              <h3>Ranked exact pairs</h3>
              <p>
                Sorting changes display order only; it does not change the
                population or selection.
              </p>
            </div>
            <label>
              Rank by
              <select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as SortMode);
                  setPairPage(0);
                }}
              >
                <option value="support">Support, highest first</option>
                <option value="jaccard">Jaccard, highest first</option>
                <option value="label">Skill names</option>
              </select>
            </label>
          </div>
          <nav aria-label="Exact pair pages">
            <button
              className="button"
              disabled={pairPage === 0}
              onClick={() => setPairPage((p) => p - 1)}
            >
              Previous pairs
            </button>
            <span>
              {" "}
              Pairs {Math.min(pairPage * 50 + 1, rankedPairs.length)}–
              {Math.min((pairPage + 1) * 50, rankedPairs.length)} of{" "}
              {rankedPairs.length}{" "}
            </span>
            <button
              className="button"
              disabled={(pairPage + 1) * 50 >= rankedPairs.length}
              onClick={() => setPairPage((p) => p + 1)}
            >
              Next pairs
            </button>
          </nav>
          <div className="spatial-skill-pairs-scroll">
            <table className="spatial-skill-pairs">
              <caption>
                All exact pair counts supplied for this matrix, including pairs
                below the graph threshold.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Recorded pair</th>
                  <th scope="col">Both</th>
                  <th scope="col">Jaccard</th>
                  <th scope="col">P(B | A)</th>
                  <th scope="col">P(A | B)</th>
                  <th scope="col">Graph status</th>
                  <th scope="col">Inspect</th>
                </tr>
              </thead>
              <tbody>
                {rankedPairs
                  .slice(pairPage * 50, (pairPage + 1) * 50)
                  .map((pair) => (
                    <tr key={pair.id}>
                      <td>
                        {nodeById.get(pair.a)?.label || pair.a} +{" "}
                        {nodeById.get(pair.b)?.label || pair.b}
                      </td>
                      <td>{formatter.format(pair.count)}</td>
                      <td>{pct(pair.jaccard)}</td>
                      <td>{pct(pair.aShare)}</td>
                      <td>{pct(pair.bShare)}</td>
                      <td>
                        {pair.shownEdge
                          ? "Shown"
                          : pair.qualifies
                            ? "Qualifies, omitted"
                            : "Below threshold"}
                      </td>
                      <td>
                        <button type="button" onClick={() => inspect(pair)}>
                          Inspect pair
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
