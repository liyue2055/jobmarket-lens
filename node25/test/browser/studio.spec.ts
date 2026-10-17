import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const metrics = JSON.parse(readFileSync(new URL("../fixtures/release-metrics.json", import.meta.url), "utf8"));
import AxeBuilder from "@axe-core/playwright";
import { parse } from "csv-parse/sync";
import fs from "node:fs";
async function localStudy(page: Page, workspace = "canvas") {
  const catalog = await (await page.request.get("/api/catalog")).json();
  expect(catalog.datasetVersion).toBe(metrics.datasetVersion);
  return {
    v: "2.5",
    datasetVersion: catalog.datasetVersion,
    mode: "local",
    workspace,
    filter: { availability: "open" },
    a: null,
    b: null,
  };
}
async function openLocal(page: Page, workspace = "canvas") {
  const study = await localStudy(page, workspace);
  await page.goto(
    "/" + workspace + "?study=" + encodeURIComponent(JSON.stringify(study)),
  );
  await expect(page.getByTestId("matched-count")).toHaveText(metrics.populations.local.open.toLocaleString("en-US"));
  return study;
}
async function audit(page: Page) {
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
test("real canvas requests aggregates and bounded pages; exact group selection, comparison and CSV agree", async ({
  page,
}) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/canvas");
  await expect(page.getByTestId("matched-count")).toHaveText(/[\d,]+/);
  await expect(page.locator(".records-table tbody tr")).toHaveCount(100);
  const cell = page.locator(".matrix-cell").first();
  const expected = Number(
    (await cell.getAttribute("aria-label"))!.match(/: (\d+) postings/)![1],
  );
  await cell.click();
  await expect(page.getByTestId("matched-count")).toHaveText(
    expected.toLocaleString("en-US"),
  );
  await openLocal(page);
  await page
    .getByRole("button", { name: /Pin view$/ })
    .first()
    .click();
  await page.getByLabel("Search titles, employers or skills").fill("engineer");
  await expect(page.getByTestId("matched-count")).not.toHaveText(metrics.populations.local.open.toLocaleString("en-US"));
  const selected = Number(
    (await page.getByTestId("matched-count").innerText()).replaceAll(",", ""),
  );
  expect(selected).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: /Pin view$/ })
    .nth(1)
    .click();
  await expect(page.locator(".overlap-summary")).toContainText(
    selected.toLocaleString("en-US"),
  );
  await expect(page.locator(".pin-card.a .pin-card-count")).toContainText(metrics.populations.local.open.toLocaleString("en-US"));
  await expect(page.locator(".pin-card.b .pin-card-count")).toContainText(
    String(selected),
  );
  const wait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export records", exact: true })
    .click();
  const download = await wait;
  const csv = parse(fs.readFileSync((await download.path())!, "utf8"), {
    columns: true,
    bom: true,
  }) as Record<string, string>[];
  expect(csv).toHaveLength(selected);
  expect(new Set(csv.map((r) => r.id)).size).toBe(selected);
  expect(
    requests.some((u) =>
      /postings.*\.(?:parquet|json)|\/data\/releases|\/store\//.test(u),
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "test-results/node25-canvas-desktop.png",
    fullPage: true,
  });
});
test("paging, shared links and frozen cohorts survive navigation and reload", async ({
  page,
}) => {
  await page.goto("/canvas");
  await expect(page.locator(".records-table tbody tr")).toHaveCount(100);
  const first = await page.locator(".record-title").first().innerText();
  await page.getByRole("button", { name: "Next records" }).click();
  await expect(page.locator(".records-footer")).toContainText("101");
  await expect(page.locator(".record-title").first()).not.toHaveText(first);
  await openLocal(page);
  await page
    .getByRole("button", { name: /Pin view$/ })
    .first()
    .click();
  await page.getByLabel("Add work arrangement filter").selectOption("Remote");
  await expect(page.getByTestId("matched-count")).not.toHaveText(metrics.populations.local.open.toLocaleString("en-US"));
  const count = await page.getByTestId("matched-count").innerText();
  await page
    .getByRole("button", { name: /Pin view$/ })
    .nth(1)
    .click();
  await page.getByRole("link", { name: "Skill connections" }).click();
  await expect(
    page.getByRole("heading", { name: "Read the shared language." }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("matched-count")).toHaveText(count);
  await expect(page.getByLabel("Cohort A label")).toHaveValue("Cohort A");
  await page.getByRole("link", { name: "Evidence & sources" }).click();
  await expect(
    page.getByRole("heading", { name: "Good analysis leaves a trail." }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Read the shared language." }),
  ).toBeVisible();
});
test("mobile keyboard, reduced motion, filters and record evidence are accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openLocal(page);
  const filters = page.getByRole("button", { name: "Filters", exact: true });
  await filters.click();
  await expect(
    page.getByRole("dialog", { name: "Study filters" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close study filters" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(filters).toBeFocused();
  const inspect = page.getByRole("button", { name: /^Inspect / }).first();
  await inspect.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close record details" }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Trace the evidence" }),
  ).toBeVisible();
  await audit(page);
  await page.keyboard.press("Escape");
  await expect(inspect).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/node25-canvas-mobile.png",
    fullPage: true,
  });
});
test("skill pairs resolve exact contributor counts; all public workspaces meet WCAG checks", async ({
  page,
}) => {
  await openLocal(page);
  await page
    .getByRole("button", { name: /Pin view$/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Pin view$/ })
    .nth(1)
    .click();
  for (const name of [
    "Research canvas",
    "Skill connections",
    "Evidence & sources",
  ]) {
    await page.getByRole("link", { name, exact: true }).click();
    if (name === "Skill connections")
      await expect(page.locator(".skill-matrix")).toBeVisible();
    if (name === "Evidence & sources")
      await expect(
        page.getByRole("heading", { name: "Good analysis leaves a trail." }),
      ).toBeVisible();
    await audit(page);
  }
  await page
    .getByRole("link", { name: "Skill connections", exact: true })
    .click();
  const pair = page.locator(".skill-matrix td button:not(.diagonal)").first();
  const expected = Number(
    (await pair.getAttribute("aria-label"))!.match(/: (\d+) postings/)![1],
  );
  await pair.click();
  await expect(page.getByTestId("matched-count")).toHaveText(
    expected.toLocaleString("en-US"),
  );
  await page.screenshot({
    path: "test-results/node25-skills-desktop.png",
    fullPage: true,
  });
});
test("stale responses never replace the latest query and invalid study versions are blocked", async ({
  page,
}) => {
  await openLocal(page);
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.filter?.search === "engineer") {
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
    await route.continue();
  });
  const search = page.getByLabel("Search titles, employers or skills");
  await search.fill("engineer");
  await page.waitForTimeout(350);
  await search.fill("no-posting-can-match-this-fixture");
  await expect(page.getByTestId("matched-count")).toHaveText("0");
  await page.waitForTimeout(800);
  await expect(page.getByTestId("matched-count")).toHaveText("0");
  const s = await localStudy(page);
  await page.goto(
    "/canvas?study=" +
      encodeURIComponent(
        JSON.stringify({ ...s, datasetVersion: "a".repeat(64) }),
      ),
  );
  await expect(page.getByRole("alert")).toContainText("different release");
  await expect(
    page.getByRole("heading", { name: "Keep the original study intact." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start a fresh study" }).click();
  await expect(page.locator(".demand-matrix")).toBeVisible();
});
test("owner authentication protects real admin status and never stores passwords", async ({
  page,
  baseURL,
}) => {
  test.skip(
    !baseURL?.includes("127.0.0.1:4185"),
    "Only fixture credentials on the isolated local test server.",
  );
  expect((await page.request.get("/api/admin")).status()).toBe(401);
  await page.goto("/admin");
  await expect(page.getByLabel("Owner password")).toBeVisible();
  await page.getByLabel("Owner password").fill("local-browser-test-password");
  await page.getByRole("button", { name: /Sign in securely/ }).click();
  await expect(
    page.getByRole("heading", { name: "A snapshot, with an audit trail." }),
  ).toBeVisible();
  await expect(page.locator(".admin-summary")).toContainText(metrics.counts.combined.toLocaleString("en-US"));
  await expect(page.locator(".admin-summary")).toContainText("Unavailable");
  await expect(
    page.getByRole("heading", { name: "Reporting is not connected." }),
  ).toBeVisible();
  await expect(page.locator(".collection-banner")).toContainText("disabled");
  await expect(page.locator(".admin-runs article")).toHaveCount(7);
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === "lens_admin",
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Strict");
  expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(10_700);
  expect(cookie!.expires - Date.now() / 1000).toBeLessThan(10_801);
  expect(
    await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    })),
  ).toEqual({ local: {}, session: {} });
  await audit(page);
  await page.screenshot({
    path: "test-results/node25-admin.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Owner password")).toBeVisible();
  expect((await page.request.get("/api/admin")).status()).toBe(401);
});
test("optional open-source analytics sends public paths only, never study state or admin", async ({
  page,
}) => {
  await page.route("**/api/catalog", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.analytics = {
      scriptUrl: new URL("/test-umami.js", route.request().url()).href,
      websiteId: "public-test-site-id",
    };
    await route.fulfill({ response, json: body });
  });
  await page.route("**/test-umami.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "window.__testEvents=[];window.umami={track:function(data){window.__testEvents.push(data)}}",
    }),
  );
  await openLocal(page);
  await expect(page.locator("#lens-umami")).toHaveAttribute(
    "data-auto-track",
    "false",
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).__testEvents?.length))
    .toBe(1);
  await page
    .getByLabel("Search titles, employers or skills")
    .fill("private-search-value");
  await expect(page.getByTestId("matched-count")).toHaveText("0");
  await page.getByRole("link", { name: "Evidence & sources" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__testEvents?.length))
    .toBe(2);
  const events = await page.evaluate(() => (window as any).__testEvents);
  expect(events.map((e: any) => e.url)).toEqual(["/canvas", "/evidence"]);
  expect(JSON.stringify(events)).not.toContain("private-search-value");
  expect(JSON.stringify(events)).not.toContain("study=");
  await page.goto("/admin");
  await expect(page.locator("#lens-umami")).toHaveCount(0);
});

test("filter contract boundaries reject oversized imported study values", async () => {
  const { validateFilter } = await import("../../src/state");
  expect(() =>
    validateFilter({
      search: "a".repeat(160),
      companyIds: Array.from({ length: 32 }, (_, i) => String(i)),
      occupationIds: ["a".repeat(160)],
    }),
  ).not.toThrow();
  expect(() => validateFilter({ search: "a".repeat(161) })).toThrow("160");
  expect(() =>
    validateFilter({
      companyIds: Array.from({ length: 33 }, (_, i) => String(i)),
    }),
  ).toThrow("32");
  expect(() => validateFilter({ occupationIds: ["a".repeat(161)] })).toThrow(
    "160",
  );
});
test("owner view labels provider supplied reporting window and last check", async ({
  page,
}) => {
  // Synthetic presentation fixture; authentication is covered by the real admin scenario above.
  await page.route("**/api/admin", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        deployment: { version: "test fixture" },
        runtime: { scope: "Synthetic UI fixture" },
        collection: {
          counts: { combined: 3 },
          sources: [],
          lastSnapshot: null,
          scheduled: false,
          runs: [],
          limitations: [],
        },
        traffic: {
          configured: true,
          source: "Umami test fixture",
          visitors: 12,
          pageViews: 20,
          routes: [],
          countries: [],
          limitations: [],
          since: "2026-10-01T00:00:00Z",
          until: "2026-10-08T00:00:00Z",
          checkedAt: "2026-10-08T00:05:00Z",
          status: "available",
        },
      },
    }),
  );
  await page.goto("/admin");
  const dates = page.locator('dl[aria-label="Analytics reporting window"]');
  await expect(dates).toContainText("Oct 1, 2026");
  await expect(dates).toContainText("Oct 8, 2026");
  await expect(dates).toContainText("UTC");
  await expect(dates).toContainText("Last checked");
  await expect(dates).toContainText("available");
});

test("historical tour identifies a different current dataset without changing its recorded content", async ({ page }) => {
  const catalog = await (await page.request.get("/api/catalog")).json();
  expect(catalog.datasetVersion).toBe(metrics.datasetVersion);
  await page.goto("/canvas");
  await page.getByRole("button", { name: /Watch the tour/ }).click();
  const dialog = page.getByRole("dialog", { name: /90-second tour/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("recorded on release 2d18d6d0");
  const notice = dialog.getByRole("note");
  if (!catalog.datasetVersion.startsWith("2d18d6d0")) {
    await expect(notice).toContainText("This historical tour was recorded on release 2d18d6d0");
    await expect(notice).toContainText(catalog.datasetVersion.slice(0, 8));
    await expect(notice).toContainText("counts and examples in the recording can differ");
  } else await expect(notice).toHaveCount(0);
  await expect(dialog.locator('source')).toHaveAttribute("src", "/video/tour-v2-720.mp4");
});
