import type { Page } from "@playwright/test";
import type { AccountingAccount, AccountingFiscalYear } from "../../../src/features/accounting/types";

// Synthetic browser-only responses. Every API request is intercepted; no database is contacted.
export const browserActor = { id: "00000000-0000-4000-8000-000000000031", fullName: "Accounting Workspace Browser Actor", email: "workspace@example.invalid", roleCode: "TEST", menuCodes: ["ACCOUNTING_REPORT"] };
export const fiscalYear: AccountingFiscalYear = {
  id: "00000000-0000-4000-8000-000000002026", yearCode: "FY2026", startDate: "2026-01-01T00:00:00.000Z", endDate: "2026-12-31T00:00:00.000Z", status: "OPEN", revision: 1,
  revFkAccPeriodFy: [10, 11, 12].map(month => ({ id: `00000000-0000-4000-8000-0000000020${month}`, fiscalYearId: "00000000-0000-4000-8000-000000002026", periodNo: month, periodCode: `2026-${month}`, startDate: `2026-${month}-01T00:00:00.000Z`, endDate: `2026-${month}-${month === 11 ? 30 : 31}T00:00:00.000Z`, status: "OPEN", revision: 1, closedAt: null }))
};
export const accounts: AccountingAccount[] = [
  { id: "bank", code: "1110", name: "Catalog bank label", accountType: "ASSET", normalBalance: "DEBIT" },
  { id: "income", code: "4110", name: "Catalog income label", accountType: "REVENUE", normalBalance: "CREDIT" },
  { id: "expense", code: "5100", name: "Catalog program expense", accountType: "EXPENSE", normalBalance: "DEBIT" }
].map(item => ({ ...item, accountType: item.accountType as AccountingAccount["accountType"], normalBalance: item.normalBalance as AccountingAccount["normalBalance"], parentAccountId: null, accountClassification: null, reportSection: null, contraFlag: false, postingFlag: true, activeFlag: true, createdAt: "2026-01-01", updatedAt: "2026-01-01", _count: { lines: 0 } }));
export function reportPayload(view: string, label = "JRN-BROWSER-31") {
  return { view, cutoverDate: "2026-10-01", coverage: "Synthetic browser report evidence only", preview: view === "pending", additions: [], additionsLimit: 100, page: 1, pageSize: 25, total: 1,
    totalDebit: "100.00", totalCredit: "100.00", movementBalance: "0.00", balanced: true,
    rows: ["pending", "reconciliation"].includes(view) ? [{ id: "preview", date: "2026-11-03", amount: "100.00", state: "ACCOUNTING_REVIEW_REQUIRED" }]
      : [{ id: "journal", journalId: "journal", journal: label, date: "2026-11-03", debit: "100.00", credit: "100.00", source: "Synthetic browser source evidence" }] };
}
export async function setupAccountingBrowser(page: Page, menuCodes: string[] = ["ACCOUNTING_REPORT"]) {
  const actor = { ...browserActor, menuCodes }, calls: { path: string; query: string; method: string }[] = [], errors: string[] = [], unhandled: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.clock.setFixedTime(new Date("2026-11-09T06:00:00.000Z"));
  await page.addInitScript(() => { window.sessionStorage.setItem("arya_token", "synthetic-stage31-browser-token"); });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method(); calls.push({ path, query: url.search, method });
    if (method !== "GET") { unhandled.push(`${method} ${path}`); return route.fulfill({ status: 405, json: { message: "Browser fixture never permits writes" } }); }
    if (path === "/api/auth/me") return route.fulfill({ json: actor });
    if (path === "/api/accounting/periods/fiscal-years") return route.fulfill({ json: [fiscalYear] });
    if (path === "/api/accounting/coa") { const search = url.searchParams.get("search") ?? "", rows = accounts.filter(a => a.code.includes(search)), pageSize = Number(url.searchParams.get("pageSize") ?? 100); return route.fulfill({ json: { rows: rows.slice(0, pageSize), total: rows.length, page: 1, pageSize } }); }
    if (path === "/api/accounting/approvals") return route.fulfill({ json: { rows: [{ id: "approval", requestKind: "MANUAL_JOURNAL", sourceDocumentId: "draft", status: "PENDING", requestedById: actor.id, requestedAt: "2026-11-09" }], total: 11, page: 1, pageSize: 1, status: "PENDING" } });
    if (path === "/api/accounting/options") return route.fulfill({ json: { banks: [], events: [], campaigns: [], members: [] } });
    if (path === "/api/accounting/reports") return route.fulfill({ json: reportPayload(url.searchParams.get("view") ?? "journals") });
    if (path === "/api/accounting/journals/journal") return route.fulfill({ json: { id: "journal", journalNumber: "JRN-BROWSER-31", journalType: "RECOGNITION", accountingDate: "2026-11-03", postedAt: "2026-11-03T06:00:00.000Z", sourceEventKey: "synthetic-browser-evidence", state: "ACCOUNTING_REVIEW_REQUIRED", relatedJournalId: null, descriptionSnapshot: "Synthetic journal detail", correctionItem: null, linkedJournals: [], bankTransaction: null, lines: [{ id: "line", account: "1110 Catalog bank label", debit: "100.00", credit: "0.00" }] } });
    if (path === "/api/accounting/export") { const format = url.searchParams.get("format") ?? "pdf"; return route.fulfill({ headers: { "Content-Disposition": `attachment; filename="accounting.${format}"`, "Access-Control-Expose-Headers": "Content-Disposition" }, body: `Synthetic browser ${format} export fixture` }); }
    unhandled.push(`${method} ${path}`); return route.fulfill({ status: 503, json: { message: "Unconfigured browser fixture" } });
  });
  return { calls, errors, unhandled };
}
