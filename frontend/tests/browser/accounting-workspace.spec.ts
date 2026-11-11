import { expect, test } from "@playwright/test";
import { fiscalYear, reportPayload, setupAccountingBrowser } from "./helpers/accounting-workspace";
import type { DashboardSummary } from "../../src/features/dashboard/types";

test.setTimeout(90_000);
test("Stage31 overview uses lightweight backend counts/context, never invents readiness or global approval counts", async ({ page }) => {
  const fixture = await setupAccountingBrowser(page); await page.goto("/accounting");
  await expect(page.getByRole("heading", { name: "Accounting", exact: true })).toBeVisible();
  await expect(page.getByText("Full Accrual Accounting & Financial Management.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Select fiscal year")).toHaveValue(fiscalYear.id);
  await expect(page.getByLabel("Select accounting period")).toHaveValue(fiscalYear.revFkAccPeriodFy[1].id);
  const catalog = page.getByRole("heading", { name: "Chart of Accounts", exact: true }).locator(".."); await expect(catalog.locator("strong")).toHaveText("3");
  await expect(page.getByText("Additional Accounting access required", { exact: true })).toBeVisible();
  await expect(page.getByText("NOT_EVALUATED", { exact: true })).toBeVisible(); await expect(page.getByText("VERIFIED", { exact: true })).toHaveCount(0);
  await expect(page.getByText("COMING SOON", { exact: true })).toHaveCount(0);
  expect(fixture.calls.some(c => /approvals|reports|financial-integrity|financial-statements/.test(c.path))).toBe(false);
  expect(fixture.errors).toEqual([]); expect(fixture.unhandled).toEqual([]);
});
test("Stage31 approver summary shows the backend total for requests involving the actor, not page row count", async ({ page }) => {
  const f = await setupAccountingBrowser(page, ["ACCOUNTING_REPORT", "ACCOUNTING_JOURNAL_APPROVE"]); await page.goto("/accounting");
  const summary = page.getByRole("heading", { name: "Your pending approvals" }).locator(".."); await expect(summary.locator("strong")).toHaveText("11");
  await expect(summary).toContainText("not the global queue"); expect(f.calls.filter(c => c.path.endsWith("/approvals")).every(c => c.query.includes("status=PENDING"))).toBe(true);
  expect(f.calls.every(c => c.method === "GET")).toBe(true); expect(f.errors).toEqual([]);
});
test("Stage31 empty fiscal configuration and empty COA are explicit, without fictional active periods", async ({ page }) => {
  await setupAccountingBrowser(page); await page.route("**/api/accounting/periods/fiscal-years", r => r.fulfill({ json: [] }));
  await page.route("**/api/accounting/coa?*", r => r.fulfill({ json: { rows: [], total: 0, page: 1, pageSize: 1 } })); await page.goto("/accounting");
  await expect(page.getByText("No fiscal year available", { exact: true })).toBeVisible(); await expect(page.getByLabel("Select accounting period")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Chart of Accounts", exact: true }).locator("..").locator("strong")).toHaveText("0");
  await expect(page.getByText("NOT_EVALUATED", { exact: true })).toBeVisible();
});
test("Stage31 API failure retries and 403 remains a permission state without replacing failed data with zero", async ({ page }) => {
  await setupAccountingBrowser(page); let count = 0;
  await page.route("**/api/accounting/coa?*", r => ++count === 1 ? r.fulfill({ status: 503, json: { message: "Catalog temporarily unavailable" } }) : r.fulfill({ json: { rows: [], total: 4, page: 1, pageSize: 1 } }));
  await page.goto("/accounting"); const catalog = page.getByRole("heading", { name: "Chart of Accounts", exact: true }).locator("..");
  await expect(catalog.getByRole("alert")).toContainText("Catalog temporarily unavailable"); await expect(catalog.locator("strong")).toHaveCount(0);
  await catalog.getByRole("button", { name: "Retry", exact: true }).click(); await expect(catalog.locator("strong")).toHaveText("4");
  await page.route("**/api/accounting/coa?*", r => r.fulfill({ status: 403, json: { message: "Menu access denied" } }));
  await page.getByRole("button", { name: "Refresh", exact: true }).click(); await expect(catalog.getByRole("alert")).toContainText("Additional access required"); await expect(catalog.locator("strong").filter({ hasText: /^4$/ })).toHaveCount(0);
  await expect(page.getByLabel("Select fiscal year")).toHaveValue(fiscalYear.id);
});
test("Stage31 fiscal selection drives actual report dates, separate tabs restore, filters survive refresh and navigation", async ({ page }) => {
  const f = await setupAccountingBrowser(page); await page.goto("/accounting");
  await page.getByLabel("Select accounting period").selectOption(fiscalYear.revFkAccPeriodFy[2].id);
  await expect(page.getByRole("link", { name: "General Ledger", exact: true }).last()).toHaveAttribute("href", /from=2026-12-01.*to=2026-12-31/);
  await page.goto("/accounting/reports?view=ledger&from=2026-12-01&to=2026-12-31"); await expect(page.getByRole("heading", { name: "Accounting Reports", exact: true })).toBeVisible();
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-12-01"); await expect(page.getByLabel("To", { exact: true })).toHaveValue("2026-12-31");
  await expect(page.getByRole("combobox", { name: "Account", exact: true }).locator('option[value="1110"]')).toHaveText("1110 Catalog bank label");
  await expect(page.getByRole("combobox", { name: "Account", exact: true }).locator('option[value="5100"]')).toHaveCount(0);
  await page.getByRole("combobox", { name: "Account", exact: true }).selectOption("1110"); await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Account", exact: true })).toHaveValue("1110");
  await page.getByRole("tab", { name: "Accounting", exact: true }).click(); await expect(page.getByRole("heading", { name: "Accounting", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Accounting Reports", exact: true }).click(); await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-12-01");
  await page.reload(); await expect(page.getByRole("combobox", { name: "Account", exact: true })).toHaveValue("1110");
  await expect(page.getByRole("tab", { name: "Accounting Reports", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#app-sidebar").getByRole("link", { name: "Accounting", exact: true })).toHaveAttribute("aria-current", "page"); expect(f.errors).toEqual([]);
});
test("Stage31 existing report views, nullable non-bank journal detail and both exports remain usable", async ({ page }) => {
  const f = await setupAccountingBrowser(page); await page.goto("/accounting/reports");
  await page.getByRole("button", { name: "JRN-BROWSER-31", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("Source: non-bank journal");
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const name of ["Pending Preview", "Reconciliation", "Journals", "General Ledger", "Trial Balance", "Monthly Summary"]) {
    await page.getByRole("button", { name, exact: true }).click(); await expect(page.getByRole("table")).toBeVisible();
    if (name === "Pending Preview") await expect(page.getByText(/PREVIEW — NOT POSTED/)).toBeVisible();
  }
  for (const [button, extension] of [["Excel", "xlsx"], ["PDF", "pdf"]]) {
    const wait = page.waitForEvent("download"); await page.getByRole("button", { name: button, exact: true }).click(); expect((await wait).suggestedFilename()).toBe(`accounting.${extension}`);
  }
  expect(f.errors).toEqual([]); expect(f.unhandled).toEqual([]);
});
test("Stage31 late report responses never overwrite newer filters", async ({ page }) => {
  const f = await setupAccountingBrowser(page);
  await page.route("**/api/accounting/reports?*", async r => { const q = new URL(r.request().url()).searchParams, old = q.get("from") === "2026-11-01"; if (old) await new Promise(resolve => setTimeout(resolve, 700)); await r.fulfill({ json: reportPayload(q.get("view") ?? "journals", old ? "OLD-RESPONSE" : "NEW-RESPONSE") }).catch(() => undefined); });
  await page.goto("/accounting/reports?from=2026-11-01"); await page.getByLabel("From", { exact: true }).fill("2026-11-05");
  await expect(page.getByRole("button", { name: "NEW-RESPONSE", exact: true })).toBeVisible();
  await page.waitForTimeout(900); await expect(page.getByRole("button", { name: "OLD-RESPONSE", exact: true })).toHaveCount(0); expect(f.errors).toEqual([]);
});
test("Stage31 current report permission gates overview/reports and other existing groups remain protected", async ({ page }) => {
  const f = await setupAccountingBrowser(page);
  for (const path of ["/dashboard", "/monitoring/time-based", "/reconciliation/statement-upload", "/member/data", "/approval/sign-approval", "/configuration/role"]) {
    await page.goto(path); await expect(page.getByRole("heading", { name: "Access denied", exact: true })).toBeVisible();
  }
  expect(f.calls.every(c => c.path === "/api/auth/me")).toBe(true); expect(f.errors).toEqual([]);
});
test("Stage31 missing Accounting grant denies both direct Accounting routes before loading data", async ({ page }) => {
  const f = await setupAccountingBrowser(page, ["MONITORING_CAMPAIGN"]);
  for (const path of ["/accounting", "/accounting/reports?view=ledger"]) { await page.goto(path); await expect(page.getByRole("heading", { name: "Access denied", exact: true })).toBeVisible(); }
  expect(f.calls.some(c => c.path.startsWith("/api/accounting"))).toBe(false); expect(f.errors).toEqual([]);
});
for (const [name, width, height] of [["desktop", 1440, 1000], ["tablet", 820, 1180], ["mobile", 390, 844]] as const) {
  test(`Stage31 ${name} layout, existing shell and report table scrolling`, async ({ page }, info) => {
    await page.setViewportSize({ width, height }); const f = await setupAccountingBrowser(page); await page.goto("/accounting");
    await expect(page.getByText("NOT_EVALUATED", { exact: true })).toBeVisible(); await expect(page.getByLabel("Select accounting period")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`accounting-${name}.png`), fullPage: true, animations: "disabled" });
    if (name === "desktop") { await page.getByRole("button", { name: "Perkecil sidebar", exact: true }).click(); await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/); await page.screenshot({ path: info.outputPath("accounting-collapsed.png"), fullPage: true, animations: "disabled" }); }
    else { await page.getByRole("button", { name: "Open navigation", exact: true }).click(); await expect(page.locator("#app-sidebar")).toBeVisible(); await page.keyboard.press("Escape"); }
    await page.getByRole("link", { name: "Open existing Accounting Reports", exact: true }).click(); await expect(page.getByRole("table")).toBeVisible();
    await page.screenshot({ path: info.outputPath(`accounting-reports-${name}.png`), fullPage: true, animations: "disabled" });
    expect(await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }))).toMatchObject({ width });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true); expect(f.errors).toEqual([]);
  });
}
test("Stage31 existing dashboard retains its shell and renders synthetic read-only backend data", async ({ page }, info) => {
  const f = await setupAccountingBrowser(page, ["MONITORING_DASHBOARD", "ACCOUNTING_REPORT"]);
  const data: DashboardSummary = { viewer: { id: "browser", fullName: "Browser dashboard reference", email: "reference@example.invalid" },
    filters: { periodMode: "MONTH", month: "2026-11", date: "2026-11-09", monthLabel: "November 2026", periodLabel: "November 2026", comparisonLabel: "vs previous month" },
    metrics: { totalStatements: { value: 0, changePercent: null }, totalTransactions: { value: 0, changePercent: null }, totalIncoming: { value: "0.00", changePercent: null }, totalOutgoing: { value: "0.00", changePercent: null }, completeTransactions: { value: 0, changePercent: null } },
    trend: [], transactionStatus: { draft: 0, needsReview: 0, pendingApproval: 0, complete: 0, total: 0 }, statementStatus: { draft: 0, pendingApproval: 0, complete: 0, total: 0 }, eventGroups: [],
    memberSummary: { linkedAmount: "0.00", contributingMemberCount: 0, linkedTransactionCount: 0, linkedIdentityCount: 0, unlinkedTransactionCount: 0, unlinkedIdentityCount: 0, unlinkedObservedAmount: "0.00", unverifiedIdentityCount: 0 }, topMembers: [], memberEventGroups: [], registrationFollowUp: { unverifiedIdentityCount: 0, identities: [] }, recentActivities: [], lastUpdatedAt: "2026-11-09T06:00:00.000Z" };
  await page.route("**/api/monitoring/dashboard/workspace?*", r => r.fulfill({ json: data })); await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "At a glance", exact: true })).toBeVisible(); await expect(page.locator(".dashboard-metrics")).toContainText("Total Incoming");
  await expect(page.getByRole("tab", { name: "Dashboard", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: info.outputPath("existing-dashboard-reference.png"), fullPage: true, animations: "disabled" }); expect(f.errors).toEqual([]);
});
test("Stage31 existing authorized routes keep correct workspace identity and handle an unavailable API", async ({ page }) => {
  const f = await setupAccountingBrowser(page, ["RECON_STATEMENT_UPLOAD", "RECON_EDIT_INCOME", "RECON_TRANSACTION_INQUIRY", "MEMBER_DATA", "APPROVAL_SIGN", "CONFIG_ROLE", "MONITORING_TIME_BASED", "ACCOUNTING_REPORT"]);
  for (const [path, label] of [["/reconciliation/statement-upload", "Statement Upload"], ["/reconciliation/edit-income", "Edit Income"], ["/reconciliation/transaction-inquiry", "Transaction Inquiry"], ["/member/data", "Data Donatur"], ["/approval/sign-approval", "Sign Approval"], ["/configuration/role", "Role"], ["/monitoring/time-based", "Time Based Monitoring"]]) {
    await page.goto(path); await expect(page.getByRole("tab", { name: label, exact: true })).toHaveAttribute("aria-selected", "true"); await expect(page.getByRole("heading", { name: "Access denied", exact: true })).toHaveCount(0);
    await expect(page.locator(".page-stage")).toContainText(/Unconfigured browser fixture|No |Belum|Loading|memuat|kosong|Role|Donatur|Approval|Statement/);
  }
  expect(f.calls.every(c => c.method === "GET")).toBe(true); expect(f.errors).toEqual([]);
});
