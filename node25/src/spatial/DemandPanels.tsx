import type { Cell, Scene } from "./types";
import "./demand-panels.css";

const arrangements = ["Remote", "Hybrid", "On-site", "Unknown"];
const number = (value: number) => new Intl.NumberFormat("en").format(value);

export interface DemandPanelsProps {
  cells: Cell[];
  axes: Scene["data"]["axes"];
  draft: string[];
  onPick: (ids: string[]) => void;
}

/** Four exact arrangement matrices with one comparable circle-area scale. */
export default function DemandPanels({
  cells,
  axes,
  draft,
  onPick,
}: DemandPanelsProps) {
  if (!axes) return null;

  const byTuple = new Map<string, Cell[]>();
  for (const cell of cells) {
    const key = `${cell.arrangement}\u0000${cell.occupationId}\u0000${cell.level}`;
    const group = byTuple.get(key) || [];
    group.push(cell);
    byTuple.set(key, group);
  }
  const max = Math.max(1, ...cells.map((cell) => cell.count));

  return (
    <div className="spatial-demand-panels" aria-label="Demand by arrangement">
      {arrangements.map((arrangement) => (
        <details className="spatial-demand-panel" key={arrangement} open>
          <summary>{arrangement}</summary>
          <div className="spatial-demand-panel-scroll" tabIndex={0}>
            <table>
              <caption>
                {arrangement}: occupation by reported level. Circle area uses
                the same posting-count scale in all four panels.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Occupation / level</th>
                  {axes.levels.map((level) => (
                    <th scope="col" key={level}>
                      {level}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {axes.occupations.map((occupation) => (
                  <tr key={occupation.id}>
                    <th scope="row">{occupation.label}</th>
                    {axes.levels.map((level) => {
                      const group =
                          byTuple.get(
                            `${arrangement}\u0000${occupation.id}\u0000${level}`,
                          ) || [],
                        total = group.reduce(
                          (sum, cell) => sum + cell.count,
                          0,
                        ),
                        ids = group.map((cell) => cell.id),
                        active =
                          ids.length > 0 &&
                          ids.every((id) => draft.includes(id));
                      return (
                        <td key={level}>
                          {total > 0 ? (
                            <button
                              type="button"
                              className={active ? "is-selected" : undefined}
                              aria-label={`${arrangement}, ${occupation.label}, ${level}: ${number(total)} postings`}
                              aria-pressed={active}
                              onClick={() => onPick(ids)}
                            >
                              <span
                                className="spatial-demand-panel-dot"
                                style={{
                                  width: `${34 * Math.sqrt(total / max)}px`,
                                  height: `${34 * Math.sqrt(total / max)}px`,
                                }}
                                aria-hidden="true"
                              />
                              <span>{number(total)}</span>
                            </button>
                          ) : (
                            <span className="spatial-demand-panel-zero">0</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}
