import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("tour video: no download before play, accessible dialog, captions and transcript", async ({ page }) => {
  const videoRequests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/video/")) videoRequests.push(r.url());
  });
  await page.goto("/canvas");
  const open = page.getByRole("button", { name: /Watch the tour/ });
  await expect(open).toBeVisible();
  expect(videoRequests).toEqual([]);

  await open.click();
  const dialog = page.getByRole("dialog", { name: /90-second tour/ });
  await expect(dialog).toBeVisible();
  const video = dialog.locator("video");
  await expect(video).toHaveAttribute("preload", "none");
  await expect(video).not.toHaveAttribute("autoplay", /.*/);
  // captions are burned into the picture; the caption track is available but off by default (no duplicate text)
  await expect(video.locator('track[kind="captions"]')).toHaveAttribute("src", "/video/tour-v1.en.vtt");
  await expect(video.locator('track[kind="captions"]')).not.toHaveAttribute("default", /.*/);
  // the poster and caption files may load; the video file must not load before play
  await page.waitForTimeout(1500);
  expect(videoRequests.filter((u) => u.endsWith(".mp4"))).toEqual([]);

  const result = await new AxeBuilder({ page }).include(".tour-dialog").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);

  await dialog.getByText("Read the transcript").click();
  await expect(dialog.getByText(/Python appears in 3,621 tech postings/)).toBeVisible();
  await expect(dialog.getByRole("navigation", { name: "Tour chapters" }).getByRole("button")).toHaveCount(6);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

test("tour video files are served same-origin with the right types", async ({ request }) => {
  const mp4 = await request.get("/video/tour-v2-720.mp4", { headers: { Range: "bytes=0-1023" } });
  expect([200, 206]).toContain(mp4.status());
  expect(mp4.headers()["content-type"]).toContain("video/mp4");
  const vtt = await request.get("/video/tour-v1.en.vtt");
  expect(vtt.status()).toBe(200);
  expect(await vtt.text()).toMatch(/^WEBVTT/);
});
