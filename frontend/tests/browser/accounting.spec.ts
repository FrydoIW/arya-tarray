import { expect, test } from "@playwright/test";

test("Accounting workspace distinguishes preview and review, renders reports and downloads", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const actor = { id: "00000000-0000-4000-8000-000000000001", fullName: "Accounting Browser Actor",
    email: "accounting@example.invalid", roleCode: "TEST", menuCodes: ["ACCOUNTING_REPORT"] };
  await page.route("**/api/auth/login", r => r.fulfill({ json: { token: "synthetic-browser-token", user: actor } }));
  await page.route("**/api/auth/me", r => r.fulfill({ json: actor }));
  await page.route("**/api/accounting/options?*", r => r.fulfill({ json: { banks: [], events: [], campaigns: [], members: [] } }));
  await page.route("**/api/accounting/reports?*", r => {
    const view = new URL(r.request().url()).searchParams.get("view");
    return r.fulfill({ json: { view, cutoverDate: "2026-11-01", coverage: "Phase 1 journals only; no backfill or opening balance",
      preview: view === "pending", additions: [], additionsLimit: 100, page: 1, pageSize: 25, total: 1,
      totalDebit: "100.00", totalCredit: "100.00", movementBalance: "0.00", balanced: true,
      rows: view === "pending" || view === "reconciliation"
        ? [{ id: "synthetic", date: "2026-11-01", amount: "100.00", state: "ACCOUNTING_REVIEW_REQUIRED" }]
        : [{ id: "synthetic", date: "2026-11-01", account: "1110 Bank", debit: "100.00", credit: "100.00" }] } });
  });
  await page.route("**/api/accounting/export?*", r => r.fulfill({ headers: {
    "Content-Disposition": 'attachment; filename="accounting.xlsx"', "Access-Control-Expose-Headers": "Content-Disposition"
  }, body: "synthetic export" }));
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill(actor.email);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/accounting$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Accounting", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pending Preview", exact: true }).click();
  await expect(page.getByText(/PREVIEW — NOT POSTED/)).toBeVisible();
  await expect(page.getByText("ACCOUNTING REVIEW REQUIRED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Trial Balance", exact: true }).click();
  await expect(page.getByText(/Debit = Credit/)).toBeVisible();
  for (const name of ["General Ledger", "Monthly Summary", "Reconciliation", "Journals"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("table")).toBeVisible();
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("accounting.xlsx");
  expect(errors).toEqual([]);
});
