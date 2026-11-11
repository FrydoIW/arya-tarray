# Accounting Stage 3.1 — Workspace & Foundation

Implementation and verification date: 2026-11-09 (Asia/Jakarta).

Verdict: **COMPLETE for Stage 3.1**. Stage 2 accounting policy readiness and
official financial reporting remain **PARTIAL / NOT_READY**. This frontend
milestone does not approve policies, certify balances or activate later workspaces.

## A. Implementation

- `/accounting`: read-only Overview with fiscal-year/period selection, COA catalog
  total, permission-dependent actor-scoped pending approvals and report links.
- `/accounting/reports`: reused `AccountingScreen`, retaining Pending Preview,
  Reconciliation, Journals, General Ledger, Trial Balance, Monthly Summary,
  filters, pagination, journal detail and PDF/XLSX export.
- Nine module groups are visible. Overview and existing Financial Reports have
  working links. The seven future transaction workspaces are noninteractive
  COMING SOON cards; Stage 3.2–3.8 was not implemented.
- `AccountingFoundation` supplies workspace links, semantic status presentation
  and loading/error/forbidden/retry states using existing shared UI.
- `useAccountingRead` uses the existing workspace cache, subscriber release and
  cache-owned AbortController. Cache keys are user-scoped. Refresh invalidates
  the relevant cached read; inactive subscribers ignore late responses.
- Existing report/options reads and journal detail requests cancel on cleanup;
  stale responses cannot overwrite the latest report selection.
- Report selection is persisted per user and reflected in the report URL.
  Explicit route filters support Overview deep links; refresh and workspace-tab
  navigation retain the report context.

Changed existing frontend files:

- `frontend/src/app/(internal)/accounting/page.tsx`
- `frontend/src/components/layout/useWorkspaceTabs.ts`
- `frontend/src/config/navigation.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/features/accounting/types.ts`
- `frontend/src/features/accounting/api/accounting.api.ts`
- `frontend/src/features/accounting/hooks/useAccounting.ts`
- `frontend/src/features/accounting/components/AccountingScreen.tsx`
- `frontend/src/features/accounting/components/AccountingScreen.module.css`
- `frontend/tests/browser/accounting.spec.ts`

New frontend files:

- `frontend/src/app/(internal)/accounting/reports/page.tsx`
- `frontend/src/features/accounting/components/AccountingOverview.tsx`
- `frontend/src/features/accounting/components/AccountingFoundation.tsx`
- `frontend/src/features/accounting/components/AccountingWorkspace.module.css`
- `frontend/src/features/accounting/hooks/useAccountingRead.ts`
- `frontend/tests/browser/accounting-workspace.spec.ts`
- `frontend/tests/browser/helpers/accounting-workspace.ts`

This document is the only additional repository documentation for this task.

## B. Design integration

The existing AppShell, Sidebar, Topbar and WorkspaceTabs remain the application
shell. Accounting reuses PageHeader, Card, Button, Select, EmptyState, StatusBadge,
and the existing report table/Modal. Styles use CSS modules and the current
project CSS variables, typography and spacing; there is no global theme change.

The single Sidebar Accounting entry retains `ACCOUNTING_REPORT`. A virtual
workspace subpage gives Reports its own title/tab using the same existing grant.
Longest-path matching distinguishes `/accounting/reports` from `/accounting`
without a new menu registry entry or permission.

Overview grids adapt from three columns to two and one. Report grid children
can shrink; wide tables scroll inside their container. Desktop expanded and
collapsed Sidebar, tablet and mobile navigation were exercised. Keyboard link
activation and mobile menu Escape handling were also verified.

## C. API contracts and permissions

All requests use existing `apiFetch` or `apiFetchBlob`; configured API base and
authentication remain unchanged. Paths below are relative to the existing API
base (normally `/api`). All Accounting requests in this workspace are GET reads.

| Endpoint | Actual contract/use | Permission |
| --- | --- | --- |
| `/accounting/coa?page=1&pageSize=1` | Paginated `{ rows, total, page, pageSize }`; display backend `total`, including inactive/header accounts | `ACCOUNTING_REPORT` |
| `/accounting/coa?page=1&pageSize=100&search=1110` and `search=4110` | Exact matching returned accounts supply legacy report option labels/existence | `ACCOUNTING_REPORT` |
| `/accounting/periods/fiscal-years` | Array of fiscal years with nested `revFkAccPeriodFy` periods; backend caps 100 years/53 periods per year | `ACCOUNTING_REPORT` |
| `/accounting/approvals?status=PENDING&page=1&pageSize=1` | Paginated actor-involved requests; backend `total` counts requested-by or assigned-to the current actor, not a global queue | Any of `ACCOUNTING_MANAGE`, `ACCOUNTING_APPROVE`, `ACCOUNTING_POST`, `ACCOUNTING_AP_MANAGE`, `ACCOUNTING_AR_MANAGE`, plus workspace report access |
| `/accounting/reports?...` | Existing donation Accounting report contract and filter semantics | `ACCOUNTING_REPORT` |
| `/accounting/options?memberSearch=...` | Existing report filter options | `ACCOUNTING_REPORT` |
| `/accounting/journals/:id` | Existing journal detail, including nullable non-bank references | `ACCOUNTING_REPORT` |
| `/accounting/export?...&format=pdf` or `xlsx` | Existing authenticated binary export and Content-Disposition filename | `ACCOUNTING_REPORT` |

The Overview does not automatically load `/financial-integrity`, full GL,
Trial Balance or another heavy report. Fiscal context defaults only when an
actual returned date range contains the current Asia/Jakarta business day.
No matching year/period produces a selection/empty state, not an invented OPEN
period. Selecting a period passes its dates to the existing report links.

`ApiError extends Error` preserves HTTP status for explicit 403 handling. Existing
401 session clearing/login redirection is unchanged. Failed reads display errors
and retry controls; they do not replace missing totals with zero. Report-only
users see an additional-access state instead of sending an unauthorized approval
request. Backend authorization remains final; no permissions are granted here.

### Legacy COA compatibility

The existing backend donation report schema accepts only account codes `1110`
and `4110`. The adapter retains that compatibility allowlist, obtains labels and
existence from the COA API and excludes unsupported accounts. JSX no longer
contains invented/hardcoded account labels. The Overview catalog count covers
the returned catalog, but does not establish COA completeness.

Full Stage 2 GL endpoints and COA CRUD are not substituted into the legacy report.
Expanding the ledger UI and its account scope belongs to the later workspace.

### Readiness presentation

No suitable lightweight aggregate readiness endpoint is available. Overview
therefore shows neutral `NOT_EVALUATED` and explains the conditions for official
use. An OPEN fiscal period is a lifecycle value, not verified financial readiness.
Status presentation supports PENDING_POLICY, REVIEW_REQUIRED, UNVERIFIED,
NOT_READY, VERIFIED, APPROVED and POSTED; positive lifecycle statuses are shown
only when supplied as such, never inferred from a report being readable.

## D. Validation

| Check | Result |
| --- | --- |
| Frontend `npx tsc --noEmit` | PASS, including a final standalone run after build |
| Frontend `npm run build` | PASS, Next.js 15.5.23 production compilation and type checking |
| Existing plus new browser suite, development server | 17/17 PASS |
| Same browser suite against production build | 17/17 PASS |
| Existing backend unit/regression suite | 500/500 PASS |
| ESLint | UNAVAILABLE: existing `next lint` command prompts for first-time ESLint configuration; no lint setup or dependencies were added |
| Visual inspection | Desktop, tablet, mobile, collapsed Sidebar, report table scrolling and existing Dashboard inspected from actual Chromium screenshots |

Browser coverage includes Overview contracts, actor-scoped approval totals,
permission denial before data reads, missing fiscal/COA data, 403/503/retry,
period deep links, dynamic compatible COA labels, filter/tab/reload persistence,
all six existing report views, nullable non-bank journal detail, PDF/XLSX download
transport, stale-response handling, responsive layouts and keyboard navigation.
Existing login/Campaign smoke tests pass. Dashboard renders synthetic backend
data; Monitoring, Reconciliation, Member, Approval and Configuration routes retain
workspace identity/permission behavior and handle API unavailability.

Browser fixtures intercept API traffic and use synthetic values only. These
checks establish frontend contract/rendering/export transport behavior; they are
not a live database or official financial-export-content certification. No DEV,
TEST or PROD database integration tests were run for this frontend-only change.

Evidence is stored outside the repository under
`D:/arya-tarray-change-records/AT-ST31-20261108-01-execution/`:
`next-build.log`, `browser-final.log`, `browser-production.log`,
`backend-unit-regression.log`, `lint.log`, browser screenshots and hash snapshots.
The evidence directory identifier was created before the session date advanced
to 2026-11-09; it is not a new database operational approval record.

## E. Risks and remaining scope

- COA policy/completeness and reporting mapping remain pending; no COA was seeded
  or changed. Catalog size is not a financial control certification.
- Opening balance evidence and annual closing operational policy/readiness remain
  unresolved. Official reports must not be treated as approved for publication.
- MySQL 8.0.42 versus the 8.4 deployment target was not reverified by this frontend
  work. This task makes no additional database compatibility claim.
- The fiscal endpoint is bounded rather than paginated; a future large catalog
  of fiscal years may need a backend pagination proposal.
- Additional transaction workspace permissions must be designed with the existing
  backend grants when those stages are implemented; report access is not manage,
  approve, post, close or COA-edit authority.
- Browser regression checks cover navigation, key report interactions and error
  handling, not every existing module's business workflow.
- Production browser testing emitted the existing Next standalone-output warning
  when serving via `next start`; deployment packaging was not changed.

## F. Final verdict and safety boundary

**Stage 3.1 COMPLETE**: API-backed workspace, preserved legacy reports, native
design/navigation, permission-aware states and reusable read-only foundations
are implemented and tested. Stage 2 policy/official reporting remains PARTIAL.

No backend source, Prisma schema, physical database, environment file,
`.gitignore`, `AGENTS.md`, authentication architecture or Accounting policy was
changed. No migration, seed, production access, git add, commit or push was
performed. Pre-existing uncommitted Stage 1/2 work was preserved.
