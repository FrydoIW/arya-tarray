# Accounting Stage 3.5 — Fixed assets

## API contract inventory

Reviewed Stage 2.4 services, SQL aggregation, Prisma relations, and existing asset integration tests. All paths below are under /api/accounting with authentication and ACCOUNTING_REPORT. Writes and preview require ACCOUNTING_JOURNAL_MANAGE. Independent approval requires an assigned ACCOUNTING_JOURNAL_APPROVE reviewer. Activation and posting require ACCOUNTING_JOURNAL_POST.

| HTTP and path | Input and response |
| --- | --- |
| GET /assets | page, pageSize, search by code/name, categoryId, status. Returns raw register rows sorted by assetNumber. No computed carrying values or last depreciation date. |
| POST /assets, PATCH /assets/:id | Code/name, optional description/location/custodian, category, actual acquisition line, acquired/available/depreciation dates, useful life, residual and evidence. PATCH adds expectedRevision. Returns raw asset. Cost is the posted line debit. |
| GET /assets/:id | Asset, category, source GL line and journal, disposal and depreciation history, changes, approval history, AP settlement allocations, grossCost, accumulatedDepreciation, impairment, carryingAmount, depreciationState and policyStatus. |
| GET /assets/:id/journals | assetId, limit and actual journal rows with lines, including reversals. |
| GET /asset-categories, /asset-categories/:id | List by page/search code or name, or full category. Mapping IDs, policy, default life, method and revision. |
| POST /asset-categories, PATCH /asset-categories/:id | Code/name, three required mappings, optional gain/loss, impairment expense/allowance and disposal clearing, life, STRAIGHT_LINE, activeFlag, nullable explicit policy. PATCH adds expectedRevision. Used or historically reviewed categories cannot be edited. |
| POST /assets/:id/changes | Discriminated action plus effectiveDate/reason. ESTIMATE and ADDITIONAL include remaining life/residual, ADDITIONAL also a source line. CORRECTION accepts master fields. RECLASSIFY takes target category. IMPAIRMENT takes recoverable amount, evidence, residual and life. DISPOSE takes proceeds and nullable consideration/cost lines. WRITE_OFF and DEACTIVATE take common fields only. Returns draft and policy outcome. IMPAIRMENT_REVERSAL remains PENDING_POLICY. |
| GET /asset-changes/:id | draft, command, asset with nested history. No recalculated proposal amount or gain/loss preview. |
| POST /depreciation-runs/preview, POST /depreciation-runs | runReference, accountingPeriodId, 1–200 distinct asset IDs. Preview returns period, rows with amount and frozen asset snapshot, postingAutomatic false. Create snapshots positive rows and reserves asset/period. |
| GET /depreciation-runs, /depreciation-runs/:id | List filters reference/status with backend run-date order. Detail returns period, planned rows, snapshots, expense/contra journal-line IDs and posted journal. |
| POST /asset-changes/:id/refresh, /depreciation-runs/:id/refresh | expectedRevision. Owned DRAFT only. Revalidates source, supersedes approvals and increments revision. |
| POST /assets/:id/submit, /asset-changes/:id/submit, /depreciation-runs/:id/submit | expectedRevision. Returns source-specific independent approval. Submission validates the accounting period, source snapshot and owner. |
| POST /assets/:id/activate, /asset-changes/:id/post, /depreciation-runs/:id/post | approvalRequestId. Activation, ESTIMATE, ADDITIONAL, CORRECTION and DEACTIVATE are nonfinancial applications. ASSET_JOURNAL and DEPRECIATION_RUN post through the common ledger. |
| POST /assets/:id/cancel, /asset-changes/:id/cancel, /depreciation-runs/:id/cancel | expectedRevision, reason. Cancels owned DRAFT and records audit. A cancelled run reads back as VOID. |
| GET /assets/reconciliation | Current full-scope comparison. reconciled, basis and rows with role/accountId/register/generalLedger/variance/reconciled. No period selector or reconciliation journal. |
| GET /approvals/:id, POST /approvals/:id/decision, /cancel, /post | Existing independent approval and journal reversal. ASSET_ACTIVATE uses asset source, ASSET_CHANGE/ASSET_JOURNAL use draft/command/asset, DEPRECIATION_RUN uses run. Retained snapshot is stored in requestPayload. |

Asset lifecycle is DRAFT, ACTIVE, CANCELLED, DISPOSED and WRITTEN_OFF. Runs are DRAFT, POSTED or VOID. Changes use DRAFT, APPLIED, POSTED or CANCELLED. Approval states are independent. Server validation handles exact Decimal values, UUIDs, active mapping classification, exclusive source claims, configured OPEN complete-month periods, chronological activity and approval version/digest. HTTP 400 denotes invalid input, 401/403 access failures, 404 absent sources, 409 lifecycle or evidence conflicts and 413 capacity limits. Errors are displayed through the existing API client. There is no automatic retry of mutations.

## A. Implementation

| Frontend route | View |
| --- | --- |
| /accounting/assets | Register |
| /accounting/assets/new, /accounting/assets/[id] | Registration and detailed evidence |
| /accounting/assets/categories, /accounting/assets/categories/new, /accounting/assets/categories/[id] | Category register, creation and revision |
| /accounting/assets/depreciation, /accounting/assets/depreciation/new, /accounting/assets/depreciation/[id] | Run list, preview/reservation and run detail |
| /accounting/assets/changes/[id] | Proposed change, policy evidence and posting trace |
| /accounting/assets/reconciliation | Read-only GL comparison |
| /accounting/approvals, /accounting/journals | Existing screens with Fixed Asset source evidence and journal links |

The Overview Fixed Assets card, Accounting workspace navigation and permission-aware WorkspaceTabs share the existing layout. Components reuse the shared page, card, inputs, account lookup, modal, status badge and scrollable table. Typed writes use apiFetch. Reads use the existing actor-scoped cache, cancellation and retry hooks. Journal drill-down can prefill the acquisition journal for an eligible AP or manual source.

## B. Workflows

- **Register and detail.** The server handles code/name search, category/status filters and pagination. The register defaults to server asset-code order, with current-page name/acquisition-date sorting. Detail shows the original source debit, backend gross cost, accumulated depreciation, impairment, carrying amount, returned posted depreciation history, related AP invoice and settlement allocations. It includes category mappings, retained approvals, change history, disposal and journal drill-down.
- **Categories.** Select active posting accounts by type, normal balance and contra classification from live COA. Policy reference, capitalization threshold and partial-month convention are supplied explicitly. Category revision carries expectedRevision. Used and historically reviewed mappings are protected by the backend.
- **Registration and activation.** Select a matching debit in an actual unreversed AP/manual acquisition journal. The UI has no editable cost field. Evidence, source line, residual, service dates and useful life go to the existing API. The available-for-use date derives a calendar start according to the selected category convention. The server validates it. Activation follows independent approval and applies without a second acquisition journal.
- **Depreciation.** Select an existing complete-month OPEN period and up to 200 distinct assets. Preview displays backend planned amounts, exact snapshots, method, convention, policy basis and eligibility errors. Draft creation reserves positive asset/period rows. A separate review and authorized posting produce the posted journal and expense/accumulated line IDs. DRAFT refresh revalidates the evidence and supersedes approval. Withdrawal and posted reversal use the existing audited backend paths.
- **Adjustment and impairment.** Master-record correction, prospective estimate, additional posted capital expenditure, reclassification and unused registration deactivation use separate typed drafts. Impairment uses an independently assessed recoverable amount and evidence, with policy and COA gating. The UI exposes the proposed source and the resulting immutable journal. Valuation recovery remains PENDING_POLICY.
- **Disposal.** Sale claims an actual clearing credit, with optional already posted costs from the mapped expense account. Existing AP/AR references and source journals are linked when available. WRITE_OFF uses the dedicated zero-proceeds command. The asset detail shows actual gain/loss lines from the posted disposal journal and disables further lifecycle creation once the asset is disposed. Ordinary corrective reversal uses the journal approval workflow.
- **Reconciliation.** Shows the full register versus mapped GL accounts with exact register, GL and variance amounts. Mismatches and capacity errors remain visible. A response with zero mapped rows is shown as UNVERIFIED. Account drill-down leads to the existing GL.

## C. Accounting and security

REPORT gates read-only access. JOURNAL_MANAGE gates registration, category management, change drafts, preview, revision and submission, with owner checks for applicable actions. JOURNAL_APPROVE requires assignment and independent identity. JOURNAL_POST gates both nonfinancial application and financial posting. UI never grants permissions. The API repeats authorization, period and digest checks.

Submission checks the configured OPEN period. Financial posting checks it again in the UI and on the server. The retained approval snapshot is displayed along with its version, digest and audit history. Backend statuses, evidence and read refreshes drive financial feedback. Confirmations and in-flight mutation locks prevent repeated clicks. Backend source claims and asset/period reservations protect cross-session and concurrent operations. Exact Decimal strings are serialized as entered. Snapshot integer cents are converted only for Rupiah display.

## D. Validation

Browser fixtures intercept all application API calls and use synthetic evidence. They exercise real routes, permissions, request shapes, validation, response handling and the existing design at desktop, tablet and mobile widths. They establish frontend integration behavior without a database session. No separate ESLint configuration is present.

| Check | Result |
| --- | --- |
| Frontend TypeScript | PASS — `npx tsc --noEmit --incremental false` |
| Next.js production build | PASS — `/accounting/assets/[[...source]]` built as a dynamic route |
| Stage 3.5 browser tests | PASS — 25/25 synthetic-API scenarios |
| Full frontend/browser regression | PASS — 112/112, including the 87 existing Stage 3.1–3.4 and application tests |
| Backend unit regression | PASS — 500/500 read-only unit tests |
| Responsive inspection | PASS — desktop, tablet and mobile screenshots reviewed; AppShell, sidebar, WorkspaceTabs, controls and contained table scrolling remain usable |
| Live DEV API/database E2E | NOT_TESTED — backend port 4000 had no listener and no database session was opened |

Stage 3.5 coverage includes register and category reads, create/edit lifecycle constraints, acquisition source and duplicate-claim handling, activation, all three partial-month conventions, depreciation preview/reservation/approval/posting, CLOSED-period and stale/digest rejection, duplicate-run and disposal race rejection, adjustments, policy-gated impairment, disposal/write-off, posted gain evidence, reconciliation mismatch/capacity/UNVERIFIED states, permissions, loading/empty/error recovery, confirmation locks, retained form state, sidebar and WorkspaceTabs. The browser suite uses synthetic API responses and is not represented as live database verification.

## E. Preservation

The 708-file baseline comparison found Stage 3.5 changes confined to frontend source, browser tests and this report. Backend source, Prisma schema, environment files, AGENTS.md and .gitignore matched their Stage 3.5 starting hashes. Backend DEV port 4000 had no listener, so live DEV API verification is NOT_TESTED. There was no database access, DDL, migration, seed or PROD use. The existing uncommitted Stage 1–3.4 work remains present. The Git index contains no staged paths and no commit or push was made.

## F. Remaining risks

- **Register scope.** Raw register rows lack computed depreciation, impairment, carrying amount, last depreciation date and category labels. Detail supplies actual balances and category mapping. Server-wide sort stays fixed. Custodians are exposed as user IDs.
- **Proposal and run evidence.** The backend does not return a standalone remaining depreciable balance in preview, a dedicated pre-posting impairment amount or disposal gain/loss quote, or per-asset partial error results when a preview request fails. Review displays retained evidence and actual posted values where exposed. Change detail lacks a persisted computed policy readiness field. Run approvals are accessible from the returned request link and the existing actor-scoped queue.
- **GL scope.** The reconciliation response has no as-of/fiscal-period input, separate net book/disposal totals, or list of exception journals. Its mapped control rows and account-level GL links are available.
- **Policy.** Valuation-based impairment reversal remains PENDING_POLICY. Capitalization/depreciation and enabled impairment require adopted references and valid COA mappings. These views do not certify official reporting readiness.
- Stage 3.3 and 3.4 retain their earlier contract limits. Database-backed E2E was not run for this frontend stage. [AP/AR report](accounting-stage3.3-ap-ar-ui.md) · [Accruals report](accounting-stage3.4-accruals-ui.md)

## G. Verdict

**PARTIAL.** Stage 2.4 asset workflows are integrated with the existing Accounting UI. Backend limits on register values, proposal previews, and period-specific reconciliation remain, and live DEV verification is outstanding.
