# Accounting Stage 3.6 — Fund accounting

## API contract inventory

Stage 2.5 fund routes, schemas, services, approval material, reconciliation queries and integration tests were reviewed before frontend implementation. All paths below are under `/api/accounting`. Reads require `ACCOUNTING_REPORT`. Mutations require `ACCOUNTING_JOURNAL_MANAGE`, independent decisions require `ACCOUNTING_JOURNAL_APPROVE`, and application/posting requires `ACCOUNTING_JOURNAL_POST`.

| HTTP and path | Actual contract |
| --- | --- |
| `GET /funds` | Page, pageSize, status and search by fund code/name. Rows include raw fund data plus `policyStatus`. There is no server-side class, campaign or date filter. |
| `POST /funds`, `PATCH /funds/:id` | Code, name, description, actual backend class, nullable balance account/campaign, dates, source reference and explicit policy. Revision is required for PATCH. Only the creator may edit a current DRAFT. |
| `GET /funds/:id` | Raw fund plus actor-scoped approval history. No user display names, source contribution list or computed balances are embedded. |
| `POST /funds/:id/submit`, `/apply` | Independent activation approval followed by authorized nonfinancial application. Application creates no journal. |
| `GET/POST /funds/:id/restrictions` | Fund-scoped restriction list or creation. Creation claims an actual posted contribution credit and accepts purpose/time/BOTH terms, exact amount, evidence, criteria, nullable canonical donor ID and campaign. |
| `GET/PATCH /fund-restrictions/:id` | Detail includes approval history and backend released/remaining amounts. Only an unposted creator-owned DRAFT can be directly revised. |
| `POST /fund-restrictions/:id/submit`, `/apply`, `/cancel` | Classification approval/posting, authorized application and creator-owned draft cancellation. Posting uses the central ledger. |
| `POST /fund-restrictions/:id/releases` | Submits a release approval directly. Payload includes current restriction revision, exact amount, dates, unrestricted target fund, evidence and optional posted expense/capital line. There is no persisted release draft or journal preview endpoint. |
| `GET/POST /funds/:id/designations` | Fund-scoped designation list/create. Only unrestricted resources are eligible. Activation is an independently approved nonfinancial action. |
| `GET /fund-designations/:id`, `POST /submit`, `/apply`, `/cancel` | Detail/history, independent activation, application and draft cancellation. Adjustment/release/cancel after activation use a fund command. |
| `GET/POST /funds/:id/movements` | Fund-scoped command/journal draft list and contribution classification or opening creation. Donor-restricted classification must use a restriction instead. |
| `GET /fund-movements/:id`, `POST /submit`, `/apply`, `/cancel` | Movement/command detail, approval submission, application/posting and cancellation. Submit requires explicit `FUND_COMMAND` or `FUND_JOURNAL`. |
| `POST /funds/:id/commands` | Creates close/reopen, donor-term amendment, designation adjustment/release/cancel, and conditional review/resolution commands. No automatic conditional recognition is permitted. |
| `GET /fund-contribution-sources` | Posted unreversed unallocated credit lines in REVENUE, LIABILITY or NET_ASSET accounts. Returns exact original, claimed and unallocated amounts plus bank/campaign/event/identity references. It never creates recognition. |
| `GET /funds/:id/releases`, `/journals` | Paginated posted releases and actual journals for one fund. Journal lines are not embedded in the list. |
| `GET /funds/:id/balances`, `/utilization` | Same current-posted-GL metrics response. Distinguishes accounting net assets, revenue, expenses, restriction amounts, designations, tagged bank cash and operational campaign wallet. No as-of parameter. |
| `GET /funds/:id/reconciliation` | Current full-scope reconciliation with metrics, exceptions, rejected/superseded release reviews and truncation flags. It creates no adjustment and accepts no period/as-of filter. |
| `GET/POST /approvals/:id/...` | Existing approval detail, independent decision, cancellation and central posting. Fund snapshots retain fund/restriction/designation/draft/source/release evidence and backend digest/version. |

Fund classes are `UNRESTRICTED`, `DONOR_RESTRICTED`, `CONDITIONAL_LIABILITY` and `CONDITIONAL_REVIEW`. The last is reported as `PENDING_POLICY`. Fund status is `DRAFT`, `ACTIVE` or `CLOSED`. Restrictions use `DRAFT`, `ACTIVE`, `SATISFIED` and `CANCELLED`. Designations use `DRAFT`, `ACTIVE`, `RELEASED` and `CANCELLED`. Monetary inputs are exact decimal strings with up to 18 integer and two fractional digits. Mutations are not retried automatically. Validation and lifecycle conflicts use HTTP 400/409, authorization uses 401/403, and missing sources use 404.

## A. Implementation

Stage 3.6 adds one catch-all Next.js route, `/accounting/funds/[[...source]]`, backed by the existing Stage 2.5 APIs. The route supports the fund register, fund creation and detail, restriction creation/detail, designation creation/detail, movement creation/detail and per-fund reconciliation. It remains inside the existing `AppShell`, Accounting workspace navigation and shared responsive styles.

The frontend implementation lives in `frontend/src/features/accounting/funds/`:

- `FundWorkspace.tsx` provides server search/status filtering, a clearly labelled loaded-page class filter, fund creation, fund detail, balances/utilization, releases and journal traceability.
- `RestrictionWorkspace.tsx` provides PURPOSE, TIME and BOTH restriction terms, contribution-source evidence selection, exact amounts, revision-aware editing, activation approval and partial/full release submission.
- `DesignationWorkspace.tsx` provides nonfinancial internal designation creation and separate approved adjustment, release and cancellation commands.
- `MovementWorkspace.tsx` provides unrestricted/conditional contribution classification, opening movements, command/journal approval flows and immutable movement evidence.
- `ReconciliationWorkspace.tsx` presents backend reconciliation metrics, exceptions, scope differences and retry without creating client-side adjustments.
- `ApprovalEvidence.tsx` renders frozen fund, restriction, designation, contribution and release evidence in the shared approval workspace.
- `FundActions.tsx`, `FundUI.tsx`, `api.ts` and `types.ts` contain lifecycle actions, reusable UI, thin API calls and exact contract types.

Shared Accounting navigation now exposes **Fund Accounting** from the sidebar, overview and `WorkspaceTabs`. The shared approval workspace recognizes the existing `FUND_ACTIVATION`, `FUND_RESTRICTION`, `FUND_DESIGNATION`, `FUND_RELEASE`, `FUND_COMMAND` and `FUND_JOURNAL` sources. The journal workspace exposes the existing reversal flow for `FUND_CLASSIFY`, `FUND_OPENING`, `FUND_RESTRICTION` and `FUND_RELEASE`; it does not create a second ledger.

## B. Fund workflows

- The register displays the four actual backend classes and never upgrades `CONDITIONAL_REVIEW` beyond `PENDING_POLICY`.
- A fund policy can be created and, while still a creator-owned DRAFT, revised. Activation is submitted for independent approval and applied by an authorized poster as a nonfinancial action.
- A donor restriction claims a real unallocated posted credit line. The UI sends the backend source line, exact restriction amount, term, dates, evidence and optional canonical references; it does not copy the contribution nominal into another frontend ledger.
- Partial and full releases use backend outstanding amounts and submit frozen release evidence for independent approval. The balance remains unchanged until backend posting succeeds.
- Internal designations remain nonfinancial. Changes to an active designation use separate approved commands instead of direct editing.
- Contribution classification and opening entries use the centralized posting engine. Detail views link to the resulting Accounting journal and retain original evidence.
- The reconciliation view keeps accounting net assets, economic resources, donor restrictions, board designations, tagged bank cash and the operational campaign wallet visibly distinct.
- Loading, empty, forbidden, validation, conflict and retry states are implemented. Mutation controls use in-flight locks and explicit confirmation where the action is consequential.

## C. Integration

The UI consumes the actual Stage 2.5 contract listed above. Source evidence displays contribution kind plus available journal, bank, campaign, event and identity references. It does not create a `BankTransaction`, campaign, donation, receivable, income or expense from a frontend assumption. `STANDARD_CONTRIBUTION`, `TIME_BASED_CONTRIBUTION` and `CAMPAIGN_CONTRIBUTION` are rendered as source evidence only.

Approval decisions continue through the shared Stage 2.1 decision endpoints. Source application/posting is performed through the corresponding fund endpoint so the backend digest, source revision, fiscal-period validation, idempotency and centralized journal transaction remain authoritative. Posted journals are read-only; reversals create a linked reversal request and retain the original journal.

All monetary payloads remain decimal strings. The UI performs format/range validation but never converts journal amounts through JavaScript floating-point arithmetic. Backend responses remain the authority for released, remaining, balance, utilization and reconciliation figures.

## D. Permissions and safety

- `ACCOUNTING_REPORT` gates all fund routes and read calls.
- `ACCOUNTING_JOURNAL_MANAGE` gates draft creation, revision, submission and cancellation.
- `ACCOUNTING_JOURNAL_APPROVE` gates independent decisions; requester self-approval remains blocked.
- `ACCOUNTING_JOURNAL_POST` gates application/posting and reversal submission.
- A report-only actor can inspect available evidence but sees no mutation controls.
- Stale revision/digest, missing grant, CLOSED period, duplicate source, duplicate submission and over-release failures remain visible and never produce optimistic success.
- No automatic donor matching, conditional recognition, restriction release, designation release, bank creation or GL adjustment was introduced.
- Donor personal data is not requested or displayed. Available canonical identifiers are shown only as evidence references.

## E. Validation

Verification completed on 2026-11-11:

| Check | Result |
| --- | --- |
| Frontend TypeScript (`npx tsc --noEmit --incremental false`) | PASS |
| Next.js production build | PASS; dynamic route `/accounting/funds/[[...source]]` built successfully |
| Stage 3.6 browser suite | PASS, 29/29 |
| Full frontend/browser regression | PASS, 141/141 (29 Stage 3.6 plus 112 existing tests) |
| Backend unit regression | PASS, 500/500 |
| Responsive inspection | PASS at desktop, tablet and mobile synthetic viewports; shell/navigation preserved and wide tables remain contained/scrollable |
| Live DEV API/database E2E | NOT TESTED; no backend listener was active on local port 4000 |

Browser tests use deterministic synthetic API responses and a production Next.js server. They cover the fund register and details, each funding classification, source contribution evidence, PURPOSE/TIME/BOTH restrictions, invalid/duplicate evidence, partial/full/over-release, independent approval, authorized posting, self-approval denial, stale digest, CLOSED period, missing permission, designations and commands, reconciliation/error/retry, report-only behavior, duplicate-submit locking and responsive layouts. These results are not represented as live database E2E.

Evidence is stored outside the repository under `D:/arya-tarray-change-records/AT-ST36-20261110-01-execution/`, including `build.log`, `frontend-typescript-final.log`, `browser-stage36-final.log`, `browser-full-final.log`, `backend-unit.log` and responsive screenshots. Prisma validation was not repeated because neither the Prisma contract nor backend/database structure was changed.

## F. Preservation

The Stage 3.6 baseline contained 720 files. Final SHA-256 comparison found no deletion and exactly eight pre-existing files changed, all expected frontend integration points:

- `frontend/src/config/navigation.ts`
- `frontend/src/features/accounting/apar/fields.tsx` (backward-compatible optional `required` prop for the shared textarea)
- `frontend/src/features/accounting/components/AccountingFoundation.tsx`
- `frontend/src/features/accounting/components/AccountingOverview.tsx`
- `frontend/src/features/accounting/core/ApprovalWorkspace.tsx`
- `frontend/src/features/accounting/core/JournalWorkspace.tsx`
- `frontend/tests/browser/accounting-core.spec.ts`
- `frontend/tests/browser/accounting-workspace.spec.ts`

New Stage 3.6 files are this document, the catch-all route, ten files under `frontend/src/features/accounting/funds/`, `frontend/tests/browser/accounting-funds.spec.ts` and `frontend/tests/browser/helpers/accounting-funds.ts`.

Backend source, Prisma schema, database, `.env`, `.gitignore` and `AGENTS.md` match the Stage 3.6 starting checkpoint. No migration, seed, reset, database write, PROD access, Git staging, commit or push was performed. The repository still contains the user's pre-existing uncommitted Stage 1–3.5 work; it was preserved. The Git index remains empty.

## G. Remaining risks

These are contract/readiness limitations, not simulated frontend features:

- `GET /funds` has no server-side class filter. The class control is explicitly labelled as filtering the currently loaded page.
- Fund metrics and reconciliation are current and per-fund only; the backend exposes no global fund control report and no period/as-of parameter.
- A release has no persisted draft, eligible-release quote or journal-preview endpoint. The UI therefore submits the exact release approval payload and waits for backend posting.
- The backend has no discovery endpoint for eligible expense/capital lines used as release evidence. An operator must supply an actual posted journal-line UUID when that evidence is required.
- Conditional-resolution commands require bank/source evidence, but there is no scoped eligible-source discovery contract for this workflow. The UI reports conditional review as `PENDING_POLICY` and does not expose an unsafe resolution action.
- Campaign/program/donor display metadata and canonical navigation targets are not returned by the fund contract; only safe source identifiers can be shown.
- There is no global restriction/designation register independent of selecting a fund.
- Live authenticated DEV API/database workflows were not exercised, so deployment authentication, real permissions, real source availability and database-dependent performance remain unverified.
- Previously documented Stage 3.3–3.5 contract/readiness gaps remain unchanged.

## H. Verdict

**PARTIAL.** The Stage 3.6 frontend is implemented, production-built and regression-tested against the real Stage 2.5 API contract without touching backend/schema/database state. It is not marked COMPLETE because several requested operational workflows—especially safe conditional resolution, eligible release-evidence discovery, period/as-of reconciliation and global fund reporting—lack backend contracts, and live authenticated database E2E was not performed.
