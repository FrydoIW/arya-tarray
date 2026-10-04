import { expect, test } from "@playwright/test";

const testUser = {
  id: "00000000-0000-4000-8000-000000000001",
  fullName: "Browser Smoke User",
  email: "smoke@example.invalid",
  roleCode: "SMOKE",
  menuCodes: ["MONITORING_CAMPAIGN"]
};

test("login entry renders its accessible form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
});

test("mock login opens a read-only Campaign workspace without a runtime error", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/api/auth/login", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ token: "browser-smoke-token", user: testUser }) }));
  await page.route("**/api/auth/me", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify(testUser) }));
  await page.route("**/api/monitoring/campaign/workspace", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({
      summary: { activeCampaigns: 1, scheduledCampaigns: 0, totalTargetApplied: "50.00", totalRemaining: "50.00", outstandingCampaignCarry: "0.00" },
      campaigns: [{ campaignId: "smoke-campaign", campaignName: "Campaign Smoke", eventCode: { code: "901", eventName: "Smoke Event" },
        startDate: null, endDate: null, targetAmount: "100.00", directContribution: "50.00", carryAllocation: "0.00",
        targetApplied: "50.00", remainingAmount: "50.00", campaignCarry: "0.00", progressPercent: 50,
        targetReached: false, displayStatus: "ACTIVE" }], generatedAt: "2026-09-01T00:00:00.000Z"
    }) }));

  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill("smoke@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/monitoring\/campaign$/);
  await expect(page.getByRole("heading", { name: "Campaign Monitoring" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Campaign Smoke" })).toBeVisible();
  await expect(page.getByText("Direct Contribution", { exact: true })).toBeVisible();
  await expect(page.locator(".ui-alert-error")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
