import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const metrics = JSON.parse(readFileSync(new URL("../fixtures/release-metrics.json", import.meta.url), "utf8"));

test("saved studies recompute frozen counts, restore exact selectors and reject stale releases", async ({
  page,
}) => {
  const catalog = await (await page.request.get("/api/catalog")).json();
  expect(catalog.datasetVersion).toBe(metrics.datasetVersion);
  const sceneRequest = {
    protocolVersion: "2.5.1",
    datasetVersion: catalog.datasetVersion,
    requestId: "study-contract",
    sourceMode: "local",
    filter: { availability: "all" },
    lens: "demand_shelves",
    basis: "posting_inventory",
  };
  const scene = await (
    await page.request.post("/api/spatial", { data: sceneRequest })
  ).json();
  const cell = scene.data.cells.find((c: { count: number }) => c.count > 0);
  const request = {
    sceneRequest: scene.sceneRequest,
    sceneQueryHash: scene.queryHash,
    selection: { kind: "cell_union", cellIds: [cell.id] },
  };
  const study = {
    version: "2.5.1",
    datasetVersion: catalog.datasetVersion,
    mode: "local",
    filter: { availability: "all" },
    lens: "demand_shelves",
    basis: "recorded_mentions",
    focusSkillId: catalog.skills[0].id,
    support: 20,
    shelf: "All arrangements",
    committed: request,
    a: {
      label: "Untrusted cached value",
      request,
      count: 999999,
      hash: "0".repeat(64),
    },
    b: null,
  };
  await page.goto("/spatial");
  await expect(page.locator(".spatial-release")).toContainText(
    `${metrics.populations.combined.open.toLocaleString("en-US")} matching`,
  );
  const input = page.getByLabel("Restore full study JSON");
  await input.setInputFiles({
    name: "study.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(study)),
  });
  await expect(
    page.getByText("Study restored after server validation.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Source basis")).toHaveValue("local");
  await expect(page.locator(".spatial-applied strong")).toHaveText(
    cell.count.toLocaleString("en-US"),
  );
  await expect(
    page.locator(".spatial-cohort-cards > div").first().locator("strong"),
  ).toHaveText(cell.count.toLocaleString("en-US"));
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save full study" }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const saved = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(saved.mode).toBe("local");
  expect(saved.a.count).toBe(cell.count);
  expect(saved.a.hash).not.toBe(study.a.hash);
  expect(saved.committed.selection).toEqual(request.selection);
  expect(saved.a.request.sceneQueryHash).toBe(scene.queryHash);
  await input.setInputFiles({
    name: "stale.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ ...study, datasetVersion: "0".repeat(64) }),
    ),
  });
  await expect(
    page.getByText(
      "Study is invalid or uses an unavailable release. No cohorts were changed.",
    ),
  ).toBeVisible();
  await expect(page.locator(".spatial-applied strong")).toHaveText(
    cell.count.toLocaleString("en-US"),
  );
  const mismatched = structuredClone(study);
  (mismatched.committed.sceneRequest.filter as Record<string, unknown>).search =
    "different visible population";
  await input.setInputFiles({
    name: "mismatched.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(mismatched)),
  });
  await expect(
    page.getByText("Applied cohort does not match the visible scene.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.locator(".spatial-applied strong")).toHaveText(
    cell.count.toLocaleString("en-US"),
  );
});

test("failed selection stays unavailable and cannot be frozen or exported as zero", async ({
  page,
}) => {
  await page.goto("/spatial");
  await expect(page.locator(".spatial-release")).toContainText(
    `${metrics.populations.combined.open.toLocaleString("en-US")} matching`,
  );
  await page.route("**/api/spatial/selection", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Selection service unavailable" }),
    }),
  );
  await page.getByRole("button", { name: "Open exact list" }).click();
  await page.locator(".spatial-group-list input").first().check();
  await page.getByRole("button", { name: "Apply selection" }).click();
  await expect(page.locator(".spatial-applied strong")).toHaveText(
    "Unavailable",
  );
  await expect(page.getByRole("button", { name: "Freeze A" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Export exact contributors" }),
  ).toBeDisabled();
});

test("isolated shelf lasso selects the complete orthographic population only after Apply", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/spatial");
  await expect(page.locator(".spatial-release")).toContainText(
    `${metrics.populations.combined.open.toLocaleString("en-US")} matching`,
  );
  await page.getByLabel("Arrangement layer").selectOption("Remote");
  await page.getByRole("button", { name: "Lasso isolated layer" }).click();
  const svg = page.getByRole("img", {
    name: "Isolated shelf lasso. Keyboard equivalent: exact group list below.",
  });
  await expect(svg).toBeVisible();
  await svg.scrollIntoViewIfNeeded();
  const expected = await svg
    .locator("circle title")
    .evaluateAll((titles) =>
      titles.reduce(
        (sum, title) =>
          sum + Number(title.textContent?.split(": ").at(-1) || 0),
        0,
      ),
    );
  expect(expected).toBeGreaterThan(0);
  const box = (await svg.boundingBox())!;
  const points = [
    [0.085, 0.065],
    [0.975, 0.065],
    [0.975, 0.89],
    [0.085, 0.89],
    [0.085, 0.065],
  ];
  await page.mouse.move(
    box.x + points[0][0] * box.width,
    box.y + points[0][1] * box.height,
  );
  await page.mouse.down();
  for (const [x, y] of points.slice(1))
    await page.mouse.move(box.x + x * box.width, box.y + y * box.height, {
      steps: 8,
    });
  await page.mouse.up();
  expect(errors).toEqual([]);
  await expect(page.locator(".spatial-applied strong")).toHaveText("—");
  await expect(
    page.getByRole("button", { name: "Apply selection" }),
  ).toBeEnabled();
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/api/spatial/selection") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Apply selection" }).click();
  const selection = await (await response).json();
  expect(selection.matchedCount).toBe(expected);
  await expect(page.locator(".spatial-applied strong")).toHaveText(
    expected.toLocaleString("en-US"),
  );
});

test("stale scene links make no analytical requests until an explicit fresh study", async ({ page }) => {
  const catalog = await (await page.request.get("/api/catalog")).json();
  expect(catalog.datasetVersion).toBe(metrics.datasetVersion);
  const stale = {
    version: "2.5.1",
    datasetVersion: "0".repeat(64),
    mode: "local",
    filter: { availability: "all", search: "outdated-scene-do-not-apply" },
    lens: "coverage_cube",
    basis: "recorded_mentions",
    support: 20,
  };
  const requests: { path: string; body: any }[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/spatial") && request.method() === "POST")
      requests.push({ path, body: request.postDataJSON() });
  });
  await page.goto("/spatial?study=" + encodeURIComponent(Buffer.from(JSON.stringify(stale)).toString("base64")));
  await expect(page.getByRole("heading", { name: "This scene belongs to a different release." })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("have not been applied");
  await expect(page.getByRole("button", { name: "Share scene" })).toBeDisabled();
  await expect(page.locator(".spatial-filters")).toHaveCount(0);
  await expect(page.locator(".spatial-release")).toHaveCount(0);
  await page.waitForTimeout(150);
  expect(requests).toEqual([]);
  const response = page.waitForResponse((result) => new URL(result.url()).pathname === "/api/spatial" && result.request().method() === "POST");
  await page.getByRole("button", { name: "Start a fresh study", exact: true }).click();
  const fresh = await (await response).json();
  expect(requests[0].body.datasetVersion).toBe(catalog.datasetVersion);
  expect(requests[0].body.sourceMode).toBe("combined");
  expect(requests[0].body.lens).toBe("demand_shelves");
  expect(requests[0].body.filter).toEqual({ availability: "open" });
  await expect(page.locator(".spatial-release")).toContainText(`${fresh.matchedCount.toLocaleString("en-US")} matching postings`);
  await expect(page.getByRole("combobox", { name: "Source basis", exact: true })).toHaveValue("combined");
  await expect(page.getByRole("textbox", { name: "Search recorded fields" })).toHaveValue("");
  await expect(page.locator(".spatial-applied strong")).toHaveText("—");
  await expect(page.locator(".spatial-cohort-cards > div strong")).toHaveText(["—", "—"]);
  expect(new URL(page.url()).searchParams.has("study")).toBe(false);
});
