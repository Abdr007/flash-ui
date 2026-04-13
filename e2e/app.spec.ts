import { test, expect } from "@playwright/test";

test.describe("Flash UI — Core Flows", () => {
  test("homepage loads with portfolio hero", async ({ page }) => {
    await page.goto("/");
    // Should see the app shell
    await expect(page.locator("body")).toBeVisible();
    // Should see the chat input area
    await expect(page.locator("textarea")).toBeVisible({ timeout: 10000 });
  });

  test("landing page loads", async ({ page }) => {
    await page.goto("/landing");
    await expect(page).toHaveTitle(/Flash Terminal/);
  });

  test("health endpoint returns 200", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.certification).toBeDefined();
    expect(body.execution_enabled).toBeDefined();
  });

  test("earn pools endpoint returns data", async ({ request }) => {
    const response = await request.get("/api/earn");
    expect(response.ok()).toBeTruthy();
  });

  test("chat input accepts text", async ({ page }) => {
    await page.goto("/");
    const textarea = page.locator("textarea");
    await textarea.waitFor({ timeout: 10000 });
    await textarea.fill("price SOL");
    await expect(textarea).toHaveValue("price SOL");
  });
});
