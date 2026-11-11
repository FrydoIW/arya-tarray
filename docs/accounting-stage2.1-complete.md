# Accounting Stage 2.1 completion

**Verdict: COMPLETE for Stage 2.1.** Overall Full Accrual Stage 2/3 is not complete; AP/AR, Assets, Fund operations, closing/reporting and Accounting UI are later work.

## Approved execution and database

The user declared authority and explicitly approved scope A+B+C of `AT-ST21-20261105-01` v1. Access-controlled records are outside Git:

- `D:\arya-tarray-change-records\AT-ST21-20261105-01-APPROVAL-READY.md`
- `D:\arya-tarray-change-records\AT-ST21-20261105-01-APPROVED.md`
- `D:\arya-tarray-change-records\AT-ST21-20261105-01-COMPLETED.md`

The unchanged executed SQL artifact is `database/accounting-stage2-approval-proposal.mysql.sql`, SHA-256 `17F1A37B1A14EBC4D3141488A66C93DD08821846EF99659A3D114F77C7D49F95`. Its proposal header/filename is retained to preserve the approved bytes. Do not replay it.

DEV and TEST each have **61 physical tables and 29 Accounting models**. Five tables were added: journal draft, draft line, approval request, approver assignment and approval history. Physical review verified 22 FK column mappings/actions, 31 PK/unique/other indexes, and 21 enforced CHECK constraints. The original 21-FK count missed one composite FK; the approved SQL never changed. All existing DEV row counts were preserved immediately after DDL. Final DEV counts differ only by the approved fiscal year (+1), periods (+3) and permission definitions (+3).

Prisma was manually synchronized to actual DEV and then generated/validated. Table, column and nullability matching passed. No Prisma migrate, db push/pull, Stage 1 replay, drop/recreate or destructive database workflow was used.

Verified pre-migration full backup:

`C:\Users\Frydo\Downloads\arya_tarray_dev_pre_stage21_2026-11-04T17-24-10-168Z_2f915330.sql.gz`

Size: 14,666 bytes. SHA-256: `cf5e2bb1c3823e4dba2a4c68c3fc2ee75c60aa4d020982b6145756d0cc1a6e6f`. Gzip integrity, SQL completion footer and all 56 original table definitions passed. The consistent InnoDB dump requested data, routines/events/triggers without operational table locks. No restore or upload occurred.

## Backend behavior

COA, fiscal period, opening and existing Phase 1 foundations were retained. The shared posted-journal gate enforces exact balance, source uniqueness, explicit cutover, open period/fiscal year and atomic append-only creation.

Persisted approval now covers manual journals, adjusting journals and reversals. Draft revision supersedes unused approval; source ID/version/digest and assigned-approver snapshot are stored with auditable SUBMIT/APPROVE/REJECT/CANCEL/SUPERSEDE/APPLY history. Requesters cannot decide their own requests. Current active user and role/menu permission are checked inside transactions. Time expiry is not inferred; cancellation and supersession invalidate requests explicitly.

The common persistence function itself rejects MANUAL/ADJUSTMENT/REVERSAL posting without a persisted matching approval. It compares the current source digest and proposed journal contents, then atomically creates the journal, marks approval APPLIED and draft POSTED. Posted drafts have no edit/delete operation. Reversal appends compensating lines and retains the original journal and snapshots.

Bank finalization keeps its existing Sign Approval authority and ANY-ONE semantics. Finalization, Member/Campaign synchronization, posting and history remain one Serializable transaction. Real TEST integration proved that posting failure, missing cutover and closed periods abort the whole operation, with no duplicate donation recognition. STANDARD/TIME_BASED/CAMPAIGN recognition and correction policy remain unchanged.

## Routes and permissions

All routes are under `/api/accounting`, behind existing authentication, active-user checks and `ACCOUNTING_REPORT`. Existing JSON/error conventions are used.

| Method/path | Purpose | Additional permission |
| --- | --- | --- |
| GET/POST `/journal-drafts` | Own draft list/create | `ACCOUNTING_JOURNAL_MANAGE` |
| GET/PATCH `/journal-drafts/:id` | Own detail/revision | `ACCOUNTING_JOURNAL_MANAGE` |
| GET/POST `/approvals` | Scoped queue/request | Read scoped by role/ownership; create requires MANAGE |
| GET `/approvals/:id` | Source and bounded audit history | Requester, assigned approver or authorized poster |
| POST `/approvals/:id/decision` | Approve/reject | `ACCOUNTING_JOURNAL_APPROVE` and snapshot membership |
| POST `/approvals/:id/cancel` | Cancel unused request | Authorized requester or assigned approver |
| POST `/approvals/:id/post` | Apply approved journal/reversal | `ACCOUNTING_JOURNAL_POST` |
| GET/PUT `/approval-settings` | Eligible approver configuration | Existing `CONFIG_APPROVAL` |

Three permission definitions are provisioned in DEV. No user/role grants or named approvers were assigned automatically. Administrators must assign the intended DEV manager/reviewer/poster through existing role permissions and use the settings endpoint for Accounting approvers before operator use. The Statement Upload configuration UI is unchanged. Generic approval schema types for later modules are present, but their source workflows are not enabled.

## Configuration and isolated TEST

The user explicitly approved DEV cutover `2026-10-01`, FY2026 January 1–December 31, and monthly periods October/November/December OPEN. Active `.env` changed only `ACCOUNTING_CUTOVER_DATE`; credentials and other values were preserved. `.env` remains ignored/untracked. No opening amount was inferred from BankAccount, and DEV has no opening batch, journal or fixture financial transaction.

`arya_tarray_test` was separately provisioned from a reviewed schema-only snapshot. No real user, credential hash, donor, bank or financial data was copied. Its new restricted principal has only TEST DML privileges. Private connection configuration is access controlled outside Git; temporary administrator credentials were removed after verification.

Repeatable integration command, which selects TEST only in its process and never provisions schema:

```powershell
node D:/arya-tarray-change-records/AT-ST21-20261105-01-execution/run-integration.mjs
```

All test entry points and cleanup reject DEV/PROD and mismatching physical targets. Final TEST counts contain only approved minimal masters: 2 accounts, 1 menu, 1 fiscal year and 3 periods. Fixture users, roles, operational data, drafts, approvals/history and journals are all absent.

## Checks and scope

- Unit/regression: **418/418 passed**.
- Real MySQL TEST integration: **37/37 passed, none skipped**.
- Backend/integration/frontend TypeScript: passed.
- Prisma generate/validate and physical metadata checks: passed.
- TEST privileges/cleanup and Git whitespace checks: passed.

Integration includes persistence, rejection/cancellation, self/unauthorized/stale decisions, concurrent decisions, approval bypass attempts, source tampering, exact amounts, duplicate sources, closed periods, reversal immutability, opening idempotency, HTTP/settings permission contracts and bank rollback/regression.

Main changes: `backend/prisma/schema.prisma`; `backend/src/modules/accounting/approval/*`; Accounting routes and shared ledger/reversal persistence; Accounting/integration tests and fixtures; local-environment/checkpoint documentation; and the explicitly approved cutover key in ignored `.env`. Prior uncommitted work was preserved. No new UI, AP/AR, Fixed Assets, Fund operation or financial-report feature was added. No PROD access, AGENTS/.gitignore edit, startup guard, Git add/commit/push or external backup transfer occurred.
