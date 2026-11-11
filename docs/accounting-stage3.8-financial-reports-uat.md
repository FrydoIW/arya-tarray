# Accounting Stage 3.8 — Financial Statements & Final Frontend UAT

Verification date: **2026-11-12 (Asia/Jakarta)**.

Stage 3.8 completes the planned frontend sequence. This document records the
financial-reporting implementation, the final Stage 3 frontend regression, the
consolidated gap register and the separate readiness verdicts. The financial
statement UI is complete for the actual Stage 2.6 contract, but **official
financial reporting remains NOT_READY** because accounting policy, mappings,
opening evidence and professional review are still pending, and live
authenticated database E2E was not executed.

## A. Implementation

### Route and navigation

- New route: `/accounting/financial-reports?statement=position|income|net-assets|cash-flows|supporting-schedules`.
  `position` is the default. `statement` is whitelisted server-side; invalid
  values fall back only to the default view, never to another accounting period.
- The report scope (`fiscalYearId`, `from`, `to`, comparative dates) is carried
  in the URL for tab navigation and restored by the route. Scope state is also
  kept in the existing user-scoped Stage 3.1 workspace cache. There is no silent
  period fallback: dates must be complete, ordered and inside the selected
  fiscal year before a request is sent.
- Integrated into the existing Accounting workspace navigation, Accounting
  Overview module cards and `WorkspaceTabs`. The existing single Sidebar
  `ACCOUNTING_REPORT` grant, AppShell and permission gating are unchanged. No
  new menu permission or database grant was added.
- `/accounting/reports` and all of its legacy donation-report views remain in
  place. The new workspace is a separate statement view and does not replace
  the historic report interface.

### New frontend files

- `frontend/src/app/(internal)/accounting/financial-reports/page.tsx`
- `frontend/src/features/accounting/reporting/api.ts`
- `frontend/src/features/accounting/reporting/FinancialReportsWorkspace.tsx`
- `frontend/src/features/accounting/reporting/FinancialStatementViews.tsx`
- `frontend/src/features/accounting/reporting/SupportingSchedulesView.tsx`
- `frontend/src/features/accounting/reporting/reporting.module.css`
- `frontend/src/features/accounting/reporting/types.ts`
- `frontend/tests/browser/accounting-financial-reports.spec.ts`
- `frontend/tests/browser/helpers/accounting-financial-reports.ts`
- This document.

### Existing files changed for integration

- `frontend/src/config/navigation.ts` — virtual workspace page title for the new
  route, sharing `ACCOUNTING_REPORT`.
- `frontend/src/features/accounting/components/AccountingFoundation.tsx` —
  workspace navigation link.
- `frontend/src/features/accounting/components/AccountingOverview.tsx` —
  Financial Statements module card; the existing donation report card was
  relabelled Donation Reports without changing its route or behaviour.

### API/client/hook use

All reads use the existing `apiFetch`, `apiFetchBlob`, user-scoped workspace
cache, subscriber release and AbortController infrastructure (`useCoreRead` /
`useAccountingRead`). There is no financial calculation engine in the browser.

| Method and path | Use |
| --- | --- |
| `GET /api/accounting/financial-statements` | Combined posted-GL statement bundle for the four principal statements and comparative report |
| `GET /api/accounting/financial-statements/supporting-schedules` | Adopted policy, account mappings, subledger controls, full report status and narrative-review state |
| `GET /api/accounting/financial-statements/export?format=csv\|xlsx` | Actual backend DRAFT export. No other export format is offered |
| `GET /api/accounting/periods/fiscal-years` | Existing fiscal-year/period selector |
| Existing GL/TB/journal/fund/AP/AR/asset URLs | Drill-down only; no duplicated ledger or transaction pages |

The individual `/financial-statements/position`, `/comprehensive-income`,
`/net-assets`, `/cash-flows` and `/trial-balance` endpoints exist. The UI uses
the combined `/financial-statements` endpoint once per scope so all statement
tabs share one heavy read and retain trial-balance account code/name/mapping
evidence without a second report calculation. The existing Trial Balance page
is still the place for detailed TB review.

## B. Financial Reports

### Statement of Financial Position

- Backend sections: current assets, non-current assets, total assets, current
  liabilities, non-current liabilities, total liabilities, permanent net
  assets, undistributed surplus/deficit and total net assets.
- Displays the backend equation difference and balanced flag. The UI adds no
  adjustment and does not force assets to equal liabilities plus net assets.
- Unmapped statement sections and unmapped active posting accounts remain
  visible. They are never silently excluded from backend totals.
- Current and comparative columns are shown only when the backend returns a
  comparative report. Missing comparative data is stated, not replaced with
  zero.
- Net-asset restriction classes are displayed separately.

### Statement of Comprehensive Income

- Displays backend contribution income, other income, program, fundraising,
  administrative, depreciation, other recognised expense and unmapped
  categories, plus recognized income, recognized expenses and surplus/deficit.
- Confirms that closing journals and reversals are excluded by the backend.
- Does not derive income from bank receipts, campaign targets or operational
  wallets. Unmapped functional classes are explicit.

### Statement of Changes in Net Assets

- Displays opening, surplus/deficit, other actual movements, closing and
  rollforward difference by donor-restriction class for the current and, when
  returned, comparative period.
- Distinguishes unrestricted and donor-restricted resources. Warns that donor
  releases are reclassifications, not new total net assets, and that internal
  management designations are a subset of unrestricted resources, not
  liabilities.
- Unmapped classes remain visible.

### Statement of Cash Flows

- Uses only the backend **DIRECT** method. The indirect method is not invented.
- Displays operating, investing and financing activities, net cash movement,
  opening/closing cash and cash equivalents, and the backend classification
  difference.
- Shows journal-level cash-flow source evidence with existing journal
  drill-down. Internal cash movements with no external allocation are labelled.
- Cash-flow classification exceptions are listed. The UI does not count
  depreciation as cash, invent balancing lines, or recalculate cash flow from
  operational bank totals.
- `PENDING_POLICY` / missing DIRECT policy returns “Not supplied” values and the
  real backend exception instead of fabricated numbers.

### Supporting schedules and notes

- Adopted policy summary: framework, cash-flow method, materiality, cutover and
  opening evidence references, AP/AR controls, bank/GL mappings and annual
  closing mappings. A missing policy is shown as `PENDING_POLICY`.
- Account-to-statement mapping table from the backend report trial balance.
  Unmapped active posting accounts are highlighted.
- Compact source-backed AP, AR, fixed-asset, accrual/prepayment and fund control
  evidence with links to their existing workspaces. These are not duplicate
  management UIs and their totals are not re-added to the GL.
- Narrative disclosures remain
  `REQUIRES_PROFESSIONAL_REVIEW_NOT_AUTOMATICALLY_APPROVED`; no fictional
  accounting policy text is generated.

### GL/TB/source drill-down

- Position account rows link to `/accounting/general-ledger` with the exact
  report dates and account ID.
- The workspace links to the existing Trial Balance with the same dates and
  fiscal year.
- Cash-flow sources link to `/accounting/journals?journalId=...`.
- Supporting controls link to the existing reconciliation, payables,
  receivables, fixed-asset reconciliation, accruals and fund workspaces.
- No source ID, journal ID or account ID is fabricated.

### Export

- `Export CSV` and `Export XLSX` call the actual
  `/financial-statements/export` endpoint with the exact report scope.
- The backend filename and `DRAFT` label are preserved. The export is never
  presented as an official financial statement.
- Export is unavailable until the report scope is valid and the report loads.
  The client does not generate PDF/XLSX financial statements locally.

## C. Accounting integrity

- Every displayed statement amount originates from the backend posted General
  Ledger response. Frontend arithmetic is limited to string/BigInt display
  formatting through `accountingMoney`; no GL balance, subtotal or cash-flow
  amount is calculated from paginated rows.
- Exact backend Decimal strings are preserved. Negative values, zero, large
  values and exact cents are formatted without floating-point conversion.
  Missing/null values show “Not supplied”; they are not silently converted to
  zero.
- Date-only strings are sent and displayed without timezone conversion. The
  backend validates the primary scope is inside the selected fiscal year.
- Backend statuses are shown as returned: `DRAFT_VERIFIED`, `UNVERIFIED`,
  `PENDING_POLICY`, `VERIFIED` for cash flows, and so on. The backend `official`
  flag is displayed and is always `false` in the actual contract.
- `DRAFT_VERIFIED` is qualified in the UI as a backend mathematical check, not
  an official statement. A balanced Trial Balance is never promoted to
  `VERIFIED` by frontend inference.
- All backend report exceptions are rendered in a scrollable list, including
  `PENDING_POLICY`, `UNMAPPED_ACCOUNT`, `UNMAPPED_ACTIVE_POSTING_ACCOUNT`,
  `FINANCIAL_POSITION_EQUATION_DIFFERENCE`, `NET_ASSET_ROLLFORWARD_DIFFERENCE`,
  `CASH_FLOW_UNVERIFIED` and comparative exceptions.
- Opening balances remain a policy/evidence concern. The screen displays the
  adopted policy’s opening evidence reference when available and identifies
  missing policy/evidence. It does not create or guess an opening journal.
- Cash flow uses only the backend DIRECT figures and source classification.

## D. Permissions

- The route inherits the existing `ACCOUNTING_REPORT` menu gate and backend
  authorization. No permission was added to roles or menus.
- Report reads and exports require only report access. Viewing statements does
  not grant journal manage, approve, post, close, reopen or configuration
  authority. The new screen contains no mutation controls.
- 401 follows the existing session/login handling. 403 is rendered as an
  “Additional access required” state; failed data is not replaced with zero.
- No donor personal information is requested or displayed. Backend source IDs
  are shown only as traceability references.

## E. Tests

| Check | Result |
| --- | --- |
| Frontend TypeScript (`npx tsc --noEmit --incremental false`) | PASS |
| Next.js production build (`npm run build`) | PASS; `/accounting/financial-reports` compiled as a dynamic route |
| Stage 3.8 targeted browser suite, development server | PASS — 20/20, 0 failed, 0 skipped, 1 worker |
| Stage 3.8 targeted browser suite, production build | PASS — 20/20, 0 failed, 0 skipped, 1 worker |
| Full frontend browser regression, production build | PASS — 178/178, 0 failed, 0 skipped, 1 worker |
| Backend unit/regression suite (read-only) | PASS — 500/500, 0 failed, 0 skipped |
| `git diff --check` | PASS; only pre-existing CRLF conversion warnings |
| ESLint | NOT CONFIGURED — no PASS claimed; no lint dependency or configuration was added |
| Live authenticated DEV API/database E2E | NOT_TESTED — no listener on local port 4000; no backend session was started |
| Responsive inspection | PASS — desktop 1440×1000, tablet 900×1100 and mobile 390×844 screenshots; wide statement tables scroll inside their region; shell, Sidebar and WorkspaceTabs preserved |

Stage 3.8 browser coverage includes position hierarchy/totals/equation,
comprehensive income categories and surplus, net-asset restrictions and
rollforward, DIRECT cash-flow activities/opening/closing/difference and journal
drill-down, PENDING_POLICY/UNVERIFIED qualification, unmapped accounts,
comparative values and unavailable-comparative handling, exact selected period
dates, out-of-year rejection, CSV/XLSX transport and DRAFT filename, supporting
policy/mapping/subledger evidence, report-only access, forbidden/error/retry
states, empty fiscal configuration, navigation integration and all three
responsive widths.

One intermediate full-regression pass hit the pre-existing Stage 3.7
annual-preview selector timeout (waiting for the fiscal-year selector after
switching to annual scope). The isolated rerun passed 1/1 unchanged and the
next complete run passed 178/178. No assertion, fixture or application behavior
was weakened or changed to obtain the final pass.

The full regression includes the existing Stage 3.1–3.7 browser specifications
for Accounting Overview, legacy Accounting Reports, COA, journals/drafts,
approval/posting, General Ledger, Trial Balance, fiscal periods, AP/AR and
counterparties, accruals/schedules, fixed assets/depreciation, fund accounting,
restrictions/releases, bank and subledger reconciliation, closing/reopening,
annual preview, dashboard/login smoke and permission/navigation behavior, plus
the new Stage 3.8 Financial Statements specification. No test was skipped,
weakened or removed.

The browser tests use deterministic synthetic API responses. They verify
frontend contracts, request shapes, rendering, permission behavior and download
transport; they are **not** live database E2E and do not create financial
documents.

## F. Stage 3 final gap register

The register below consolidates the documented Stage 3.3–3.8 limitations and the
remaining cross-cutting policy/integration gaps. Nothing was silently fixed by
changing backend business logic or the database.

Severity: **P0** security/corruption/authorization bypass; **P1** important
workflow broken or materially incorrect; **P2** missing API capability/workflow
limitation without demonstrated corruption; **P3** UX/convenience; **POLICY**
requires authorised accounting decision/evidence; **UNVERIFIED** cannot yet be
proven without live E2E.

| Stage | Gap | Business impact | Backend support | Missing API/UI | Severity | Recommended remediation | Blocks dev completion? | Blocks operational deployment? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3.3 AP/AR | Document/settlement lists lack date, due-date and general sort filters | Operators cannot narrow large ledgers directly | Fixed server order plus reference/party/status/search | List filter/sort contract | P2 | Add reviewed query parameters and UI controls | No; 3.3 remains PARTIAL | No for normal operations; affects efficiency |
| 3.3 AP/AR | Settlements must allocate the entire amount; no unapplied cash, standalone allocation rewrite or linked-bank replacement | Some real cash workflows require manual workarounds | Explicit full allocation and audited reversal | Unapplied-cash and reallocation workflow | P2 | Design a reviewed backend workflow | No | No; workaround required |
| 3.3 AP/AR | No source-scoped settlement approval list or consolidated AP/AR audit timeline | Audit review needs the shared approval queue/journal | Existing approval, document and settlement evidence | Consolidated reporting endpoint | P2 | Add bounded audit/timeline query | No | No |
| 3.3 AP/AR | Counterparty code/classification/Member link immutable after creation; edits limited to name/active | Corrections require creating a new record | Strict PATCH contract | Edit contract | P3 | Add controlled amendment workflow | No | No |
| 3.4 Accruals/schedules | List endpoints do not accept search, kind or status filters | Large lists need client-side paging | Pagination only | Server filter contract | P2 | Add reviewed filters | No; 3.4 remains PARTIAL | No |
| 3.4 Accruals/schedules | No general schedule header/date-range PATCH; changes use approved CHANGE commands | Header mistakes require a controlled command | Approved CHANGE command | Direct draft revision | P2 | Add draft edit contract if policy permits | No | No |
| 3.4 Accruals/schedules | Accrual reversal/adjustment history is incomplete; related collections capped at 240/500 | Some audit trails require request IDs | Approval, journal and detail evidence | Comprehensive reversal lookup | P2 | Add bounded source-scoped history | No | No |
| 3.4 Accruals/schedules | Schedule detail does not expose a separate settlement ID | Operators follow the AP/AR document instead | Linked AP/AR evidence | Settlement reference field | P3 | Expose when available | No | No |
| 3.5 Fixed assets | Raw register lacks computed carrying value, impairment, last depreciation date and category labels | Register totals need detail views | Detail supplies authoritative values | Register projection | P2 | Add computed register DTO | No; 3.5 remains PARTIAL | No |
| 3.5 Fixed assets | No remaining-depreciable-balance preview, pre-posting impairment quote, disposal gain/loss quote or per-asset partial errors | Review is possible but less convenient | Preview amounts/evidence where exposed | Additional preview fields | P2 | Add reviewed preview DTOs | No | No |
| 3.5 Fixed assets | Reconciliation has no as-of/period input, separate net book/disposal totals or exception journal list | Historical controls require separate evidence | Current full-scope reconciliation | Historical reconciliation contract | P2 | Add as-of evidence | No | No |
| 3.5 Fixed assets | Valuation-based impairment reversal remains `PENDING_POLICY` | Some reversals cannot be recorded | Explicit policy gate | Policy and UI | POLICY | Management/accountant decision | No | Yes for that workflow until policy adopted |
| 3.5 Fixed assets | Change detail lacks a persisted computed policy-readiness field | Review must infer from evidence | Policy outcome returned | Explicit field | P3 | Add field/display | No | No |
| 3.6 Funds | `GET /funds` has no server-side class filter | Large registers need loaded-page filtering | Search/status only | Class query | P2 | Add class filter | No; 3.6 remains PARTIAL | No |
| 3.6 Funds | Fund metrics/reconciliation are current and per-fund only | No global fund control report or historical as-of view | Per-fund current metrics | Global/as-of endpoint | P2 | Add reviewed control report | No | No |
| 3.6 Funds | Releases have no persisted draft, eligible-release quote or journal-preview endpoint | Release submission is a single reviewed step | Approval payload and central posting | Draft/quote/preview API | P2 | Add bounded release workflow | No | No |
| 3.6 Funds | No discovery endpoint for eligible expense/capital lines used as release evidence | Operator must know a posted journal-line UUID | Actual posted evidence accepted | Scoped discovery contract | P2 | Add eligible-evidence lookup | No | No |
| 3.6 Funds | Conditional resolution requires bank/source evidence but has no scoped discovery; UI reports `PENDING_POLICY` | Conditional workflows remain blocked | Command contract exists | Reviewed discovery/policy workflow | POLICY / P2 | Accountant/management decision plus API | No | Yes for conditional recognition |
| 3.6 Funds | No global restriction/designation register; campaign/program/donor metadata limited to IDs | Fund oversight needs per-fund navigation | Per-fund paginated evidence | Global register/metadata | P3 | Add register or enrichment | No | No |
| 3.7 Reconciliation/closing | Live authenticated DEV API/database E2E not executed | Runtime authentication, real permissions and real evidence availability are unproven | Backend + frontend implemented | Live environment execution | UNVERIFIED | Authorised DEV read-only and controlled TEST execution | No | Needs verification before release |
| 3.7 Reconciliation/closing | Production MySQL 8.4/deployment compatibility not reverified | Deployment target differs from verified local 8.0.42 | No compatibility claim | Approved deployment test | UNVERIFIED | Approved 8.4 release test | No | Needs verification before release |
| 3.8 Financial statements | No UI for the existing `POST /report-snapshots` / `GET /report-snapshots/:id` final-review workflow | Immutable final snapshots cannot be requested or reviewed from this screen | Backend typed snapshot and approval endpoints exist | Snapshot request/detail UI | P2 | Add a separate reviewed publication workflow | No; does not block statement review | Yes for final publication workflow |
| 3.8 Financial statements | Optional backend fund/campaign dimension filters are not exposed | Statements cover the full year/date scope only | `accountingFundId` / `eventCampaignId` supported | Filter controls | P3 | Add reviewed fund/campaign selectors | No | No |
| 3.8 Financial statements | Backend export contains a DRAFT summary plus trial-balance lines, not every detailed statement/supporting subledger row | Reviewers cannot obtain a complete export package from one file | Actual CSV/XLSX contract | Expanded export contract | P2 | Add approved export sections | No | No for internal review; affects formal reporting package |
| 3.8 Financial statements | Opening-preparation endpoint is not exposed in the new screen | Operators see policy opening evidence but no detailed preparation view | `GET /fiscal-years/:id/opening-preparation` exists | Opening-preparation UI | P3 | Add to closing/reporting workspace | No | No |
| 3.8 Financial statements | Narrative policies/disclosures require professional preparation | Formal notes cannot be auto-generated | Explicit `REQUIRES_PROFESSIONAL_REVIEW` state | Authoring/approval workflow | POLICY | Accounting/professional review | No | Yes for official statements |
| 3.8 Financial statements | Live authenticated API/database E2E not executed | Contract rendering is verified only with synthetic fixtures | Backend implemented | Live execution | UNVERIFIED | Authorised DEV read-only verification | No | Needs verification before release |
| Cross-cutting | Approved framework, complete COA, statement/functional/restriction/cash mappings, verified opening balances and annual-closing mappings are not adopted | Official statements remain unverified | Policy persistence and approval implemented | Substantive accounting configuration | POLICY | Accountant/management adoption and evidence | No; UI correctly stays qualified | Yes; official reporting NOT_READY |
| Cross-cutting | Real accounting evidence and operational close/reconciliation procedures incomplete | Live balances cannot be certified | Workflows implemented | Operational evidence | POLICY | Complete actual source evidence and review | No | Yes for official use |
| Cross-cutting | Professional review of financial statements/notes not performed | No official publication | Snapshot/approval support exists | Professional sign-off | POLICY | Independent professional review | No | Yes for official use |
| Cross-cutting | Database-held audit hashes detect tampering but are not an external WORM archive | A privileged administrator could alter both data and evidence | Diagnostic seals and audit records | External archival control | POLICY / P3 | Operational audit controls | No | Depending on audit requirements |
| Cross-cutting | Bounded capacities fail closed (cash-flow 5,000 journals, 200 assets per close, 1,000 COA, 20,000 report groups, 200,000 fingerprint lines, and other documented caps) | Very large scopes return explicit errors rather than partial reports | Backend capacity guards | Reviewed batching | P2 / P3 | Add batching for actual scale | No | No; error is explicit |
| 3.1–3.2 residual | ESLint remains unconfigured; generated enum contract must be regenerated after backend enum changes | Tooling drift risk | Source-parity check script | Lint setup | P3 | Adopt an agreed lint configuration | No | No |
| 3.1–3.2 residual | No runtime enum/account-detail endpoint; approval queue is actor-scoped; no live digest/posting-preview endpoint; fiscal endpoint bounded rather than paginated | Some review efficiency limitations | Existing contracts | Additional discovery endpoints | P3 | Add only when operationally needed | No | No |

No **P0** or demonstrated **P1** issue was found within the Stage 3.8 tested
frontend scope. P0/P1 classification would require evidence of a security
bypass, corruption or materially incorrect displayed financial information;
none was observed. The absence of live E2E is recorded as **UNVERIFIED**, not as
a pass.

## G. Preservation

- Backend accounting source and Prisma schema were not modified by Stage 3.8.
- No database connection, migration, seed, reset, DDL or PROD access was
  performed. No `arya_tarray_dev`, `arya_tarray_test` or `arya_tarray_prod`
  mutation occurred.
- `.env`, `.gitignore` and `AGENTS.md` were not changed. Authentication,
  posting, approval and closing architectures were not rebuilt.
- No Git add, commit, push, reset, restore, checkout, clean or stash was run.
  The pre-existing uncommitted Stage 1–3.7 work remains intact.
- `git diff --check` passed; Git emitted only pre-existing LF→CRLF conversion
  warnings.
- Stage 3.8 changed three existing frontend integration files and added the new
  route, reporting feature files, browser tests and this document. No unrelated
  reformatting or dependency installation was performed.

## H. Final verdict

| Area | Verdict | Basis |
| --- | --- | --- |
| **Stage 3.8 frontend implementation** | **COMPLETE** for the actual backend-supported reporting scope | Four principal statements, supporting schedules, readiness/exceptions, exact values, scope selection, drill-down, exports, permissions and responsive tests pass |
| **Stage 3 overall technical readiness** | **PARTIAL** | Stage 3.1, 3.2, 3.7 and 3.8 frontend scopes are complete; Stage 3.3–3.6 remain PARTIAL for documented backend/workflow limits; live E2E is unverified |
| **Live integration readiness** | **NOT_TESTED** | No listener on local port 4000; browser tests used synthetic API fixtures; no database session was opened |
| **Accounting policy readiness** | **PENDING_POLICY** | Framework, complete COA, mappings, opening evidence, annual closing mappings and real source evidence are not adopted |
| **Official financial reporting readiness** | **NOT_READY** | Backend reports are DRAFT/internal (`official: false`); professional review and adopted policy/evidence are required |

The correct conclusion is not “the application is complete because the browser
suite passed.” The correct conclusion is: **Stage 3.8 frontend reporting is
implemented and regression-tested; Stage 3 technical delivery remains PARTIAL
and official financial reporting remains PENDING_POLICY / NOT_READY.**
