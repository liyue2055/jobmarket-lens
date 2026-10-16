import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { parse } from "csv-parse/sync";

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const unformat = (s: string) => Number(s.replaceAll(",", ""));

async function openSpatial(page: Page) {
  await page.goto("/spatial");
  await expect(
    page.getByRole("heading", { name: /Give the question/ }),
  ).toBeVisible();
  await expect(page.locator(".spatial-release")).toContainText(
    "82,851 matching postings",
  );
}

async function sceneFor(page: Page, lens: string, availability = "open") {
  const catalog = await (await page.request.get("/api/catalog")).json();
  const request = {
    protocolVersion: "2.5.1",
    datasetVersion: catalog.datasetVersion,
    requestId: `spatial-completion-${lens}-${availability}`,
    sourceMode: "combined",
    filter: { availability },
    lens,
    basis:
      lens === "skill_neighborhood" ? "recorded_mentions" : "posting_inventory",
    ...(lens === "skill_neighborhood"
      ? {
          focusSkillId: catalog.skills[0].id,
          support: { minimumCount: 20, minimumShare: 0.002 },
        }
      : {}),
  };
  const response = await page.request.post("/api/spatial", { data: request });
  expect(response.ok()).toBeTruthy();
  return { catalog, request, scene: await response.json() };
}

async function assertAxe(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

function selectionResponse(page: Page, kind: string, limit?: number) {
  return page.waitForResponse((response) => {
    if (
      new URL(response.url()).pathname !== "/api/spatial/selection" ||
      response.request().method() !== "POST"
    )
      return false;
    const body = response.request().postDataJSON();
    return (
      body?.selection?.kind === kind &&
      (limit === undefined || body?.page?.limit === limit)
    );
  });
}

test("four demand panels keep complete exact counts, support readonly inspection, and preserve sorted IDs", async ({
  page,
}) => {
  const { scene } = await sceneFor(page, "demand_shelves");
  await openSpatial(page);
  await page.getByLabel("Demand presentation").selectOption("panels");
  const panels = page.locator(".spatial-demand-panel");
  await expect(panels).toHaveCount(4);
  const arrangements = ["Remote", "Hybrid", "On-site", "Unknown"];
  let grandTotal = 0;
  for (let i = 0; i < arrangements.length; i++) {
    const panel = panels.nth(i);
    await expect(panel.locator("summary")).toHaveText(arrangements[i]);
    const sum = await panel
      .locator("tbody button")
      .evaluateAll((buttons) =>
        buttons.reduce(
          (total, button) =>
            total + Number(button.textContent?.replaceAll(",", "") || 0),
          0,
        ),
      );
    const expected = scene.data.cells
      .filter((cell: any) => cell.arrangement === arrangements[i])
      .reduce((total: number, cell: any) => total + cell.count, 0);
    expect(sum).toBe(expected);
    grandTotal += sum;
  }
  expect(grandTotal).toBe(scene.matchedCount);

  const cell = scene.data.cells.find((candidate: any) => candidate.count > 0);
  const group = scene.data.cells.filter(
    (candidate: any) =>
      candidate.arrangement === cell.arrangement &&
      candidate.occupationId === cell.occupationId &&
      candidate.level === cell.level,
  );
  const exactCount = group.reduce(
    (total: number, item: any) => total + item.count,
    0,
  );
  const matrixButton = page.getByRole("button", {
    name: `${cell.arrangement}, ${cell.occupationLabel}, ${cell.level}: ${fmt(exactCount)} postings`,
  });
  await expect(matrixButton).toBeVisible();
  const inspect = selectionResponse(page, "cell_union", 5);
  await matrixButton.click();
  expect((await (await inspect).json()).matchedCount).toBe(exactCount);
  await expect(page.locator(".spatial-inspected strong")).toHaveText(
    fmt(exactCount),
  );
  await expect(page.locator(".spatial-applied strong")).toHaveText("—");
  await page
    .locator(".spatial-inspected")
    .getByRole("button", { name: "Use this group as draft" })
    .click();
  const apply = selectionResponse(page, "cell_union", 100);
  await page.getByRole("button", { name: "Apply selection" }).click();
  const applied = await (await apply).json();
  expect(applied.matchedCount).toBe(exactCount);
  expect(applied.contributorHash).toMatch(/^[a-f0-9]{64}$/);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await assertAxe(page);

  await page.getByRole("button", { name: "Open exact list" }).click();
  await page.getByRole("button", { name: "Clear draft" }).click();
  const row = page
    .locator(".spatial-group-list > div")
    .filter({ has: page.locator("strong", { hasText: /[1-9]/ }) })
    .first();
  const checkbox = row.locator('input[type="checkbox"]');
  const label = await checkbox.getAttribute("aria-label");
  const rowCount = unformat(await row.locator("strong").innerText());
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await expect(page.locator(".spatial-applied strong")).toHaveText(
    fmt(exactCount),
  );
  await page.getByLabel("Sort exact groups").selectOption("count");
  const sortedCheckbox = page.getByLabel(label!);
  await expect(sortedCheckbox).toBeChecked();
  await expect(
    page.locator(".spatial-group-list > div").first().locator("strong"),
  ).toHaveText(
    fmt(
      Math.max(
        ...(
          await page.locator(".spatial-group-list > div strong").allInnerTexts()
        ).map(unformat),
      ),
    ),
  );
  await page.keyboard.press("Escape");
  await expect(sortedCheckbox).not.toBeChecked();
  expect(
    await page.evaluate(() =>
      (document.activeElement as HTMLElement)?.getAttribute("aria-label"),
    ),
  ).toBe(label);
  await expect(page.locator(".spatial-applied strong")).toHaveText(
    fmt(exactCount),
  );
  expect(rowCount).toBeGreaterThan(0);
});

test("skill matrix shows exact returned pairs, and applying a hidden pair resolves its exact contributors", async ({
  page,
}) => {
  const { scene, catalog } = await sceneFor(page, "skill_neighborhood");
  expect(scene.data.matrix.pairs).toHaveLength(scene.data.matrix.possiblePairs);
  expect(scene.data.matrix.possiblePairs).toBeLessThanOrEqual(780);
  expect(scene.data.matrix.shownEdges).toBe(scene.data.edges.length);
  const pair = scene.data.matrix.pairs.find((item: any) => !item.shownEdge);
  expect(pair).toBeTruthy();
  const names = new Map(
    catalog.skills.map((skill: any) => [skill.id, skill.name]),
  );
  const aName = names.get(pair.a);
  const bName = names.get(pair.b);

  await openSpatial(page);
  await page.getByRole("tab", { name: /Skill neighborhood/ }).click();
  await expect(page.locator(".spatial-skill-matrix")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open exact co-mention matrix" })
    .click();
  const matrix = page.locator(".spatial-skill-matrix-grid");
  await expect(matrix).toBeVisible();
  await expect(matrix.locator("tbody tr")).toHaveCount(
    scene.data.matrix.nodeIds.length,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await assertAxe(page);

  const rowIndex = scene.data.matrix.nodeIds.indexOf(pair.a);
  const columnIndex = scene.data.matrix.nodeIds.indexOf(pair.b);
  const cellButton = matrix
    .locator("tbody tr")
    .nth(rowIndex)
    .locator("td")
    .nth(columnIndex)
    .getByRole("button");
  await expect(cellButton).toContainText(fmt(pair.count));
  const inspect = selectionResponse(page, "skill_pair", 5);
  await cellButton.click();
  expect((await (await inspect).json()).matchedCount).toBe(pair.count);
  await expect(page.locator(".spatial-inspected h3")).toContainText(
    `${aName} + ${bName}`,
  );
  await expect(page.locator(".spatial-inspected strong")).toHaveText(
    fmt(pair.count),
  );
  await expect(page.locator(".spatial-applied strong")).toHaveText("—");
  await expect(page.locator(".spatial-skill-pair-detail")).toContainText(
    "not shown in graph",
  );

  await page
    .locator(".spatial-skill-pair-detail")
    .getByRole("button", { name: "Draft both skills" })
    .click();
  await expect(page.locator(".spatial-selection-bar")).toContainText(
    "1 skill pair in draft",
  );
  const apply = selectionResponse(page, "skill_pair", 100);
  await page.getByRole("button", { name: "Apply selection" }).click();
  const result = await (await apply).json();
  expect(result.matchedCount).toBe(pair.count);
  expect(result.contributorHash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.selection.skillIds).toEqual([pair.a, pair.b]);
});

test("coverage projections and issue inspection preserve source, denominators, exact rows and export", async ({
  page,
}) => {
  const { scene } = await sceneFor(page, "coverage_cube", "all");
  expect(scene.matchedCount).toBe(86_190);
  expect(scene.data.companies).toHaveLength(311);
  expect(scene.data.diagnostics.basisDifferences).toBe(46);
  expect(scene.data.diagnostics.semanticStateDisagreements).toBe(0);
  expect(
    scene.data.diagnostics.locationComparablePairs +
      scene.data.diagnostics.locationExcludedPairs,
  ).toBe(scene.data.diagnostics.totalPairs);
  const basisGroup = scene.data.issueGroups.find(
    (group: any) => group.issue === "basis_difference",
  );
  expect(basisGroup.numerator).toBe(46);
  const stateGroup = scene.data.issueGroups.find(
    (group: any) => group.issue === "state_disagreement",
  );
  expect(stateGroup.numerator).toBe(0);

  await openSpatial(page);
  await page.getByLabel("Reported availability").selectOption("all");
  const coverageWait = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/spatial" &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.lens === "coverage_cube",
  );
  await page.getByRole("tab", { name: /Coverage cube/ }).click();
  expect((await coverageWait).ok()).toBeTruthy();
  await expect(page.locator(".coverage-projection svg")).toHaveCount(3);
  await expect(page.locator(".coverage-evidence tbody tr")).toHaveCount(
    scene.data.companies.length,
  );
  await expect(page.locator(".spatial-release")).toContainText(
    "86,190 matching postings",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await assertAxe(page);

  await page
    .getByText("Issue classes and exact contributors", { exact: true })
    .click();
  const inspect = selectionResponse(page, "diagnostic", 5);
  await page
    .getByRole("button", { name: `Inspect ${basisGroup.label}` })
    .click();
  const inspected = await (await inspect).json();
  expect(inspected.matchedCount).toBe(basisGroup.numerator);
  await expect(page.locator(".spatial-inspected strong")).toHaveText(
    fmt(basisGroup.numerator),
  );
  await expect(page.locator(".spatial-applied strong")).toHaveText("—");
  await page.getByRole("button", { name: `Draft ${basisGroup.label}` }).click();
  const apply = selectionResponse(page, "diagnostic", 100);
  await page.getByRole("button", { name: "Apply selection" }).click();
  const applied = await (await apply).json();
  expect(applied.matchedCount).toBe(basisGroup.numerator);
  expect(applied.contributorHash).toMatch(/^[a-f0-9]{64}$/);
  await expect(page.getByLabel("Source basis")).toHaveValue("combined");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export exact contributors" }).click();
  const csvText = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of csvText!) chunks.push(Buffer.from(chunk));
  const rows = parse(Buffer.concat(chunks).toString("utf8"), {
    columns: true,
    bom: true,
  }) as Record<string, string>[];
  expect(rows).toHaveLength(basisGroup.numerator);
  expect(new Set(rows.map((row) => row.id)).size).toBe(basisGroup.numerator);

  // Replacing a diagnostic draft with an inspected employer must replace the selector kind.
  await page.getByRole("button", { name: `Draft ${basisGroup.label}` }).click();
  const employer = scene.data.companies.find((item: any) => item.count > 46);
  const employerInspect = selectionResponse(page, "cell_union", 5);
  await page
    .locator(".coverage-evidence")
    .getByRole("button", { name: employer.label, exact: true })
    .click();
  expect((await (await employerInspect).json()).matchedCount).toBe(
    employer.count,
  );
  await page
    .locator(".spatial-inspected")
    .getByRole("button", { name: "Use this group as draft" })
    .click();
  const employerApply = selectionResponse(page, "cell_union", 100);
  await page.getByRole("button", { name: "Apply selection" }).click();
  expect((await (await employerApply).json()).matchedCount).toBe(
    employer.count,
  );
});

test("camera presets, manual camera state, overlap inspection and Escape preserve applied cohorts", async ({
  page,
}) => {
  const webgl = await page.evaluate(() => {
    try {
      const context = document.createElement("canvas").getContext("webgl2");
      context?.getExtension("WEBGL_lose_context")?.loseContext();
      return !!context;
    } catch {
      return false;
    }
  });
  test.skip(
    !webgl,
    "Browser has no WebGL2 context for camera and ray-hit checks",
  );

  const { scene } = await sceneFor(page, "demand_shelves");
  const groups = new Map<string, any[]>();
  for (const cell of scene.data.cells as any[]) {
    const key = `${cell.occupationId}\u0000${cell.level}`;
    groups.set(key, [...(groups.get(key) || []), cell]);
  }
  const overlapGroup = [...groups.values()]
    .map((items) => items.filter((cell) => cell.count > 0))
    .filter((items) => new Set(items.map((cell) => cell.arrangement)).size > 1)
    .sort(
      (a, b) =>
        b.reduce((n, c) => n + c.count, 0) - a.reduce((n, c) => n + c.count, 0),
    )[0];
  expect(overlapGroup?.length).toBeGreaterThan(1);

  await openSpatial(page);
  await page.getByRole("button", { name: "Open exact list" }).click();
  const initialRow = page
    .locator(".spatial-group-list > div")
    .filter({ has: page.locator("strong", { hasText: /[1-9]/ }) })
    .first();
  const initialCheckbox = initialRow.locator('input[type="checkbox"]');
  const initialLabel = await initialCheckbox.getAttribute("aria-label");
  await initialCheckbox.focus();
  await page.keyboard.press("Space");
  await expect(initialCheckbox).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(initialCheckbox).not.toBeChecked();
  expect(
    await page.evaluate(() =>
      (document.activeElement as HTMLElement)?.getAttribute("aria-label"),
    ),
  ).toBe(initialLabel);

  await initialCheckbox.check();
  const initialCount = unformat(await initialRow.locator("strong").innerText());
  const apply = selectionResponse(page, "cell_union", 100);
  await page.getByRole("button", { name: "Apply selection" }).click();
  expect((await (await apply).json()).matchedCount).toBe(initialCount);
  await expect(page.locator(".spatial-applied strong")).toHaveText(
    fmt(initialCount),
  );
  await page.getByRole("button", { name: "Freeze A" }).click();
  await expect(page.locator(".spatial-cohort-cards")).toContainText(
    fmt(initialCount),
  );

  await page
    .locator(".spatial-scene-controls label")
    .filter({ hasText: /^Action/ })
    .locator("select")
    .selectOption("inspect");
  await page.getByRole("button", { name: "3D", exact: true }).click();
  const canvas = page.locator(".spatial-viewport canvas");
  await expect(canvas).toBeVisible();
  await page.getByRole("button", { name: "front", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "front", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  const occupationIndex = scene.data.axes.occupations.findIndex(
    (item: any) => item.id === overlapGroup[0].occupationId,
  );
  const levelIndex = scene.data.axes.levels.indexOf(overlapGroup[0].level);
  const worldX = occupationIndex - 11;
  const worldY = levelIndex * 1.35 - 4.7;
  const box = (await canvas.boundingBox())!;
  const center = {
    x: box.x + box.width / 2 + worldX * 23,
    y: box.y + box.height / 2 - worldY * 23,
  };
  let found = false;
  for (const dy of [-12, 0, 12]) {
    for (const dx of [-12, 0, 12]) {
      await page.mouse.move(center.x + dx, center.y + dy);
      try {
        await expect(page.locator(".spatial-overlap-list p")).toContainText(
          new RegExp(`${overlapGroup.length} intersected marks`),
          { timeout: 500 },
        );
        found = true;
        break;
      } catch {
        /* Try the adjacent pixels around the known front-view projection. */
      }
    }
    if (found) break;
  }
  expect(
    found,
    "front view should expose coincident arrangement marks to the overlap list",
  ).toBeTruthy();
  const overlap = page.locator(".spatial-overlap-list");
  const overlapCount = Number(
    (await overlap.locator("p").innerText()).match(
      /(\d+) intersected marks/,
    )?.[1] || 0,
  );
  expect(overlapCount).toBe(overlapGroup.length);
  await expect(overlap.locator("button")).toHaveCount(overlapGroup.length);
  for (const cell of overlapGroup)
    await expect(overlap).toContainText(cell.arrangement);
  await expect(page.locator(".spatial-applied strong")).toHaveText(
    fmt(initialCount),
  );
  await expect(page.locator(".spatial-cohort-cards")).toContainText(
    fmt(initialCount),
  );

  const manual = page.locator(".spatial-viewport canvas").boundingBox();
  const canvasBox = await manual;
  await page.mouse.move(canvasBox!.x + 20, canvasBox!.y + 20);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + 75, canvasBox!.y + 54, { steps: 5 });
  await page.mouse.up();
  await expect(
    page.getByRole("status").filter({ hasText: "Camera: custom" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "front", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Reset camera" }).click();
  await expect(
    page.getByRole("button", { name: "overview", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".spatial-applied strong")).toHaveText(
    fmt(initialCount),
  );
  await expect(page.locator(".spatial-cohort-cards")).toContainText(
    fmt(initialCount),
  );
});
