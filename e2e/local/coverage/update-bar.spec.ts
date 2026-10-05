import { test, expect, type Browser, type Page } from "@playwright/test";
import { authFile, PEOPLE } from "../fixtures";

/**
 * Coverage — the update bar (I49: UpdateBar 2). "A new version of Maestro is available" — the bar
 * that ends a tab quietly running last week's code (`src/app/useAppVersion.ts`).
 *
 * The "may": the server names a different build than the tab was started with, the bar appears,
 * *Not now* hides it and *Reload* reloads. The "may not": the server names the same build, and no
 * bar appears — the reader is current and is not nagged.
 *
 * The bar can never show under a plain dev server (the id is `dev`), so `playwright.local.config.ts`
 * starts the dev server with `E2E_BUILD_ID` set (I49.84). A dev server started by hand does not
 * carry it; this spec then fails and says so, rather than passing over a bar it never saw.
 */
async function as(browser: Browser, tag: keyof typeof PEOPLE): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(tag) });
  return ctx.newPage();
}

/**
 * What the dev server was started with — the same value the bundle carries.
 *
 * A server started BY HAND carries no build id, and then this pair cannot be tested at all. That
 * used to be reported as a failure, which reads exactly like the update bar being broken; it is
 * really "you cannot ask this question of this server" (I54.23, Edward 23 Sep). So the pair stands
 * down and says why. On the build machine the runner starts the server itself
 * (`playwright.local.config.ts` sets `E2E_BUILD_ID`), so there it always runs.
 *
 * To exercise it locally: stop your own dev server first and let the runner start one.
 */
async function servedBuildId(page: Page): Promise<string> {
  const res = await page.request.get("/version.json");
  expect(res.ok(), "the dev server answers /version.json").toBe(true);
  const { buildId } = (await res.json()) as { buildId?: string };
  test.skip(
    !buildId || buildId === "dev",
    "this dev server carries no build id (started by hand) — stop it and let the runner start one, or run on CI",
  );
  return buildId!;
}

test.describe("Coverage — the update bar", () => {
  test("may: a newer build on the server shows the bar; Not now hides it; Reload reloads", async ({
    browser,
  }) => {
    const page = await as(browser, "admin");
    const current = await servedBuildId(page);

    // The server has moved on since this tab loaded.
    await page.route("**/version.json", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ buildId: `${current}-next` }),
      }),
    );
    await page.goto("/");
    await expect(page.getByTestId("update-bar")).toBeVisible();
    await expect(page.getByTestId("update-bar")).toContainText(/new version/i);

    // Not now: gone for this tab, nothing reloaded.
    await page.getByTestId("update-bar-dismiss").click();
    await expect(page.getByTestId("update-bar")).toHaveCount(0);
    await expect(page.getByTestId("nav-dashboard")).toBeVisible();

    // A fresh load asks again and the bar is back; Reload reloads the page.
    await page.reload();
    await expect(page.getByTestId("update-bar")).toBeVisible();
    const reloaded = page.waitForEvent("load");
    await page.getByTestId("update-bar-reload").click();
    await reloaded;
    await expect(page.getByTestId("nav-dashboard")).toBeVisible();
    await page.context().close();
  });

  test("may not: the server names the same build, and nobody is nagged", async ({
    browser,
  }) => {
    const page = await as(browser, "admin");
    const current = await servedBuildId(page);
    await page.route("**/version.json", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ buildId: current }),
      }),
    );
    await page.goto("/");
    await expect(page.getByTestId("nav-dashboard")).toBeVisible();
    await expect(page.getByTestId("update-bar")).toHaveCount(0);
    await page.context().close();
  });
});
