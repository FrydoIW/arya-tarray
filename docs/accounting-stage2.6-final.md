# Accounting Stage 2.6 — Reconciliation, Closing and Financial Statements

Verified: 2026-11-08. Overall status: **PARTIAL**. The backend mechanisms are implemented and tested with synthetic, independently approved policy/evidence in isolated TEST. Actual DEV has no adopted reporting policy, only accounts `1110` and `4110`, and no posted Accounting journals. Official reporting and annual closing are **PENDING_POLICY**, not COMPLETE. This document supersedes earlier checkpoint statements that these mechanisms are unimplemented.

## A. Implementation and shared architecture

The new `backend/src/modules/accounting/finalization/` slice contains input/policy schemas, repository/transaction seams, GL reporting, bank reconciliation, subledger reconciliation, closing checks, finalization approval adapters, financial integrity, workflow orchestration and Express controllers/routes. Controllers validate inputs and delegate to services. Existing Accounting Approval, role/menu permission checks, Serializable transaction/retry handling and the centralized posted-journal gate remain the shared infrastructure. There is no second ledger, authentication system or posting engine.

The existing ledger report slice now supplies full-scope opening/movement/closing totals and account hierarchy. SQL window running balances remain correct across pagination. Existing approval and common posting adapters include the new typed finalization sources and append-only journal-content evidence. Asset reconciliation excludes annual closing entries from depreciation expense comparisons.

### API inventory

All paths below are under `/api/accounting`. Existing authentication and `ACCOUNTING_REPORT` access apply; writes also require existing `ACCOUNTING_MANAGE`, application/posting requires `ACCOUNTING_POST`, and independent decisions require `ACCOUNTING_APPROVE`. These permissions were not automatically granted to real users.

| Methods | Path | Purpose |
| --- | --- | --- |
| GET | `/general-ledger`, `/trial-balance` | Existing GL/TB with opening, movement, closing and drill-down |
| POST | `/reporting-policies` | Create proposed fiscal-year policy/mapping source |
| GET | `/finalization-sources/:id` | Source, requests and retained history |
| POST | `/finalization-sources/:id/submit`, `/finalization-sources/:id/apply` | Submit/apply typed policy or snapshot approval |
| GET | `/financial-statements` | Combined GL-based reporting bundle with exceptions/comparatives |
| GET | `/financial-statements/position` | Financial position |
| GET | `/financial-statements/comprehensive-income` | Income and functional expenses |
| GET | `/financial-statements/net-assets` | Changes in net assets |
| GET | `/financial-statements/cash-flows` | Direct cash flow under adopted policy |
| GET | `/financial-statements/trial-balance` | TB report slice |
| GET | `/financial-statements/supporting-schedules` | Policies and source-backed subledger details |
| GET | `/financial-statements/export?format=xlsx\|csv` | In-memory DRAFT review export, never represented as FINAL |
| GET | `/financial-integrity` | Cross-module controls and evidence |
| GET | `/subledger-reconciliation?fiscalYearId=...&asOf=YYYY-MM-DD` | AP, AR, assets, accrual/schedules and funds |
| POST / GET | `/report-snapshots`, `/report-snapshots/:id` | Independently approved immutable report; later change indicators |
| GET | `/periods/:id/closing-preview`, `/fiscal-years/:id/closing-preview` | Read-only close checklist |
| POST | `/periods/:id/close-request`, `/fiscal-years/:id/close-request` | Freeze/check and submit close approval atomically |
| POST | `/periods/:id/reopen-request`, `/fiscal-years/:id/reopen-request` | Reason/evidence and independent reopening approval |
| POST | `/periods/:id/apply`, `/fiscal-years/:id/apply` | Apply matching authorized command |
| GET | `/fiscal-years/:id/opening-preparation` | Permanent balances and continuous-GL carry-forward evidence |
| POST / GET | `/bank-reconciliations` | Create reconciliation / paginated list |
| GET | `/bank-reconciliations/:id` | Mathematical preview, matches, unresolved items and evidence |
| POST | `/bank-reconciliations/:id/matches`, `/bank-reconciliations/:id/void-match` | Actual bank/GL allocation and audited void |
| POST | `/bank-reconciliations/:id/adjustment-drafts` | Unposted charge/interest proposal based on real bank evidence |
| POST | `/bank-reconciliations/:id/submit`, `/bank-reconciliations/:id/reopen-request`, `/bank-reconciliations/:id/apply` | Independent sign-off/reopening/application |

Existing Accounting approval decision/history endpoints are reused. Report requests use `fiscalYearId`, `from`, `to`, optional `accountingFundId`/`eventCampaignId` and paired `comparativeFrom`/`comparativeTo`. UUID, exact amount, calendar date, pagination and strict payload checks are applied. Invalid/stale/unauthorized actions use the existing error response path.

## B. Reconciliation

### Bank to GL

Accounting reconciliation is separate from operational donor identification. BankAccount identity and real imported BankTransaction evidence remain intact; operational `RAW → CHECK → FINALIZED`, parser special cases, canonical MemberIdentity ownership and existing Sign Approval semantics are preserved.

Each reconciliation records its fiscal period, actual bank and explicitly mapped GL account, statement opening/ending, evidence, revision and status. Preview independently computes statement rollforward, GL opening/closing, active allocations, unmatched actual mutations and unmatched GL lines. Reversed GL pairs are treated consistently as of the cut-off. Matching validates account, sign/direction, FINALIZED/nonexcluded bank status, cut-off and remaining capacity on both sides. Locks, Serializable transactions and uniqueness prevent concurrent excess or duplicate matching. Valid partial, one-to-many and many-to-one allocations are supported. Voiding preserves audit evidence and is allowed only while OPEN.

Outstanding payments and deposits in transit require an actual unmatched GL line, exact amount/direction and reviewed evidence. Adjusted bank = statement ending + deposits in transit − outstanding payments. These items do not invent bank rows or accounting adjustments. Unresolved differences remain visible and block strict-zero sign-off/closing.

Bank charges/interest create an unposted ADJUSTING_JOURNAL draft against the actual bank mutation and explicit offset account. Approval and the common posting gate revalidate source state before atomic posting. Phase 1 and AP/AR source checks prevent a second recognition. `BUNGA` uses the parser's actual no-event behavior rather than masquerading as a donation. Internal bank transfers do not become revenue/expense.

Sign-off moves OPEN → REVIEW → CLOSED using independent Accounting Approval, version/digest checking and retained history. Approved reopening requires an OPEN accounting period and reason/evidence; it never rewrites old decisions. Active bank matches prevent silent journal reversal. Closing/report integrity detects altered statements, changed/excluded bank sources, missing matches and later GL movements, including changes with an unchanged aggregate balance.

### Subledgers as of a date

All results retain control accounts, source references, GL/subledger totals or components, differences, status and exception evidence. Missing mapping/policy remains UNVERIFIED, even for empty balances.

| Module | Independent comparison |
| --- | --- |
| AP / AR | Existing full-scope invoice/receivable, adjustment, allocation and reversal reconciliation, augmented by adopted controls even when there are no documents; no frontend-page summation |
| Assets | Registered acquisition/additional/reclassification/depreciation/impairment/disposal lines and dated reversals against cost/contra/expense/control GL; historical cut-off preserved |
| Accruals / prepayments | Actual source recognition, clearing, posted schedule periods, dated reversals and remaining balances against GL controls |
| Funds | Dated classifications/releases/reversals and conditional liabilities against GL; historical management designations reconstructed from retained approval snapshots/commands |

Management designations remain subsets of unrestricted resources. They do not increase net assets or become donor restrictions. Operational campaign wallet and available cash are not alternative Accounting totals. No balancing plug is created.

## C. GL financial statements and policy

Formal numbers come exclusively from posted GL, including approved opening journals when present. Subledgers provide source classification and reconciliation, not an extra set of balances to add to the GL.

Proposed reporting policy contains an explicit framework/adoption reference, current/noncurrent statement mapping, functional income/expense classes, unrestricted/restricted classes, cash equivalents, cash-flow activity, AP/AR controls, bank/GL identity mappings, opening/cutover evidence and optional annual net-assets mappings. Independent adoption selects a typed policy draft through the fiscal-year FK. The code does not assume a SAK framework or auto-create COA/roles/policy.

Financial position includes permanent net assets plus undistributed temporary balances exactly once; income reports exclude annual closing journals and their reversals. Closing does not duplicate surplus. Changes in net assets independently reconcile opening, income, other actual NA movements and ending per restriction class. Unmapped active accounts stay visible with exceptions rather than being hidden.

Cash flow supports **DIRECT** only when explicitly selected in the adopted policy. Exact BigInt cents/Prisma Decimal are used; no floating-point money arithmetic. Pure internal cash transfers net to zero, noncash depreciation has no cash movement, and AP/AR settlement cash is classified from the original source invoice lines rather than recognizing income/expense again. Partial allocations use cumulative integer-cent apportionment whose components tie to the actual settlement amount. Asset acquisition classification follows its adopted investing mapping. Ambiguous mixed-activity adjusted documents produce UNVERIFIED instead of a guessed classification. Indirect method is not implemented.

Comparatives use the actual fiscal year covering the comparison dates and its adopted policy. Missing policy/year is explicitly unverified. Opening preparation shows permanent balances under a continuous GL; it does not copy balances into another opening journal or fabricate new-year periods in DEV.

Notes/supporting schedules return reviewed policy references, GL breakdowns and source details. Narrative notes require professional review. Live statements and CSV/XLSX exports remain DRAFT/internal even when mathematical checks pass. Final review snapshots require CLOSED scope periods, all relevant integrity/source controls, current mappings and independent approval. Published JSON is immutable. Subsequent GL/period/policy changes show `REVISED_SINCE_PUBLICATION`; changed external reconciliation evidence without a GL change shows `REVIEW_REQUIRED_SOURCE_EVIDENCE_CHANGED`.

## D. Period closing, approval and audit

Monthly close atomically freezes OPEN → CLOSING and records the 15-item checklist plus financial/evidence fingerprint before submitting approval. Failed preparation rolls back the freeze/source/request. Only current independent approval can apply CLOSED, actor and timestamp. All ordinary posting paths use the shared period gate. Pending reopening leaves the period CLOSED. Rejection/cancellation restores the controlled prior state and retains command/decision history. Reopening increments revisions and permits correction through new authorized journals, never mutation/deletion of old journals.

Checklist: TB; valid/immutable journals; bank sign-offs; AP; AR; accrual/reversal review; amortization; asset depreciation; fund restrictions; pending approvals; unposted documents; opening evidence; adopted policy; fully classified original bank contributions; report mappings/equations. PASS/NOT_APPLICABLE permit closing; FAIL/WARNING/PENDING_REVIEW do not. Materiality supports strict zero only; there is no unapproved waiver mechanism. Pending financial approvals are conservatively checked globally, so future-dated pending work can require review before an earlier close.

Annual close additionally requires contiguous CLOSED fiscal periods from the approved cutover, explicit coverage evidence and approved unrestricted/restricted NA transfer accounts. It posts actual grouped temporary account balances through the centralized gate, retaining fund/restriction/program dimensions. Annual postings have a narrow persisted approval check allowing only the frozen year-end date and its CLOSED terminal period. Generic closing-journal reversal is forbidden. Independently approved YEAR_REOPEN appends its specific compensating journal, restores the fiscal year OPEN and preserves period statuses until separately reopened. Later-year financial activity blocks reopening pending dependency review.

Each common posted-journal creation also writes a separate append-only `FINALIZATION_AUDIT` draft seal over immutable header/line content, in the same transaction. Balanced direct tampering is detectable separately from TB arithmetic. Missing legacy seals remain UNVERIFIED; no historical proof is invented. These database-held hashes and app immutability are **not** an external WORM archive or protection against a privileged administrator changing both journal and evidence. Approval/history/source records remain append-only through the supported API.

The integrity endpoint exposes 17 controls: journal balance, TB, financial-position equation, AP, AR, assets, accruals, funds, bank review, cash flow, NA rollforward, journal-content seals, closed-period posting authority, donor release accounts, duplicate contribution recognition, duplicate settlement/capitalization and adopted report mappings. Failures retain references, evidence, severity and investigation guidance; there is no automatic repair entry.

## E. Approved database execution and backup

Approved record: `D:/arya-tarray-change-records/AT-ST26-20261108-01-APPROVAL-READY.md`; separate owner receipt `AT-ST26-20261108-01-APPROVED.md` records “Saya menyetujui patch DEV+TEST; catat dan eksekusi sekarang.” The directory is access-controlled for the current Windows owner, Administrators and SYSTEM.

- Manifest SHA-256: `C35D9788E149B61F7C69FF67325D2779FEB77210BE54FB2C4A6C2045EA18F847`.
- Exact approved patch: `database/accounting-stage2.6-finalization.mysql.sql`.
- SQL SHA-256: `4687E6C49B39E8B0DDBB288305B49483356CEC6446D3637AC7F278E52AB9A83E`.
- Five ALTERs / 15 scalar fields on FiscalYear, Period, BankReconciliation, JournalDraft and ApprovalRequest; typed source/policy/closing links, bank opening/evidence/revision and adjusted one-source approval CHECKs. No table added/dropped.
- Each DDL statement completed separately on exact DEV and TEST, with execution/recovery logs outside the repository. Source tables were empty; existing fiscal/period rows were retained. Stage 1–2.5 DDL was not replayed. No schema mutation is performed by application/test startup or Prisma migration tooling.
- Physical schema per target: **61 tables**, **29 Accounting Prisma models**, **800 scalar fields**, **276 FK relation contracts**, **396 physical indexes**, **132 enforced CHECKs**; 260 Prisma index contracts checked. DEV and TEST metadata agree. Verification checks table/column types/nullability/precision, keys, FK targets/actions and index contracts.
- Actual server remains MySQL **8.0.42**; deployment target is MySQL 8.4. No claim that this run tests the 8.4 deployment server.

Fresh pre-DDL full DEV backup, outside repository in automatically detected Downloads:

`C:/Users/Frydo/Downloads/arya_tarray_dev_pre_stage26_2026-11-07T18-59-07-783Z_80ffb208.sql.gz`

19,514 bytes; SHA-256 `060BB325D58C6DC6DEA9A3391D887E76B9DBECB3E5E100B686B51946AA8953AC`.

Gzip readability, SQL completion footer and all 61 tables were verified before DDL. The original backup has not been uploaded/restored. Existing Downloads files were not overwritten. UTC filename Nov 7 corresponds to local Nov 8. Temporary admin option file was removed after approved execution.

## F. Verification and scenario evidence

Final combined integration suite: **165/165 PASS**, no skipped tests (134 Stage 2.1–2.5 regressions plus 31 Stage 2.6 scenarios); unit/regression suite: **432/432 PASS**. Prisma validate and backend/integration/frontend TypeScript checks pass. Physical DEV/TEST contract verification, fixture cleanup, backup readability/hash and protected-file evidence are recorded in the external completion receipt and verification artifacts. All writing integration fixtures use the explicit `arya_tarray_test` connection and TEST preflight before application import. No DEV/PROD writing tests, no automatic database provisioning, no original donor data copied to TEST.

| Scenario | Assertions beyond HTTP success |
| --- | --- |
| A / H Donation | Actual bank finalization/classification, GL and sign-off; assets/NA/income/cash 20,000,000; zero equation and cash residual; no second recognition |
| B AP | Invoice 8,000,000, payment 3,000,000, outstanding 5,000,000; historical cut-off and GL control tie |
| C AR | Receivable 10,000,000, receipt 4,000,000, outstanding 6,000,000; combined AP/AR cash +1,000,000 and surplus 2,000,000 |
| D Prepayment | Recognition 12,000,000, amortization 6,000,000, remaining control 6,000,000 and expense 6,000,000 |
| E Asset | AP acquisition 12,000,000, actual bank payment 3,000,000 investing, depreciation 6,000,000; write-off remaining 6,000,000, historical cost/control tie |
| F Restricted fund | Contribution 20,000,000, eligible expense/release 7,000,000, restricted balance 13,000,000, unrestricted net zero; no extra cash/income/expense |
| G Closing | Independent approval, freeze, CLOSED posting rejection, reopening/revisions, immutable report JSON; annual transfer/reversal preserves total NA and income |

Additional coverage includes valid partial/batch bank allocations, concurrent matching and capacity, charge/interest source replay prevention, bank reopening/void audit, evidenced payments/deposits in transit, no noncash/internal-transfer cash flow, historical designation adjustment, missing annual policy, TEST-only 2027 comparative/continuous opening, per-page GL running balance, immutable balanced-tamper detection, snapshot source changes, posting/close races, concurrent close/reopen/application, stale evidence, unauthorized/self decisions and failure rollback. Existing Stage 2.1–2.5 suites are included rather than replaced.

Read-only DEV readiness result: accounts=2; journals=0; policyAdopted=false; report=UNVERIFIED; annual close=NOT_READY; integrity=UNVERIFIED. FY2026 and October–December remain OPEN; approved cutover remains `2026-10-01`. Missing bank/AP/AR mappings and opening/policy evidence are reported, not silently treated as balanced.

## G. Remaining risks and bounded scope

1. Actual framework, complete COA, functional/current/noncurrent/restriction mappings, bank/cash equivalents, AP/AR controls, opening evidence, annual transfer accounts and DIRECT cash-flow policy require authorized substantive review/adoption. Existing `1110`/`4110` are insufficient. No real reporting policy, journal, role grant or fictional opening was seeded in DEV.
2. Actual bank statements, source control reconciliations, cut-off coverage and approved closing evidence must be completed by operators. No real DEV period/year was closed during synthetic TEST validation.
3. DIRECT/STRICT_ZERO are supported; indirect cash flow, waived-materiality closing, FX/consolidation and guessed mixed-activity adjusted-document cash allocations are not implemented. Professional notes/framework compliance are not asserted.
4. Explicit evidence limits fail clearly: 1,000 COA, 20,000 account/fund report groups, 5,000 cash-flow journals, 5,000 journal seals per audit, 200,000 fingerprint lines, 200 active assets per close, 250 annual dimension groups/500 journal lines, 1,000 funds/designations and 5,000 designation commands. Larger scopes need reviewed batching; results must not be represented as complete after exceeding a cap.
5. Database-held audit hashes are a diagnostic, not an externally signed ledger. Historical missing seals and ambiguous/unmapped accounting remain UNVERIFIED.
6. Verification used local MySQL 8.0.42. An approved 8.4 deployment/release and official policy/data review remain separate.

## H. Stage 2 backend readiness and handoff

| Area | Verdict | Evidence / next action |
| --- | --- | --- |
| Technical mechanisms | Implemented and integration-tested within documented bounds | Shared ledger/approval, reconciliations, close/reopen, reports, integrity, TEST scenarios |
| Accounting policy | PENDING_POLICY | Actual complete COA/framework/mappings/opening and annual accounts not adopted |
| Operational readiness | PARTIAL | Physical DEV contract ready; operators still need actual evidence, roles and approved close procedures |
| Official financial reporting | NOT_READY / UNVERIFIED | DEV explicitly returns missing-policy/mapping exceptions; professional review required |
| Overall Stage 2.6 | **PARTIAL** | Do not claim official annual/reporting workflow COMPLETE while these real decisions remain open |

Stage 2.1 approval/posting, 2.2 AP/AR, 2.3 accrual/schedules, 2.4 assets and 2.5 nonprofit funds remain in place and covered by regression tests. Stage 2.6 backend is prepared for independent code audit. No UI, Stage 3, project ZIP, git add/commit/push, PROD access or startup database guard was introduced. `.env`, `.gitignore`, `AGENTS.md` and existing frontend source were preserved; prior uncommitted work remains local.
