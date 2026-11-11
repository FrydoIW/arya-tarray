# Accounting Stage 2.5 — Nonprofit Fund Accounting

Status: **COMPLETE**, verified 2026-11-07. Backend only; no UI or Stage 2.6 implementation.

## A. Implementation

`backend/src/modules/accounting/funds/` contains validated schemas, exact monetary/date rules, source/policy repository, register and command service, approval identity/application, financial posting plans, bank-policy integration, reversal dependencies, read-only metrics/reconciliation and Express controllers/routes. Existing Accounting Approval, permission definitions, General Ledger persistence and period control remain the shared mechanisms.

No final COA, fund, donor terms, management designation, recognition/release policy or sensitive role grants were seeded in DEV. Real policy references and independent authorized decisions must be supplied through the workflows. Supplying a reference does not independently establish compliance with a reporting framework.

## B. Accounting rules and lifecycle

Funds start DRAFT and need independent FUND_SETUP approval to become ACTIVE. Approved CLOSE/REOPEN commands provide lifecycle changes. Draft revision invalidates current approval. Classified funds use existing accounts and optional program dimensions; there is no account/fund automatically created per donation/campaign. Supported classifications are UNRESTRICTED, DONOR_RESTRICTED, CONDITIONAL_LIABILITY and CONDITIONAL_REVIEW.

Unrestricted/donor-restricted contribution mappings require active non-contra REVENUE/CREDIT accounts. Conditional liability requires explicit adopted policy, substantive obligation evidence and LIABILITY/CREDIT mapping. Optional balance controls require NET_ASSET/CREDIT, or LIABILITY for adopted conditional treatment. CONDITIONAL_REVIEW or missing policy blocks activation/financial application with PENDING_POLICY. Donor restrictions alone never justify liability classification.

### Original contribution classification

An already posted, unreversed, unclassified credit is the evidence. Classification debits its actual old account/dimensions and credits the approved fund account/dimensions using a RECLASSIFICATION journal. Source journal/line, Event/Campaign and historical Member/Identity evidence remain traceable. Global cash and net revenue do not increase. Bank Phase 1 originals remain immutable.

Source allocation is capped across all funds by one actual original credit, including draft reservations. Multiple restrictions split that amount; BOTH combines purpose and time on one amount. Row locks, Serializable retries and source-event uniqueness protect concurrent claims. Source corrections use independent reversal and cancellation/revision, without deleting old journals. Reallocation cannot precede restoration by an earlier reversal.

Opening fund allocations require an actual approved opening/manual NET_ASSET credit and explicit balance mapping. They are reported separately from recognized contributions; no opening value is invented. Donor-restricted opening migration is not inferred by this workflow.

### Donor restrictions and release

Restrictions record source line, original amount, donor evidence, purpose/time/BOTH terms, effective/release dates, optional donor/campaign, revisions and actors. Explicit donor ID must match the historical source snapshot or verified canonical identity. STANDARD is not automatically unrestricted; a campaign name is not donor restriction evidence.

Draft restriction approval posts classification and atomically marks it ACTIVE with its real journal FK. Prospective AMEND_TERMS commands require independent approval and preserve prior payload snapshots; stale release approvals are superseded. Original nominal/source changes require reversal and draft revision rather than mutation of posted evidence.

Release needs original classification, remaining amount, accounting/satisfaction dates, reason, reviewed eligibility evidence, unique evidence/reference and explicit target unrestricted fund. Satisfaction cannot be in the future relative to the Asia/Jakarta business date, even when a future accounting date is selected. Supported purpose criteria are EXPENSE_INCURRED, CAPITAL_ACQUIRED and independently evidenced MILESTONE; TIME uses TIME_ONLY and BOTH requires both purpose and elapsed donor time. Capital evidence must also belong to an independently activated existing Stage 2.4 fixed asset. Payment, wallet allocation and expense existence do not automatically establish eligibility.

Expense/capital source debits must belong to the **destination unrestricted fund** and matching explicit program where required. Directly expensing the restricted fund and also releasing the same amount would reduce restricted resources twice; that is not accepted as release evidence. GL remaining restriction resources must reconcile before release.

Release mapping is explicitly selected as REVENUE_RECLASSIFICATION or NET_ASSET_RECLASSIFICATION. Debit must match the restricted control, credit the target unrestricted control; both must be in the selected account family. Actual source control capacity is required. Net-assets mode cannot fabricate a closing balance; it needs already posted net-assets evidence. No closing/reporting engine is added.

The release journal only reclassifies mapped revenue/net-assets dimensions. It never posts Bank, a new donation, an AP/AR settlement or another expense. Active evidence is unique per restriction; actual expense/capital debit capacity is capped globally across restrictions. Reusing a line under a different text reference is rejected. Explicit external evidence references are used for time/milestone decisions, with independent review of their substantive validity.

Example verified in TEST: restricted contribution 20,000,000; actual eligible unrestricted program expense 7,000,000; approved release 7,000,000; remaining restricted resources and donor nominal both 13,000,000. Unrestricted release less expense is zero; total original contribution revenue and bank remain 20,000,000. The remaining 13,000,000 can be released against separate valid evidence; the restriction becomes SATISFIED.

Approved reversal appends a compensating journal, retains original release/evidence, clears only its active reservation and restores remaining restriction/status. Later replacement releases cannot predate prior release/reversal activity. Evidence/source reversal is blocked while dependent classifications/releases or conditional decisions remain. Reversal may expose an unrestricted management deficit; reconciliation reports it instead of silently manufacturing cash/resources.

### Internal designations

Designation drafts have real amounts and dates with no fabricated approval actor. Independent FUND_DESIGNATION approval activates them against available unrestricted net resources. Adjustment, cancellation and release use approved FUND_COMMANDs and existing history. They are management subsets, not donor restrictions: no donor release, bank, revenue, expense or liability journal is created. Partial reductions use explicit amount adjustment; full release/cancellation changes lifecycle while preserving history. Owner cancellation of an unposted restriction/designation/movement also stores its reason, actor and original snapshot in an immutable nonfinancial FUND_AUDIT record in the existing draft table, including when no approval was submitted. This audit record is not a fabricated independent approval or posted journal.

## C. Integration and policy exceptions

STANDARD, TIME_BASED and CAMPAIGN sources share original Bank Phase 1 recognition. Classification never recognizes a second bank receipt/revenue. No future subscription commitment, campaign target, period schedule or operational wallet becomes an automatic receivable/donation. No Member/Identity ownership or operational balances are changed by fund commands.

Canonical ownership remains BankTransaction → MemberIdentity → Member. Classification preserves original historical GL evidence; later identity moves do not rewrite posted lines. Operational wallet/Member metrics retain their existing meaning and must not be represented as Accounting revenue or net assets.

An explicitly declared CONDITIONAL_REVIEW bank hold stores real imported bank evidence and policy rationale. While unresolved, ordinary bank recognition/finalization is rejected atomically; the existing reconciliation transaction rolls back. This is a source-specific accounting decision, not an environment/startup guard. Unmarked existing Phase 1 flows are unchanged.

Resolution requires a separate independently approved command, adopted target policy and an actual correctly classified full-amount posted credit with matching real bank debit/account. It binds existing evidence; it does not create cash/recognition again. An inconsistent existing Phase 1 revenue must first receive its separately approved reversal. The bank reservation prevents AP/AR receipt reuse; finalization skips duplicate Phase 1 recognition only for a current validated resolution. Reviewed reopening restores the hold only for a resolution in that fund and after dependent financial classifications have been reversed/cancelled. Original bank lifecycle is not synthesized or reset by these commands. Historical approval reads use the retained reviewed payload and current source record; strict posting eligibility is not incorrectly applied to reading evidence that has since been reversed.

The system cannot infer undeclared substantive donor conditions from bank text. Operators must register conditional review before recognition when applicable. Incorrect historical recognition still needs an authorized correction; declaring a later hold does not erase the original journal. No claim of automatic ISAK 335 or SAK EP compliance is made.

## Metrics and reconciliation

Current posted GL, including compensating reversals, is the financial basis. Server-side aggregates cover the complete selected fund rather than a paginated UI subset. Balances/utilization separately expose:

- Classified recognized REVENUE contributions, separately classified conditional LIABILITY contributions, and opening classifications. Conditional liabilities are never included in recognized-contribution revenue metrics.
- Actual GL net assets, net revenue including reclassification, recognized expense and conditional liability control.
- Economic net resources = NET_ASSET credit-minus-debit + REVENUE credit-minus-debit − EXPENSE debit-minus-credit.
- Funded donor nominal, active eligible releases and remaining restrictions.
- Active internal designations and unrestricted management available net resources (economic resources minus designations).
- Actual fund-tagged bank cash. Classification does not retag original bank cash, so unassigned cash is not falsely attributed to a fund.
- Recognized expense portions supported by active release evidence.
- Campaign wallet from ACTIVE operational wallet ledger entries, explicitly scoped to all participants in that campaign; it is not a fund GL balance.
- Commitments UNKNOWN rather than inferred from subscriptions/targets.

These values overlap and must not be added into one ambiguous balance. Available management resources are not spendable cash. Reports are current-state operational Accounting endpoints, not Stage 2.6 financial statements or historical closing reports.

Read-only reconciliation detects pending policy/bank reviews, remaining restriction vs GL differences, internal designation deficits, missing/unlinked classifications/journals, incorrect liability/revenue classification, inconsistent active release/reversal references, changed bank event/exclusion evidence, excess cross-fund source/evidence claims and global unclassified Bank Phase 1 sources. Operational campaign scope differences are explicit exceptions. Rejected/superseded valid release requests remain available with decision history. Invalid/duplicate proposals return 409 before persistence; they are not claimed to be separately persisted approval decisions. Exception samples have explicit bounds/truncation; no automatic adjustment occurs.

## API

Prefix `/api/accounting`; existing authentication/active-user checks and permission middleware apply. REPORT is required for read services, JOURNAL_MANAGE for source management, JOURNAL_APPROVE for assigned independent decisions, JOURNAL_POST for application. No role is granted automatically.

| Endpoints | Behavior |
|---|---|
| GET/POST `/funds`; GET/PATCH `/funds/:id` | Register, detail, draft revision |
| POST `/funds/:id/submit`, `/funds/:id/apply` | Independent setup approval/application |
| POST `/funds/:id/commands` | Close/reopen, prospective terms, designation changes and conditional review/resolution |
| GET/POST `/funds/:id/restrictions`; GET/PATCH `/fund-restrictions/:id` | Donor terms, actual source and draft revision |
| POST `/fund-restrictions/:id/submit`, `/apply`, `/cancel` | Classification approval/posting or draft cancellation |
| POST `/fund-restrictions/:id/releases` | Release request with explicit evidence, amount, mapping target and expected current restriction revision |
| GET/POST `/funds/:id/designations`; GET `/fund-designations/:id`; POST `/submit`, `/apply`, `/cancel` | Internal designation lifecycle |
| GET/POST `/funds/:id/movements`; GET `/fund-movements/:id`; POST `/submit`, `/apply`, `/cancel` | Source-backed classification/opening and approved commands |
| GET `/funds/:id/releases`, `/journals`, `/balances`, `/utilization`, `/reconciliation` | Traceability and separate full-scope metrics/exceptions |
| GET `/fund-contribution-sources` | Paginated real unallocated source capacity, including draft claims; no automatic recognition |
| Existing `/approvals/:id/decision`, `/cancel`, `/post` | Assigned independent decisions, audit, cancellation/application |
| Existing JOURNAL_REVERSAL approval | Compensating immutable journal and dependent fund state handling |

Source list/history endpoints use page/pageSize (max 100); detail approval samples explicitly cap requests/history at 100. Fund movement submissions state FUND_COMMAND or FUND_JOURNAL; release requests include `expectedRevision` and the full release evidence. Rejected financial drafts must be cancelled and replaced, or revised through supported draft paths, then independently approved. There is no edit route for posted journals or arbitrary overwrite of an ACTIVE fund policy.

## D. Database and change governance

Owner explicitly approved external manifest `AT-ST25-20261107-01` v1 with delegated DEV+TEST execution. Immutable SQL SHA-256 `FAF44C98F1E2F1AE1B84226A2A939CC6414C883A4D13C32D63479A01FA2257D3`; manifest SHA-256 `B59E418ED56C07FE2FFC4B1BFF40818E94ADBA96BD2714C34F48C3A0270B6F5D`. Receipt and execution evidence are under `D:/arya-tarray-change-records/`, protected by current Windows user/Administrators/SYSTEM ACLs.

Six approved ALTERs reused Fund, FundRestriction, FundDesignation, FundRelease, JournalDraft and ApprovalRequest. They add 41 fields, FK/index/CHECKs and nullable genuine designation approvals. Affected tables were verified empty on both targets. No table, model or existing data was dropped; there are still 61 tables / 29 Accounting models.

DEV pre-change full consistent backup: `C:/Users/Frydo/Downloads/arya_tarray_dev_pre_stage25_2026-11-07T10-56-47-501Z_7ca571d0.sql.gz` (18,525 bytes), SHA-256 `b7297025a38568d75f8545cc0ff889de3313c04be25b2fc43e578b566ab848cc`. Gzip integrity, SQL completion/footer and all 61 table definitions were verified. No restore/upload. Unique filename avoided overwriting existing Downloads files.

Each DDL statement was logged once per target; FK/index/unique/enforced CHECKs and original row counts passed. Prisma was synchronized manually, generated and validated. Physical DEV/TEST metadata agree: 785 scalar fields, 267 declared relations, 387 physical indexes, 128 enforced CHECKs; normalized metadata SHA-256 `abf2328259da75934dbf2a16bd7a6f898408ff5fab5d37af0043f2ecb688821b`. No prior migration replay, Prisma migrate/db push/db pull/reset or startup provisioning occurred. Temporary administrator option credentials were removed.

Recovery procedure remains stop-and-inspect on partial DDL, retain immutable backup and statement log, then authorize a reviewed forward repair; no automatic restore/down/drop or unrelated deletion. Both target schemas were applied successfully without such repair.

## E. Tests

Evidence is recorded in the protected Stage 2.5 execution directory. The complete integration runner passed **134/134**: all 100 Stage 2.1–2.4 regressions and 34 fund scenarios, with zero failures/skips. After the final separation of conditional liability/revenue metrics, the focused current-code fund suite passed **34/34** again. Unit/regression tests passed **432/432**, with zero failures/skips. Backend/integration/frontend TypeScript and Prisma validation passed. Only isolated `arya_tarray_test` received writing fixtures; exact connection checks preceded app/test imports and cleanup.

Final read-only physical verification at 2026-11-07T11:40:53Z confirmed all DEV/TEST table counts match the captured baseline, all TEST fixtures were removed, DEV financial journals/documents/settlements remain zero, DEV/TEST metadata match and all original rows are preserved. `.env` byte hash is unchanged; it remains ignored and untracked. ARYA_ENV remains DEV, cutover 2026-10-01 and FY2026/October–December OPEN. AGENTS.md, .gitignore and frontend source were not changed in this stage; pre-existing uncommitted changes were preserved. No PROD access, Git stage/commit/push, external upload or retained temporary admin credential file.

Evidence files: `integration-final.log`, `fund-final.log`, `unit-final.log`, `typecheck-final.txt`, `prisma-final.log`, `final-verification.json`, `backup-verification.json` and `ddl-log.jsonl` under `D:/arya-tarray-change-records/AT-ST25-20261107-01-execution/`.

The suite covers original/restricted/purpose/time/combined sources, 20m/7m/13m/full balances, internal designation capacity/changes, duplicate/over/invalid evidence, global evidence limits, self/unauthorized/stale, concurrent same/different requests, CLOSED period, reversal/dependency/history, conditional policy hold/resolution/reopening, future satisfaction rejection, STANDARD/TIME_BASED/CAMPAIGN, no double bank/revenue, current GL reconciliation, rollback, actual net-asset release, registered fixed-asset evidence, opening allocation, source discovery, cancellation audit and HTTP permission/source matching.

Early test runs exposed a draft type mismatch and FK ordering in fixture cleanup; both were corrected. The few retained synthetic TEST fixture IDs were explicitly recovered with target/identity checks; no DEV cleanup/data writes occurred. Final cleanup compares every TEST table count to the pre-execution baseline, rather than only checking new tables.

## F. Policy and supported-scope limits

Actual donor terms, policy references/account mappings, external milestone/time evidence and authorized roles need real organizational decisions; none were guessed. Policy absence stays PENDING_POLICY/REVIEW_REQUIRED. External evidence authenticity is a human review responsibility.

Live support is local IDR/current-state Accounting, existing approved open periods/cutover, append-only correction and explicit source allocations. Historical donor-restricted opening reconstruction, automatic conditional recognition journal creation/refunds, monetary retagging of original bank cash, arbitrary ACTIVE policy replacement, historical term migration across already released periods, FX, automatic period closing and Stage 2.6 financial statements are not implemented or claimed. Use existing separately approved manual/AP/AR/asset workflows to establish genuine evidence before applicable fund actions. Existing operational wallet/Member balances remain supporting evidence with their own scope.

## G. Verdict

**COMPLETE** for the backend scope described above: fund register, donor restrictions, internal designations, partial/full releases, approval/period/GL/bank integration, source traceability, read-only metrics/reconciliation and required tests. No technical blocker remains. Real organization-specific policies/mappings/evidence and authorized role assignments remain configuration decisions; their absence safely blocks the affected financial workflow rather than being guessed. This completion does not activate a real fund policy, implement Stage 2.6 or certify compliance with an accounting framework.
