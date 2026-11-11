# Accounting Stage 3.2 — Core UI

Date: 2026-11-09, Asia/Jakarta. **Stage 3.2 technical verdict: COMPLETE.**
Actual Accounting policy readiness and official reporting remain **PARTIAL /
PENDING_POLICY / NOT_READY**. This milestone does not certify financial balances
or adopt a reporting framework.

## API contract inventory (reviewed before UI implementation)

All paths are relative to `/api/accounting`. Existing authentication and
`ACCOUNTING_REPORT` apply. Source authority is the backend routes, schemas,
controllers, services and repositories, not earlier documentation aliases.

| Method / path | Payload / response | Additional permission / scope |
| --- | --- | --- |
| GET `/coa` | search, type, active, page, pageSize ≤100; paginated account DTO with `_count.lines` | report |
| POST `/coa` | code, name, accountType, normalBalance, parentAccountId, classification, reportSection, contra/posting/active flags | `ACCOUNTING_COA_MANAGE` |
| PATCH `/coa/:id` | editable fields only; code/type immutable; posted account permits only activeFlag | `ACCOUNTING_COA_MANAGE` |
| GET `/reports?view=journals` | date range, journalNumber, limited legacy journalType filter, pagination; journal rows with exact debit/credit strings | report; repository selects journals with matching lines, including manual journals when no type filter is sent; server coverage text remains Phase 1 |
| GET `/journals/:id` | full posted header/line snapshots, nullable bank evidence and related journals | report |
| GET `/journal-drafts` | page/pageSize; own paginated draft headers | `ACCOUNTING_JOURNAL_MANAGE` |
| GET `/journal-drafts/:id` | own draft, Decimal line strings, revision | `ACCOUNTING_JOURNAL_MANAGE` |
| POST / PATCH `/journal-drafts[/id]` | MANUAL/ADJUSTMENT, date, sourceReference, description, 2–500 account/debit/credit lines with optional dimensions; PATCH expectedRevision | `ACCOUNTING_JOURNAL_MANAGE`; own DRAFT only |
| GET `/approvals` | status, page/pageSize; actor-involved queue | any journal MANAGE/APPROVE/POST or AP/AR MANAGE; not a global queue |
| GET `/approvals/:id` | source, assigned approver IDs, version/digest, decisions, bounded history (1000) | authorized owner / assigned reviewer / poster |
| POST `/approvals` | manual/adjusting kind + sourceDocumentId + expectedRevision; reversal kind + original ID + date + remark | source management permission; backend independent approver configuration required |
| POST `/approvals/:id/decision` | decision APPROVED/REJECTED, nullable remark ≤1000 | `ACCOUNTING_JOURNAL_APPROVE`, assigned reviewer, not requester; digest checked |
| POST `/approvals/:id/cancel` | nonempty remark ≤1000 | eligible requester/reviewer, PENDING/APPROVED |
| POST `/approvals/:id/post` | no body | `ACCOUNTING_JOURNAL_POST`; current independently APPROVED source; atomic backend posting |
| GET `/general-ledger` | required to, optional from/accountId/accountingPeriodId/fund/campaign, page/pageSize; paginated journal lines plus opening/closing balances, totals, runningBalance | report |
| GET `/trial-balance` | same query; paginated posting-account rows, opening/movement/closing decimals; cumulative as-of totals and balanced flag | report; totals cover all accounts, not current page/account selection |
| GET `/periods/fiscal-years` | array, nested revFkAccPeriodFy (100 years/53 periods bound) | report |
| POST `/periods/fiscal-years` | yearCode/startDate/endDate | `ACCOUNTING_PERIOD_MANAGE`; explicit create only |
| POST `/periods` | fiscalYearId/periodNo/periodCode/startDate/endDate | `ACCOUNTING_PERIOD_MANAGE`; OPEN parent, overlap/range checked |

Backend lacks an enum-metadata endpoint, account-detail GET, general posted
journal status/source/period query filters, and a journal-specific approval-history
lookup. Account details therefore use returned list DTOs. Journal period filtering
uses date ranges and is labelled as such. No unavailable server-side filters are
simulated by filtering one page. Core review/actions support manual,
adjusting and reversal requests; later-module workflows remain outside this stage.

Enum choices are generated from the existing backend schema definitions into
a frontend contract snapshot with a source-parity check, avoiding a separately
invented account-type list or bundling backend dependencies in the browser.

No backend, Prisma, environment, policy, production or database changes are
authorized by this frontend task. Browser mutations will be intercepted synthetic
API tests only; no dummy account, fiscal configuration or journal is written to DEV.

## A. Implementation and design integration

| Route | Function |
| --- | --- |
| `/accounting` | Preserved Overview; activated COA/Ledger and Journals/Approval module cards, full GL/TB period deep links |
| `/accounting/coa` | Searchable, typed, paginated catalog, account details, permission-gated create/edit/activation |
| `/accounting/journals` | Posted journal list/detail and own journal draft workspace |
| `/accounting/approvals` | Actor-scoped queue/history, request-ID lookup, source review, decisions, cancellation and posting |
| `/accounting/general-ledger` | Full posted journal-line ledger, account/date/period scope, backend opening/closing/running balances |
| `/accounting/trial-balance` | Backend posting-account balances, cumulative totals and account/date drill-down to GL |
| `/accounting/periods` | Fiscal year/period lifecycle, explicit permission-gated year/period creation |
| `/accounting/reports` | Preserved existing donation report views, filters, journal details and PDF/XLSX exports |

All pages retain the existing AppShell, Sidebar, Topbar and WorkspaceTabs. One
Sidebar Accounting entry remains; virtual workspace pages share the existing
`ACCOUNTING_REPORT` grant and get distinct titles/tabs. Existing longest-path
matching resolves subpages correctly. Internal workspace links expose the core
pages without introducing a permission registry entry or a second sidebar.

New code is under `frontend/src/features/accounting/core/`: typed `api.ts` and
`types.ts`, generated contract choices, read/mutation/selection hooks, shared
core page/card/table/feedback controls, paginated account lookup, fiscal scope,
COA, draft, journal, approval, ledger/TB and period components. The six new Next
route files only render the feature workspaces and parse supported deep-link
parameters. No backend request is made from a route or at build time.

PageHeader, Card, Button, Select, SearchInput, Modal, ConfirmDialog, EmptyState
and the Stage 3.1 status/error foundation are reused. Financial tables follow the
existing report table convention. CSS modules use existing project design tokens;
there is no new theme, global CSS change or separate layout. Responsive grids
collapse to one column and wide tables scroll inside keyboard-focusable regions.
The existing modal provides focus containment, Escape and focus restoration.

### State, reads and mutation feedback

`useCoreRead` reuses the Stage 3.1 cache/subscriber/AbortController infrastructure.
An optional force-read parameter was added to `useAccountingRead`, preserving its
existing default behavior. Core pages read current data on re-entry; a stale
request cannot overwrite a newer scope. Filters are user-scoped in the existing
in-memory workspace cache. GL/TB deep links preserve date/account/period scope;
only validated UUID/date route values are accepted.

`useCoreMutation` has an immediate ref lock plus disabled submitting controls.
Success is shown only after backend acknowledgement. Relevant mounted reads are
refreshed; related Overview/report option caches are invalidated without aborting
unrelated core fiscal or lookup subscribers. Failed forms keep their input;
409 errors explain that the source/version must be refreshed. Failed confirmation
actions close the confirmation so the visible backend error can be read.
Permissions and approval status are not stored as permanent frontend authority.

Account selectors search and paginate backend COA data in bounded pages of 25;
no account code is seeded or treated as the entire catalog. A selected account
outside the current lookup page retains its ID rather than being substituted.

## B. Accounting workflows

### Chart of Accounts

The UI supports search, account-type and active filters, pagination, list-based
detail, create, update, activation, parent/header hierarchy, normal balance,
classification, report section and posting/contra flags. Account type and code
are immutable on edit because the strict PATCH schema does not accept them.
When `_count.lines > 0`, historical fields are disabled and PATCH contains only
`activeFlag`. There is no delete action. Header/parent cycles, active posting
eligibility and concurrent historical changes remain enforced by the backend.
Changes are explicitly reviewed and confirmed; opening the page creates nothing.

`frontend/scripts/sync-accounting-contract.mjs` extracts the backend account-type,
normal-balance, draft-type, approval-status enums and actual journal permission
values into `contracts.generated.ts`. The browser does not import backend modules.
Validation command:

```powershell
node frontend/scripts/sync-accounting-contract.mjs --check
```

There is no runtime enum-discovery endpoint; regenerating and reviewing this
snapshot is necessary when the backend schema changes. Frontend account types
also reference this generated contract.

### Journals and drafts

The posted list uses the existing report repository's paginated journal query
without a restrictive legacy journalType filter. Code review confirmed that its
query includes non-bank/manual journals with matching lines. Its legacy coverage
string remains unchanged on the backend; the existing Reports screen is preserved.
Journal number and date filters are server-side. Fiscal selection applies a date
range, not an unsupported accountingPeriodId filter. Unsupported general
status/source filters are explicitly disclosed instead of filtering one page.

Journal detail displays returned header/line snapshots, accounting period ID,
source reference/key, bank evidence when actually present, actor/posting metadata
and original/related/reversal references. POSTED journals have no edit/delete.
Unavailable creator names or approval-history relationships are not fabricated.

Own drafts support MANUAL and ADJUSTMENT creation/revision via the official
endpoints, explicit source reference/description, 2–500 lines, active posting
account choices and optional existing bank dimensions. Other existing line
dimensions are preserved on revision. Exact integer-cent validation rejects
unbalanced journals and lines with zero/two positive sides or invalid precision.
Fiscal context must be loaded and the date must be covered by an OPEN year/period.
The backend independently validates all these conditions and the draft revision.

Saving a draft, requesting independent approval and posting are three distinct
actions. Revision sends `expectedRevision`; the backend supersedes unused stale
approvals. A posted or source-specific non-core draft cannot be revised here.
The draft API has no attachment upload; supporting references use its actual
description/reference fields, not an invented file-upload workflow.

### Approval, posting and reversal

Queue pagination/status come from the backend's actor-involved requests. Submitted
and assigned requests are distinguished per row; this is not a global queue or
a client-filtered global submitted-by-me list. Authorized posters can open a
shared request UUID directly even when it is absent from their scoped queue.

Core detail shows source journal lines and exact amounts, reference/description,
requester ID, source revision/digest, assigned reviewer eligibility, existing
decision, posting reference and bounded retained history. The backend exposes
IDs rather than user names and draft account names. Source IDs are displayed
honestly; posted source snapshots include account labels when available.

Only MANUAL_JOURNAL, ADJUSTING_JOURNAL and JOURNAL_REVERSAL requests are actionable
in this milestone. Later-module requests expose audit metadata with an explicit
source-workspace limitation; core UI does not offer a context-free Approve/Post
button for AP/AR, assets, funds or closing.

Requester self-approval/rejection is withheld, even with an approval grant. A
reviewer must have the current grant and be in the returned assigned snapshot.
Decisions require source context and a matching displayed revision. The remark
is optional for decisions, as in the actual backend contract; cancellation
requires a nonempty reason. All decisions/cancellation/posting require confirmation.

Posting is separate and requires POST permission, independently APPROVED status,
eligible displayed source/reviewer evidence and OPEN fiscal context. The UI cannot
compute or attest a current digest: the backend checks current digest/version,
period, authorization, idempotency and transactional persistence. It displays
APPLIED only when returned after backend acknowledgement; permission/digest/period
failures do not show success or manufacture journal evidence.

Eligible existing core/bank journals can request a dated, reasoned reversal via
the existing approval-request endpoint. The original is not edited or removed;
approval and authorized posting are still separate. The backend rejects repeated
or ineligible reversals. Source-specific later-module reversal UIs are not built.

### General Ledger and Trial Balance

GL reads the Stage 2 `/general-ledger` endpoint, not BankTransaction or a wallet.
Opening, movements, closing and per-line running balances come from its response;
there is no frontend ledger calculation. Missing returned balances are labelled
not supplied, never silently replaced with a made-up zero. Account/date/year/period
selection, pagination and posted-journal drill-down are provided.

Trial Balance displays backend opening/movement/ending debit and credit by posting
account. Its backend totals are cumulative through the as-of date across all
accounts in the scope; they are not a sum of the current page/account selection.
This distinction is explicit in the UI. Account links open GL with the same scope.
The raw TB endpoint does not expose policy/unmapped-account verification, so its
balanced flag is described as arithmetic balance, never VERIFIED/official readiness.

Money is displayed from Decimal strings with BigInt grouping and exact cents,
including values larger than JavaScript Number's safe integer range. Only draft
validation and journal-line presentation totals are local; GL/TB balances and
control totals are taken directly from backend responses.

### Fiscal years and periods

The UI shows returned dates, lifecycle/closed state and posting availability.
Managers may explicitly create a fiscal year or a period using the existing API,
with date/parent/number validation and confirmation. No period is automatically
created. There is no full close/reopen UI or cutover mutation. The fiscal endpoint
does not expose live cutover; the page links to existing Reports, which display
the backend-returned value, instead of asserting an unverified current date.

## C. Permissions and separation of duties

Every route remains gated by `ACCOUNTING_REPORT` through the existing AppShell and
backend mount. Additional action grants are:

- `ACCOUNTING_COA_MANAGE`: account mutation.
- `ACCOUNTING_JOURNAL_MANAGE`: own manual/adjusting drafts and core requests.
- `ACCOUNTING_JOURNAL_APPROVE`: assigned independent review.
- `ACCOUNTING_JOURNAL_POST`: approved action posting.
- `ACCOUNTING_PERIOD_MANAGE`: explicit fiscal configuration creation.

AP/AR management grants may read the existing actor-scoped approval queue, but do
not enable later-module workflow actions in this UI. Report-only users see a
restricted approval workspace and do not send protected approval reads.
Frontend visibility never replaces backend authorization or grants permissions.

The actual journal permission values contain `ACCOUNTING_JOURNAL_`. Older docs
sometimes used constant aliases `ACCOUNTING_MANAGE/APPROVE/POST`. Stage 3.1
Overview had compared those alias strings directly; Stage 3.2 corrects it using
the generated source values, with browser coverage for valid grants and obsolete
alias rejection. No role/menu/user configuration was changed automatically.

Operators still need deliberately assigned manager/reviewer/poster grants and
independent Accounting approval configuration. Missing configuration returns the
existing backend error; it is not bypassed or automatically provisioned.

## D. Validation

| Check | Result |
| --- | --- |
| Frontend `npx tsc --noEmit`, final run after build | PASS |
| Frontend `npm run build`, Next.js 15.5.23 | PASS, all eight Accounting routes compiled |
| Backend enum/permission source parity | PASS |
| Browser main development run | 43/43 PASS |
| Additional development checks, including revised responsive checks | 7/7 PASS |
| Complete latest suite against production build | 47/47 PASS (30 core + 17 existing regression tests) |
| Existing backend unit/regression `npm test` | 500/500 PASS |
| `git diff --check` | PASS |
| ESLint | NOT CONFIGURED; no PASS claimed, no lint setup/dependency added |

Browser tests exercise COA filters/detail/create/edit/invalid input, posted-account
restrictions, manual draft exact balance/revision/request, journal detail/filter/
source evidence, requester self-decision prevention, independent approve/reject,
stale revision/digest errors, cancellation, unauthorized/authorized posting, revoked
permission, closed period, duplicate submission, reversal request, dynamic GL
accounts, backend balances/pagination, TB drill-down, exact large Decimals, fiscal
display/creation, failure/retry, late responses, route permissions and scope limits.

Actual Chromium screenshots were visually inspected for COA, account form,
approval source/history and GL on desktop, tablet and mobile. Keyboard focus and
Escape, wide-table scrolling, Sidebar and distinct workspace tabs were tested.
Existing Stage 3.1 Overview and six legacy report views/detail/PDF/XLSX transport
remain covered. Dashboard, login/Campaign smoke, Monitoring, Reconciliation,
Member, existing Approval and Configuration navigation/permission/error-state
regressions pass. This is not a claim to have re-exercised every business workflow.

All browser API calls, including mutations, terminate in synthetic test responses.
No real account, draft, approval, period or journal is created by these tests. They
verify frontend contracts and interactions, not live database end-to-end behavior.
No writing integration tests were run. A real authenticated DEV GET check was not
performed: no backend listener was available on local port 4000. The application
was not started to obtain credentials or make data changes. Earlier Stage 2 TEST
integration results are historical evidence, not new runs for this frontend task.

Private execution evidence is outside the source repository:
`D:/arya-tarray-change-records/AT-ST32-20261109-01-execution/` contains build/typecheck,
browser and backend unit logs, browser screenshots, the initial 616-file hash
snapshot and the preservation check. The initial browser run exposed ambiguous
test selectors (Next route announcer/status options); those were corrected and
the subsequent complete suites passed. Production browser serving emitted the
existing standalone-output warning from `next start`; deployment packaging was
not changed.

## E. Database and backend safety

No backend source, Prisma schema, SQL patch, physical schema, financial DEV data,
environment, cutover, `.gitignore`, `AGENTS.md`, authentication architecture or
policy was changed. No database connection, provisioning, migration, seed,
reset, PROD access or writing database integration test was performed.

Comparison with the initial 616-file snapshot found six changed existing frontend
files and 26 new files (25 frontend files and this document), with no deleted
originals or protected backend/configuration changes. Existing uncommitted Stage
1/2/3.1 work was preserved. No git add, commit or push occurred.

## F. Remaining risks and contract limitations

1. Full COA, framework/report mappings, actual opening evidence and annual closing
   policy remain PENDING_POLICY. Official statements remain NOT_READY; no status
   was promoted to make the UI appear complete.
2. No runtime metadata/account-detail endpoint: generated enum source parity and
   list-based account details are used. Selected IDs outside the lookup page are
   retained explicitly; lookup search/pagination is required for another page.
3. General posted-journal source/status/period-ID filtering and journal-specific
   approval-history lookup are not available. The UI exposes only actual supported
   filtering and returned evidence; no per-page fake global filter is supplied.
4. Approval queue visibility is actor-scoped; poster-only operators need a shared
   request ID for requests outside that queue. Draft account/user display names
   are not exposed by approval detail; IDs remain visible for traceability.
5. No separate live digest or posting-preview endpoint exists. Frontend source
   context is not a cryptographic freshness certificate; backend checks remain
   mandatory at decision/post time.
6. Raw TB has arithmetic totals rather than financial-integrity/policy status.
   Fiscal years/periods retain the backend 100/53 bound. Overview does not trigger
   heavy integrity/report reads automatically.
7. Real DEV runtime API and MySQL 8.4 deployment behavior were not verified here.
   Earlier MySQL 8.0.42 versus 8.4 limitations remain open. No database/schema
   compatibility claim is added by these frontend checks.
8. Stage 3.3–3.8 source-specific transaction, closing and official statement UIs
   remain outside scope. Existing donation Reports remain available separately.

## G. Final verdict

**COMPLETE for Stage 3.2 frontend technical scope**: COA, core journals/drafts,
independent approval and posting, GL, TB and fiscal configuration are wired to the
existing backend contracts and tested. Approval/posting are functioning API-driven
paths, not frontend simulations; only the automated browser test transport is
mocked. Live operational use still depends on authorized roles, approver
configuration, valid source evidence, OPEN periods and the actual backend checks.

**Accounting policy readiness and official financial reporting remain PARTIAL.**
