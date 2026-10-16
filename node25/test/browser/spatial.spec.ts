import { test, expect, type Download, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { parse } from "csv-parse/sync";

async function openSpatial(page: Page) {
  await page.goto("/spatial");
  await expect(page.getByRole("heading", { name: /Give the question/ })).toBeVisible();
  await expect(page.locator(".spatial-release")).toContainText("82,851 matching postings");
  return page.locator(".spatial-app");
}

function nextSceneResponse(page: Page, lens: string) {
  return page.waitForResponse((response) => {
    const request = response.request();
    return (
      new URL(response.url()).pathname === "/api/spatial" &&
      request.method() === "POST" &&
      request.postDataJSON()?.lens === lens
    );
  });
}

async function firstPositiveGroup(page: Page) {
  const group = page
    .locator(".spatial-group-list > div")
    .filter({ has: page.locator("strong", { hasText: /[1-9]/ }) })
    .first();
  await expect(group).toBeVisible();
  const label = (await group.locator("button").innerText()).trim();
  const expectedCount = Number((await group.locator("strong").innerText()).replaceAll(",", ""));
  expect(expectedCount).toBeGreaterThan(0);
  return { group, label, expectedCount };
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}

async function downloadText(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("CSV download did not provide a readable stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

test("default demand scene, inspect/draft/apply, exact contributors, CSV and A/B overlap", async ({ page }) => {
  const spatialCalls: { url: string; body: any }[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/spatial") && request.method() === "POST") {
      spatialCalls.push({ url: new URL(request.url()).pathname, body: request.postDataJSON() });
    }
  });

  await openSpatial(page);
  await expect(page.getByRole("tab", { name: /Demand shelves/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".spatial-demand-matrix")).toBeVisible();
  const matrixCell = page.locator(".spatial-demand-matrix button").first();
  await expect(matrixCell).toBeVisible();
  const matrixLabel = (await matrixCell.getAttribute("aria-label"))!;
  const expectedCount = Number(matrixLabel.match(/: ([\d,]+) postings$/)![1].replaceAll(",", ""));
  await matrixCell.click();
  const label = (await page.locator(".spatial-inspected h3").innerText()).trim();
  expect(expectedCount).toBeGreaterThan(0);
  await expect(page.locator(".spatial-inspected h3")).toHaveText(label);
  await expect(page.locator(".spatial-inspected strong")).toHaveText(expectedCount.toLocaleString("en-US"));
  await expect(page.locator(".spatial-applied strong")).toHaveText("—");
  await expect(page.locator(".spatial-records-card")).toContainText("Apply a selection to open its contributors");

  await page.locator(".spatial-inspected").getByRole("button", { name: "Use this group as draft" }).click();
  const draftSummary = page.locator(".spatial-selection-bar span strong");
  await expect(draftSummary).toHaveText(/^\d+ aggregate cells$/);
  const initialDraft = Number((await draftSummary.innerText()).match(/^(\d+)/)?.[1]);
  expect(Number(initialDraft)).toBeGreaterThan(1);
  await expect(page.locator(".spatial-applied strong")).toHaveText("—");
  const selectedResponse = page.waitForResponse(
    (response) => response.url().includes("/api/spatial/selection") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Apply selection" }).click();
  const selected = await (await selectedResponse).json();
  expect(selected.matchedCount).toBe(expectedCount);
  expect(selected.data.records.rows).toHaveLength(Math.min(expectedCount, 100));
  expect(selected.contributorHash).toMatch(/^[a-f0-9]{64}$/);
  await expect(page.locator(".spatial-applied strong")).toHaveText(expectedCount.toLocaleString("en-US"));

  const downloadWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export exact contributors" }).click();
  const download = await downloadWait;
  const csv = parse(await downloadText(download), { columns: true, bom: true }) as Record<string, string>[];
  expect(csv).toHaveLength(expectedCount);
  expect(new Set(csv.map((row) => row.id)).size).toBe(expectedCount);

  await expect(page.getByRole("button", { name: "Freeze A" })).toBeEnabled();
  await page.getByRole("button", { name: "Freeze A" }).click();
  await expect(page.locator(".spatial-cohort-cards")).toContainText(expectedCount.toLocaleString("en-US"));
  await page.getByLabel("Reported availability").selectOption("all");
  const matrixPrefix = matrixLabel.replace(/: [\d,]+ postings$/, "");
  const broaderCell = page.getByRole("button", { name: new RegExp(`^${matrixPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`) });
  await expect(broaderCell).toBeVisible();
  const broaderLabel = (await broaderCell.getAttribute("aria-label"))!;
  const expectedBroaderCount = Number(broaderLabel.match(/: ([\d,]+) postings$/)![1].replaceAll(",", ""));
  await broaderCell.click();
  await page.locator(".spatial-inspected").getByRole("button", { name: "Use this group as draft" }).click();
  await expect(draftSummary).toHaveText(/^\d+ aggregate cells$/);
  const broaderDraft = Number((await draftSummary.innerText()).match(/^(\d+)/)?.[1]);
  expect(Number(broaderDraft)).toBeGreaterThan(1);
  const secondSelectionResponse = page.waitForResponse(
    (response) => response.url().includes("/api/spatial/selection") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Apply selection" }).click();
  const secondSelection = await (await secondSelectionResponse).json();
  expect(secondSelection.matchedCount).toBeGreaterThanOrEqual(expectedCount);
  expect(secondSelection.matchedCount).toBe(expectedBroaderCount);
  const comparisonResponse = page.waitForResponse(
    (response) => response.url().includes("/api/spatial/compare") && response.request().method() === "POST",
  );
  await expect(page.getByRole("button", { name: "Freeze B" })).toBeEnabled();
  await page.getByRole("button", { name: "Freeze B" }).click();
  const comparison = await (await comparisonResponse).json();
  expect(comparison.data.a.hash).toBe(selected.contributorHash);
  expect(comparison.data.b.hash).toBe(secondSelection.contributorHash);
  expect(comparison.data.overlap).toBe(expectedCount);
  expect(comparison.data.onlyA).toBe(0);
  expect(comparison.data.onlyB).toBe(secondSelection.matchedCount - expectedCount);
  await expect(page.locator(".spatial-overlap")).toContainText(expectedCount.toLocaleString("en-US"));
  expect(spatialCalls.some((call) => call.url === "/api/spatial" && call.body.lens === "demand_shelves")).toBeTruthy();
  expect(spatialCalls.some((call) => call.url === "/api/spatial/selection")).toBeTruthy();
});

test("coverage and skill lenses preserve the matched population while changing basis and focus", async ({ page }) => {
  await openSpatial(page);
  const release = page.locator(".spatial-release");
  const coverageWait = nextSceneResponse(page, "coverage_cube");
  await page.getByRole("tab", { name: /Coverage cube/ }).click();
  const coverageResponse = await coverageWait;
  expect(coverageResponse.status()).toBe(200);
  expect((await coverageResponse.json()).matchedCount).toBe(82_851);
  await expect(page.locator(".spatial-svg")).toHaveAttribute("role", "img");
  await expect(page.locator("#coverage-title")).toHaveText("Employer coverage comparison");
  await expect(release).toContainText("82,851 matching postings");

  const skillsWait = nextSceneResponse(page, "skill_neighborhood");
  await page.getByRole("tab", { name: /Skill neighborhood/ }).click();
  const skillsResponse = await skillsWait;
  expect(skillsResponse.status()).toBe(200);
  expect((await skillsResponse.json()).matchedCount).toBe(82_851);
  await expect(page.locator("#skill-layout-title")).toHaveText("Recorded skill co-mention neighborhood");
  const focus = page.getByLabel("Focus skill");
  const optionCount = await focus.locator("option").count();
  expect(optionCount).toBeGreaterThan(1);
  const originalFocus = await focus.inputValue();
  const alternate = await focus.locator("option").evaluateAll((options, current) => {
    const other = options.find((option) => (option as HTMLOptionElement).value !== current) as HTMLOptionElement | undefined;
    return other?.value ?? "";
  }, originalFocus);
  const focusWait = nextSceneResponse(page, "skill_neighborhood");
  await focus.selectOption(alternate);
  const focusResponse = await focusWait;
  expect(focusResponse.status()).toBe(200);
  expect((await focusResponse.json()).matchedCount).toBe(82_851);
  await expect(release).toContainText("82,851 matching postings");

  const basisWait = nextSceneResponse(page, "skill_neighborhood");
  await page.getByLabel("Observation basis").selectOption("analyzed_text");
  const basisResponse = await basisWait;
  expect(basisResponse.status()).toBe(200);
  const analyzed = await basisResponse.json();
  expect(analyzed.matchedCount).toBe(82_851);
  expect(analyzed.analysisCount).toBeLessThan(analyzed.matchedCount);
  expect(analyzed.basisExcludedCount).toBe(analyzed.matchedCount - analyzed.analysisCount);
  await expect(page.locator(".spatial-caution")).toContainText("excluded by basis");
  await expect(page.locator(".spatial-caution")).toContainText("analyzed text");
  await expect(release).toContainText("82,851 matching postings");
});

test("Three renderer stays lazy; WebGL fallback or context loss returns to 2D with cohort intact", async ({ page }) => {
  const rendererRequests: string[] = [];
  page.on("request", (request) => {
    if (/SpatialScene|spatial-scene/i.test(request.url())) rendererRequests.push(request.url());
  });
  await openSpatial(page);
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(rendererRequests).toEqual([]);

  await page.getByRole("button", { name: "Open exact list" }).click();
  const { group } = await firstPositiveGroup(page);
  await group.locator("button").click();
  await page.locator(".spatial-inspected").getByRole("button", { name: "Use this group as draft" }).click();
  await expect(page.locator(".spatial-selection-bar span strong")).toHaveText("1 aggregate cells");
  await page.getByRole("button", { name: "Apply selection" }).click();
  await expect(page.locator(".spatial-applied strong")).not.toHaveText("—");
  await expect(page.getByRole("button", { name: "Freeze A" })).toBeEnabled();
  await page.getByRole("button", { name: "Freeze A" }).click();
  const pinnedCount = await page.locator(".spatial-cohort-cards > div").first().locator("strong").innerText();

  const webglAvailable = await page.evaluate(() => {
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl2");
      context?.getExtension("WEBGL_lose_context")?.loseContext();
      return !!context;
    } catch {
      return false;
    }
  });
  await page.getByRole("button", { name: "3D", exact: true }).click();
  if (!webglAvailable) {
    await expect(page.getByRole("button", { name: "2D", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".spatial-notice")).toContainText("WebGL2 is unavailable");
  } else {
    await expect(page.getByRole("button", { name: "3D", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".spatial-viewport canvas")).toBeVisible();
    expect(rendererRequests.length).toBeGreaterThan(0);
    await page.locator(".spatial-viewport canvas").evaluate((canvas) => {
      canvas.dispatchEvent(new Event("webglcontextlost", { bubbles: false, cancelable: true }));
    });
    await expect(page.getByRole("button", { name: "2D", exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.locator(".spatial-cohort-cards > div").first().locator("strong")).toHaveText(pinnedCount);
  await expect(page.locator(".spatial-demand-matrix")).toBeVisible();
});

test("keyboard exact list, scene sharing, reload, mobile layout and accessible controls", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openSpatial(page);
  await page.getByRole("button", { name: "Open exact list" }).click();
  const { group, label } = await firstPositiveGroup(page);
  const checkbox = group.getByRole("checkbox", { name: `Select ${label}` });
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await expect(page.locator(".spatial-selection-bar")).toContainText("1 aggregate cells in draft");
  await page.keyboard.press("Escape");
  await expect(page.locator(".spatial-selection-bar")).toContainText("0 aggregate cells in draft");
  await expect(page.locator(".spatial-applied strong")).toHaveText("—");

  await page.getByRole("button", { name: "Share scene" }).click();
  await expect(page).toHaveURL(/\/spatial\?study=/);
  const sharedUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(sharedUrl);
  await expect(page.locator(".spatial-release")).toContainText("82,851 matching postings");
  await expect(page.locator(".spatial-applied strong")).toHaveText("—");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await axe(page);
});
